import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DETERMINISTIC_SUPPLIER_PARSER_VERSION,
  extractSupplierPageDeterministically,
  routeExtractionPage
} from "../src/pdf/deterministic-extraction";
import { PdfJsDocumentParser } from "../src/pdf/pdfjs-parser";
import {
  LocalDocumentStorage,
  LocalPilotPersistence,
  type PersistedPilotRun
} from "../src/storage/document-storage";

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=") || "true"];
  })
);
const documentSelector = args.get("--document");
const pageNumber = Number(args.get("--page"));
const dryRun = args.has("--dry-run");

if (!documentSelector || !Number.isInteger(pageNumber) || pageNumber < 1) {
  throw new Error("Use --document=<id-or-name> --page=<number>.");
}

async function main() {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    throw new Error("Set LOCAL_CORPUS_ENABLED=true for local deterministic extraction.");
  }
  const root = process.cwd();
  const manifest = JSON.parse(
    await readFile(
      path.resolve(root, ".data", "corpus-manifest.local.json"),
      "utf8"
    )
  ) as {
    documents: Array<{
      id: string;
      relativePath: string;
      sha256: string;
      documentType: string;
      discipline: string;
      pages: Array<{ pageNumber: number; mode: string }>;
    }>;
  };
  const document = manifest.documents.find(
    (candidate) =>
      candidate.id === documentSelector ||
      candidate.relativePath
        .toLocaleLowerCase()
        .includes(documentSelector!.toLocaleLowerCase())
  );
  if (!document) throw new Error("Document not found.");
  const pageManifest = document.pages.find(
    (candidate) => candidate.pageNumber === pageNumber
  );
  if (!pageManifest) throw new Error("Page not found in manifest.");
  if (document.documentType !== "SUPPLIER_OFFER") {
    throw new Error("This command currently persists deterministic supplier pages only.");
  }

  const startedAt = new Date();
  const file = new Uint8Array(
    await readFile(
      path.resolve(
        root,
        process.env.CORPUS_DIR ?? "pdffirma",
        document.relativePath
      )
    )
  );
  const parser = new PdfJsDocumentParser();
  const page = await parser.extractPage(document.id, file, pageNumber);
  const route = routeExtractionPage(page);
  process.stdout.write(
    `ROUTE: ${route.primary}; fallback ${route.fallback}; text confidence ${route.textLayerConfidence.toFixed(3)}; ${route.reason}\n`
  );
  if (route.primary !== "DETERMINISTIC_TEXT_LAYER") {
    throw new Error("Page requires OCR/visual handling; no automatic AI fallback was sent.");
  }
  const extracted = extractSupplierPageDeterministically({
    documentId: document.id,
    documentRevisionId: document.id,
    documentType: document.documentType as "SUPPLIER_OFFER",
    discipline: document.discipline as
      | "SANITAER"
      | "HEIZUNG"
      | "MIXED"
      | "UNKNOWN",
    page,
    createdAt: startedAt.toISOString()
  });
  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          provenance: extracted.provenance,
          lines:
            extracted.envelope.extraction.offerGroups[0]?.lines.map(
              (line) => ({
                sourcePositionNumber: line.sourcePositionNumber,
                supplierPositionNumber: line.supplierPositionNumber,
                articleNumber: line.articleNumber,
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.interpretedUnitPrice,
                totalPrice: line.interpretedTotalPrice,
                role: line.role,
                confidence: extracted.lineConfidence[line.id],
                evidence: line.evidence
              })
            ) ?? [],
          validationIssues: extracted.validationIssues
        },
        null,
        2
      )}\n`
    );
    process.stdout.write("OpenAI calls 0; persisted no.\n");
    return;
  }
  const persistence = new LocalPilotPersistence(
    path.resolve(root, ".data"),
    true
  );
  const state = await persistence.read();
  const existing = state.runs.find(
    (run) =>
      run.document.id === document.id &&
      run.document.pageNumber === pageNumber &&
      run.provenance?.extractionMethod === "DETERMINISTIC_TEXT_LAYER" &&
      run.provenance.rawTextItemsHash === extracted.provenance.rawTextItemsHash &&
      run.provenance.parserVersion === DETERMINISTIC_SUPPLIER_PARSER_VERSION
  );
  if (existing) {
    process.stdout.write(
      `cache hit: ${document.id} page ${pageNumber}, run ${existing.id}\n`
    );
    return;
  }

  const runId = `run_${createHash("sha256")
    .update(
      JSON.stringify({
        documentSha256: document.sha256,
        rawTextItemsHash: extracted.provenance.rawTextItemsHash,
        parserVersion: extracted.provenance.parserVersion
      })
    )
    .digest("hex")
    .slice(0, 18)}`;
  const assetStorage = new LocalDocumentStorage(
    path.resolve(root, ".data", "pilot-assets"),
    true
  );
  const pageImageAsset = `pages/${runId}.png`;
  if (!(await assetStorage.exists(pageImageAsset))) {
    await assetStorage.put(
      pageImageAsset,
      await parser.renderPage(file, pageNumber, 1.5),
      "image/png"
    );
  }
  const completedAt = new Date();
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify({
        method: "DETERMINISTIC_TEXT_LAYER",
        documentId: document.id,
        pageNumber,
        rawTextItemsHash: extracted.provenance.rawTextItemsHash,
        parserVersion: extracted.provenance.parserVersion
      })
    )
    .digest("hex");
  const run: PersistedPilotRun = {
    id: runId,
    document: {
      id: document.id,
      relativePath: document.relativePath,
      pageNumber,
      pageCount: document.pages.length,
      pageMode: page.mode,
      documentType: document.documentType,
      discipline: document.discipline
    },
    result: {
      envelope: extracted.envelope,
      metadata: {
        modelId: "local-deterministic",
        responseId: null,
        promptVersion: DETERMINISTIC_SUPPLIER_PARSER_VERSION,
        schemaVersion: extracted.envelope.schemaVersion,
        preprocessingVersion: extracted.envelope.preprocessingVersion,
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        attempt: 0,
        estimatedCostUsd: 0,
        error: null,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        cacheKey,
        extractedLineCount:
          extracted.envelope.extraction.offerGroups[0]?.lines.length ?? 0,
        inputTokensPerPage: null,
        outputTokensPerExtractedLine: null,
        costPerExtractedLineUsd: 0
      }
    },
    validationIssues: extracted.validationIssues,
    pageImageAsset,
    cropAssets: {},
    recheck: null,
    provenance: extracted.provenance,
    createdAt: completedAt.toISOString()
  };
  await persistence.saveRun(run);

  const cacheDir = path.resolve(
    root,
    ".data",
    "deterministic-extractions"
  );
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    path.join(cacheDir, `${cacheKey}.local.json`),
    JSON.stringify(run, null, 2),
    { flag: "wx" }
  );

  process.stdout.write(
    `COMPLETED: run ${run.id}; page status ${extracted.provenance.validationStatus}; lines ${run.result.metadata.extractedLineCount}; confidence ${extracted.provenance.confidence.toFixed(3)}; issues ${run.validationIssues.length}; response ID none; OpenAI calls 0; cost $0.\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
