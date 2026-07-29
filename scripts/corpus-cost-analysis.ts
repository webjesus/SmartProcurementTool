import { readFile } from "node:fs/promises";
import path from "node:path";
import { zodTextFormat } from "openai/helpers/zod";
import {
  buildExtractionRequestBody,
  createExtractionCacheKey
} from "../src/ai/openai-extraction-adapter";
import { SUPPLIER_EXTRACTION_SYSTEM_PROMPT } from "../src/ai/prompts";
import {
  CompactNativeExtractionSchema,
  PREPROCESSING_VERSION,
  PROMPT_VERSION,
  SCHEMA_VERSION
} from "../src/domain/contracts";
import { PdfJsDocumentParser } from "../src/pdf/pdfjs-parser";
import { LocalPilotPersistence } from "../src/storage/document-storage";

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=") || "true"];
  })
);
const documentSelector = args.get("--document");
const pageNumber = Number(args.get("--page"));
const includeDocumentMetadata = !args.has("--no-metadata");
const alreadySpentUsd = Number(args.get("--already-spent-usd") ?? 0);
const cumulativeAllowanceUsd = Number(
  args.get("--cumulative-allowance-usd") ?? Number.NaN
);
if (!documentSelector || !Number.isInteger(pageNumber) || pageNumber < 1) {
  throw new Error("Use --document=<id-or-name> --page=<number>.");
}
const selectedDocument = documentSelector;

async function main() {
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
      pages: Array<{ pageNumber: number; mode: string }>;
    }>;
  };
  const document = manifest.documents.find(
    (candidate) =>
      candidate.id === selectedDocument ||
      candidate.relativePath
        .toLowerCase()
        .includes(selectedDocument.toLowerCase())
  );
  if (!document) throw new Error("Document not found.");
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
  const request = buildExtractionRequestBody({
    documentId: document.id,
    page,
    includeDocumentMetadata
  });
  const model = process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5.6-sol";
  const idempotencyKey = createExtractionCacheKey({
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    preprocessingVersion: PREPROCESSING_VERSION,
    model,
    source: request
  });
  const bytes = (value: unknown) =>
    Buffer.byteLength(
      typeof value === "string" ? value : JSON.stringify(value),
      "utf8"
    );
  const approximateTokens = (value: number) => Math.ceil(value / 4);
  const systemPromptBytes = bytes(SUPPLIER_EXTRACTION_SYSTEM_PROMPT);
  const schemaBytes = bytes(
    zodTextFormat(
      CompactNativeExtractionSchema,
      "procurement_native_compact"
    )
  );
  const baseBytes = bytes({
    documentId: document.id,
    pageNumber: page.pageNumber,
    pageMode: page.mode,
    includeDocumentMetadata
  });
  const textItemBytes = bytes(
    page.textItems.map((item) => ({ id: item.id, text: item.rawText }))
  );
  const geometryBytes = bytes(
    page.textItems.map((item) => ({
      id: item.id,
      region: [
        Math.round(item.region.x * 10_000) / 10_000,
        Math.round(item.region.y * 10_000) / 10_000,
        Math.round(item.region.width * 10_000) / 10_000,
        Math.round(item.region.height * 10_000) / 10_000
      ]
    }))
  );
  const requestBytes = bytes(request);
  const pageImageBytes =
    page.mode === "DIGITAL"
      ? 0
      : (await parser.renderPage(file, pageNumber, 1.5)).byteLength;
  const persistence = new LocalPilotPersistence(
    path.resolve(root, ".data"),
    true
  );
  const state = await persistence.read();
  const run = state.runs.find(
    (candidate) =>
      candidate.document.id === document.id &&
      candidate.document.pageNumber === pageNumber
  );
  const estimatedNonImageTokens = approximateTokens(
    systemPromptBytes + schemaBytes + requestBytes
  );
  const configuredMaxOutputTokens = Number(
    process.env.SPT_MAX_OUTPUT_TOKENS ?? 6_000
  );
  const worstCasePageCostUsd =
    (estimatedNonImageTokens * 5 + configuredMaxOutputTokens * 30) / 1_000_000;
  const worstCaseCumulativeCostUsd =
    alreadySpentUsd + worstCasePageCostUsd;
  const actualInputTokens = run?.result.metadata.inputTokens ?? null;

  process.stdout.write(
    `${JSON.stringify(
      {
        document: document.relativePath,
        pageNumber,
        model,
        idempotencyKey,
        includeDocumentMetadata,
        components: {
          systemPrompt: {
            bytes: systemPromptBytes,
            approximateTokens: approximateTokens(systemPromptBytes)
          },
          jsonSchema: {
            bytes: schemaBytes,
            approximateTokens: approximateTokens(schemaBytes)
          },
          requestMetadata: {
            bytes: baseBytes,
            approximateTokens: approximateTokens(baseBytes)
          },
          pageTextItems: {
            bytes: textItemBytes,
            approximateTokens: approximateTokens(textItemBytes)
          },
          geometry: {
            bytes: geometryBytes,
            approximateTokens: approximateTokens(geometryBytes)
          },
          completeJsonRequest: {
            bytes: requestBytes,
            approximateTokens: approximateTokens(requestBytes)
          },
          renderedPageImage: {
            bytes: pageImageBytes,
            tokenCountNotLocallyAvailable: true
          }
        },
        estimatedNonImageTokens,
        configuredMaxOutputTokens,
        worstCasePageCostUsd,
        alreadySpentUsd,
        worstCaseCumulativeCostUsd,
        cumulativeAllowanceUsd: Number.isFinite(cumulativeAllowanceUsd)
          ? cumulativeAllowanceUsd
          : null,
        costGatePasses:
          !Number.isFinite(cumulativeAllowanceUsd) ||
          worstCaseCumulativeCostUsd <= cumulativeAllowanceUsd,
        actual: run
          ? {
              inputTokens: actualInputTokens,
              outputTokens: run.result.metadata.outputTokens,
              cachedTokens: run.result.metadata.cachedTokens,
              residualInputTokensBeyondLocalTextEstimate:
                actualInputTokens === null
                  ? null
                  : Math.max(0, actualInputTokens - estimatedNonImageTokens)
            }
          : null
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
