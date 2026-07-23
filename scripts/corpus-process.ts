import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { OfficialOpenAiExtractionAdapter } from "../src/ai/openai-extraction-adapter";
import { PdfJsDocumentParser } from "../src/pdf/pdfjs-parser";

type Manifest = {
  documents: Array<{
    id: string;
    relativePath: string;
    sha256: string;
    documentType: string;
    pages: Array<{ pageNumber: number; mode: "DIGITAL" | "SCAN" | "HYBRID" | "UNREADABLE" }>;
  }>;
};

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=") || "true"];
  })
);
const dryRun = args.has("--dry-run");
const documentSelector = args.get("--document");
const pageSelector = Number(args.get("--page") ?? 0);
const limit = Number(args.get("--limit") ?? process.env.SPT_MAX_PAGES_PER_RUN ?? 8);

async function main() {
  const root = process.cwd();
  const manifest = JSON.parse(
    await readFile(path.resolve(root, ".data", "corpus-manifest.local.json"), "utf8")
  ) as Manifest;
  const eligible = manifest.documents.filter(
    (document) =>
      !["HISTORICAL_CALCULATION", "FINAL_DECISION"].includes(document.documentType) &&
      (!documentSelector ||
        document.id === documentSelector ||
        document.relativePath.toLowerCase().includes(documentSelector.toLowerCase()))
  );

  if (eligible.length === 0) throw new Error("No eligible document matches --document.");
  if (!documentSelector && !dryRun) {
    throw new Error("Select one document with --document=<id-or-name> before using OpenAI.");
  }

  const pages = eligible
    .flatMap((document) => document.pages.map((page) => ({ document, page })))
    .filter(({ page }) => pageSelector === 0 || page.pageNumber === pageSelector)
    .slice(0, limit);
  process.stdout.write(
    `${dryRun ? "DRY RUN" : "PROCESS"}: ${eligible.length} document(s), ${pages.length} page(s), page limit ${limit}.\n`
  );
  process.stdout.write("Historical result documents excluded from extraction and matching.\n");
  if (dryRun) {
    process.stdout.write("OpenAI used: no. No commercial text or image left this device.\n");
    return;
  }
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    throw new Error("Set LOCAL_CORPUS_ENABLED=true to process the confidential local corpus.");
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for processing.");

  const adapter = new OfficialOpenAiExtractionAdapter();
  const parser = new PdfJsDocumentParser();
  const cacheDir = path.resolve(root, ".data", "extractions");
  await mkdir(cacheDir, { recursive: true });
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedPages = 0;
  let issues = 0;

  for (const { document, page } of pages) {
    const cacheKey = createHash("sha256")
      .update(`${document.sha256}:${page.pageNumber}:extraction-contract-v1:supplier-page-extraction-v1`)
      .digest("hex");
    const cachePath = path.join(cacheDir, `${cacheKey}.local.json`);
    try {
      await readFile(cachePath, "utf8");
      cachedPages += 1;
      process.stdout.write(`cache hit: ${document.id} page ${page.pageNumber}\n`);
      continue;
    } catch {
      // Cache miss is expected.
    }

    if (page.mode === "UNREADABLE") {
      issues += 1;
      process.stdout.write(`blocking issue: unreadable ${document.id} page ${page.pageNumber}\n`);
      continue;
    }

    const file = new Uint8Array(
      await readFile(path.resolve(root, process.env.CORPUS_DIR ?? "pdffirma", document.relativePath))
    );
    const parsed = await parser.extractPage(document.id, file, page.pageNumber);
    let pageImageDataUrl: string | undefined;
    if (page.mode !== "DIGITAL") {
      const image = await parser.renderPage(file, page.pageNumber, 1.5);
      pageImageDataUrl = `data:image/png;base64,${Buffer.from(image).toString("base64")}`;
    }

    const extractionInput = {
      documentId: document.id,
      page: parsed,
      pageImageDataUrl
    };
    const result =
      document.documentType === "BASIS_LV"
        ? await adapter.extractBasisPageWithMetadata(extractionInput)
        : await adapter.extractPageWithMetadata(extractionInput);
    inputTokens += result.metadata.inputTokens ?? 0;
    outputTokens += result.metadata.outputTokens ?? 0;
    issues += result.envelope.extraction.unresolvedNotes.length;
    await writeFile(cachePath, JSON.stringify(result, null, 2), "utf8");
    process.stdout.write(
      `processed: ${document.id} page ${page.pageNumber}, input ${result.metadata.inputTokens ?? "n/a"}, output ${result.metadata.outputTokens ?? "n/a"}\n`
    );
  }

  process.stdout.write(
    `Completed. input tokens ${inputTokens}, output tokens ${outputTokens}, cache hits ${cachedPages}, unresolved issues ${issues}, estimated cost unavailable without an approved live pricing table.\n`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
