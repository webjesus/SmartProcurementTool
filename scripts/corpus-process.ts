import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  OfficialOpenAiExtractionAdapter,
  type AiRunMetadata,
  type ExtractionResult
} from "../src/ai/openai-extraction-adapter";
import {
  BASIS_PROMPT_VERSION,
  type PilotAnalysis,
  PROMPT_VERSION,
  type Discipline,
  type DocumentType,
  type EvidenceReference,
  type ExtractionEnvelope,
  type OfferLine
} from "../src/domain/contracts";
import {
  buildBasisRecommendations,
  buildSupplierOptions,
  isMatchingSourceDocumentType,
  proposeMatches,
  type OfferLineContext
} from "../src/domain/matching";
import {
  canonicalizeExtractionEvidence,
  canMachineValidate,
  validatePageExtraction,
  type ValidationIssue
} from "../src/domain/validation";
import { PdfJsDocumentParser } from "../src/pdf/pdfjs-parser";
import {
  LocalDocumentStorage,
  LocalPilotPersistence,
  type PersistedPilotRun
} from "../src/storage/document-storage";

type Manifest = {
  documents: Array<{
    id: string;
    relativePath: string;
    sha256: string;
    documentType: string;
    discipline: string;
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
const recheck = args.has("--recheck");
const nativeTextOnly = args.has("--native-text-only");
const includeDocumentMetadata = !args.has("--no-metadata");
const analyze = args.has("--analyze");
const documentSelector = args.get("--document");
const pageSelector = Number(args.get("--page") ?? 0);
const requestedLimit = Number(args.get("--limit") ?? process.env.SPT_MAX_PAGES_PER_RUN ?? 3);
const limit = Math.min(Math.max(requestedLimit, 1), 3);

function comparePosition(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

async function buildPersistedAnalysis(root: string): Promise<void> {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    throw new Error("Set LOCAL_CORPUS_ENABLED=true for local pilot analysis.");
  }
  const basisSelector = args.get("--basis-document");
  const supplierSelectors = (args.get("--supplier-documents") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const basisFrom = args.get("--basis-from");
  const basisTo = args.get("--basis-to");
  if (!basisSelector || supplierSelectors.length < 2 || !basisFrom || !basisTo) {
    throw new Error(
      "--analyze requires --basis-document, two --supplier-documents IDs, --basis-from and --basis-to."
    );
  }
  const persistence = new LocalPilotPersistence(path.resolve(root, ".data"), true);
  const state = await persistence.read();
  const basisRuns = state.runs.filter(
    (run) =>
      isMatchingSourceDocumentType(run.document.documentType) &&
      run.document.documentType === "BASIS_LV" &&
      run.document.id === basisSelector &&
      run.result.metadata.promptVersion === BASIS_PROMPT_VERSION
  );
  const supplierRuns = state.runs
    .filter(
      (run) =>
        isMatchingSourceDocumentType(run.document.documentType) &&
        run.document.documentType === "SUPPLIER_OFFER" &&
        supplierSelectors.includes(run.document.id) &&
        run.result.metadata.promptVersion === PROMPT_VERSION
    )
    .sort(
      (left, right) =>
        supplierSelectors.indexOf(left.document.id) -
          supplierSelectors.indexOf(right.document.id) ||
        left.document.pageNumber - right.document.pageNumber
    );
  const basisPositions = Array.from(
    new Map(
      basisRuns
        .flatMap((run) => run.result.envelope.extraction.basisPositions)
        .filter((position) => !position.heading)
        .filter(
          (position) =>
            comparePosition(position.positionNumber, basisFrom) >= 0 &&
            comparePosition(position.positionNumber, basisTo) <= 0
        )
        .sort((left, right) =>
          comparePosition(left.positionNumber, right.positionNumber)
        )
        .map((position) => [position.positionNumber, position])
    ).values()
  );
  if (basisPositions.length === 0 || basisPositions.length > 20) {
    throw new Error(
      `Selected Basis range produced ${basisPositions.length} positions; expected 1..20.`
    );
  }
  const offers: OfferLineContext[] = supplierRuns.flatMap((run) =>
    run.result.envelope.extraction.offerGroups.flatMap((group) =>
      group.lines.map((line) => ({
        documentId: run.document.id,
        documentLabel: run.document.relativePath,
        line,
        blockingIssueIds: run.validationIssues
          .filter(
            (issue) => issue.lineId === line.id && issue.severity === "BLOCKING"
          )
          .map((issue) => issue.id)
      }))
    )
  );
  let matchLinks = proposeMatches(basisPositions, offers);
  matchLinks = matchLinks.map((link) => ({
    ...link,
    confirmedByOperator: state.matchReviewActions.some(
      (action) =>
        action.action === "CONFIRM_MATCH" &&
        action.basisPositionIds.every((id) => link.basisPositionIds.includes(id)) &&
        action.offerLineIds.every((id) => link.offerLineIds.includes(id))
    )
  }));
  const supplierOptions = buildSupplierOptions({
    basisPositions,
    offers,
    links: matchLinks
  });
  const basisDocument = basisRuns[0]?.document;
  if (!basisDocument) throw new Error("No compact Basis runs found for the selected document.");
  const supplierDocuments = supplierSelectors.map((documentId) => {
    const runs = supplierRuns.filter((run) => run.document.id === documentId);
    if (runs.length === 0) {
      throw new Error(`No compact supplier runs found for ${documentId}.`);
    }
    return {
      id: documentId,
      label: runs[0].document.relativePath,
      pages: Array.from(new Set(runs.map((run) => run.document.pageNumber))).sort(
        (left, right) => left - right
      )
    };
  });
  const generatedAt = new Date().toISOString();
  const analysis: PilotAnalysis = {
    id: `analysis_${createHash("sha256")
      .update(
        JSON.stringify({
          basisSelector,
          supplierSelectors,
          basisFrom,
          basisTo,
          runIds: [...basisRuns, ...supplierRuns].map((run) => run.id)
        })
      )
      .digest("hex")
      .slice(0, 18)}`,
    basisDocumentId: basisSelector,
    basisDocumentLabel: basisDocument.relativePath,
    basisPages: Array.from(new Set(basisRuns.map((run) => run.document.pageNumber))).sort(
      (left, right) => left - right
    ),
    basisPositionFrom: basisFrom,
    basisPositionTo: basisTo,
    supplierDocuments,
    basisPositions,
    matchLinks,
    supplierOptions,
    recommendations: buildBasisRecommendations(basisPositions, supplierOptions),
    generatedAt
  };
  await persistence.saveAnalysis(analysis);
  const statuses = analysis.recommendations.reduce<Record<string, number>>(
    (counts, recommendation) => {
      counts[recommendation.status] = (counts[recommendation.status] ?? 0) + 1;
      return counts;
    },
    {}
  );
  process.stdout.write(
    `ANALYSIS: basis ${basisPositions.length}; supplier lines ${offers.length}; links ${matchLinks.length}; options ${supplierOptions.length}; statuses ${JSON.stringify(statuses)}; persisted ${analysis.id}.\n`
  );
}

async function readLocalEnv(): Promise<Record<string, string>> {
  const content = await readFile(path.resolve(process.cwd(), ".env.local"), "utf8");
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const name = line.slice(0, separator).trim();
        const raw = line.slice(separator + 1).trim();
        const value =
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
            ? raw.slice(1, -1)
            : raw;
        return [name, value];
      })
  );
}

function evidenceReferences(envelope: ExtractionEnvelope): EvidenceReference[] {
  const references: EvidenceReference[] = [];
  for (const metadata of envelope.extraction.documentMetadataCandidates) {
    references.push(...metadata.evidence);
  }
  for (const section of envelope.extraction.sections) references.push(...section.evidence);
  for (const group of envelope.extraction.offerGroups) {
    references.push(...group.evidence);
    for (const adjustment of group.adjustments) references.push(...adjustment.evidence);
    for (const line of group.lines) {
      references.push(...line.evidence);
      for (const candidate of line.moneyCandidates) references.push(...candidate.evidence);
    }
  }
  for (const position of envelope.extraction.basisPositions) {
    references.push(...position.evidence);
  }
  return Array.from(new Map(references.map((reference) => [reference.id, reference])).values());
}

async function persistCrops(
  envelope: ExtractionEnvelope,
  image: Uint8Array,
  runId: string,
  storage: LocalDocumentStorage
): Promise<Record<string, string>> {
  const metadata = await sharp(image).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const assets: Record<string, string> = {};
  if (width === 0 || height === 0) return assets;

  for (const reference of evidenceReferences(envelope)) {
    if (reference.status !== "VISUAL_ONLY_UNCONFIRMED") continue;
    const left = Math.max(0, Math.min(width - 1, Math.floor(reference.region.x * width)));
    const top = Math.max(0, Math.min(height - 1, Math.floor(reference.region.y * height)));
    const cropWidth = Math.max(
      1,
      Math.min(width - left, Math.ceil(reference.region.width * width))
    );
    const cropHeight = Math.max(
      1,
      Math.min(height - top, Math.ceil(reference.region.height * height))
    );
    const safeId = reference.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const key = `crops/${runId}/${safeId}.png`;
    if (!(await storage.exists(key))) {
      const crop = await sharp(image)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .png()
        .toBuffer();
      await storage.put(key, crop, "image/png");
    }
    reference.cropPath = key;
    assets[reference.id] = key;
  }
  return assets;
}

function findLine(run: PersistedPilotRun, lineId?: string): OfferLine | undefined {
  return run.result.envelope.extraction.offerGroups
    .flatMap((group) => group.lines)
    .find((line) => !lineId || line.id === lineId);
}

function requestMode(mode: string, textOnly = false): string {
  if (mode === "DIGITAL") return "native text items only";
  if (mode === "HYBRID" && textOnly) return "native text items only (embedded graphics omitted)";
  if (mode === "HYBRID") return "native text items + high-detail page render";
  return "high-detail page render only";
}

function updateVerificationStatuses(
  envelope: ExtractionEnvelope,
  issues: ValidationIssue[]
): void {
  for (const group of envelope.extraction.offerGroups) {
    for (const line of group.lines) {
      const lineIssues = issues.filter((item) => item.lineId === line.id);
      line.verificationStatus = canMachineValidate(line, lineIssues)
        ? "MACHINE_VALIDATED"
        : "REVIEW_REQUIRED";
    }
  }
  for (const position of envelope.extraction.basisPositions) {
    const positionIssues = issues.filter((item) => item.lineId === position.id);
    position.verificationStatus = positionIssues.some((item) => item.severity === "BLOCKING")
      ? "REVIEW_REQUIRED"
      : "MACHINE_VALIDATED";
  }
}

async function runRecheck(
  adapter: OfficialOpenAiExtractionAdapter,
  persistence: LocalPilotPersistence,
  run: PersistedPilotRun,
  parsedText: string[],
  model: string
): Promise<AiRunMetadata | null> {
  if (run.document.documentType === "BASIS_LV") {
    throw new Error("Targeted supplier recheck cannot run on Basis-LV data.");
  }
  if (run.recheck) {
    process.stdout.write(`recheck skipped: run ${run.id} already has its single semantic recheck.\n`);
    return null;
  }
  const targetIssue = run.validationIssues.find(
    (item) => item.severity === "BLOCKING" && (item.affectedFields?.length ?? 0) > 0
  );
  if (!targetIssue) {
    process.stdout.write(`recheck skipped: run ${run.id} has no eligible blocking issue.\n`);
    return null;
  }
  const line = findLine(run, targetIssue.lineId);
  const basisPosition = run.result.envelope.extraction.basisPositions.find(
    (position) => position.id === targetIssue.lineId
  );
  if (!line && !basisPosition) {
    process.stdout.write(`recheck skipped: issue ${targetIssue.code} has no page entity.\n`);
    return null;
  }
  const entityEvidence = line?.evidence ?? basisPosition?.evidence ?? [];
  const fragmentText = entityEvidence.map((item) => item.sourceText).join("\n");
  const neighboringRows = line
    ? run.result.envelope.extraction.offerGroups
        .flatMap((group) => group.lines)
        .filter((item) => item.id !== line.id)
        .slice(0, 2)
        .map((item) => item.evidence.map((evidence) => evidence.sourceText).join(" "))
    : run.result.envelope.extraction.basisPositions
        .filter((item) => item.id !== basisPosition?.id)
        .slice(0, 2)
        .map((item) => item.evidence.map((evidence) => evidence.sourceText).join(" "));
  const allowedFields =
    targetIssue.affectedFields?.includes("evidence")
      ? line
        ? ["description", "quantity", "unit", "role", "continuation"]
        : ["description", "quantity", "unit", "optional", "alternative"]
      : targetIssue.affectedFields ?? [];
  const cropAsset = entityEvidence
    .map((evidence) => run.cropAssets[evidence.id])
    .find(Boolean);
  const crop = cropAsset
    ? await readFile(path.resolve(process.cwd(), ".data", "pilot-assets", cropAsset))
    : undefined;
  const cropDataUrl = crop
    ? `data:image/png;base64,${Buffer.from(crop).toString("base64")}`
    : undefined;
  const estimatedSize = Buffer.byteLength(
    JSON.stringify({ fragmentText, neighboringRows, issue: targetIssue.code, allowedFields }),
    "utf8"
  ) + (cropDataUrl?.length ?? 0);
  process.stdout.write(
    `REQUEST: model ${model}; document ${run.document.relativePath}; page ${run.document.pageNumber}; targeted fragment; estimated ${estimatedSize} bytes.\n`
  );
  const result = await adapter.recheckIssueWithMetadata({
    issueCodes: [targetIssue.code],
    allowedFields,
    lockedFields: line?.lockedFields ?? [],
    fragmentText,
    headerText: parsedText.slice(0, 16).join(" "),
    neighboringRows,
    cropDataUrl
  });
  run.recheck = result;
  await persistence.saveRun(run);
  process.stdout.write(
    `RESPONSE: ${result.metadata.responseId ?? "n/a"}; input ${result.metadata.inputTokens ?? "n/a"}; output ${result.metadata.outputTokens ?? "n/a"}; cached ${result.metadata.cachedTokens ?? "n/a"}; duration ${result.metadata.durationMs} ms; cost unavailable (no configured pricing table).\n`
  );
  return result.metadata;
}

async function main() {
  const root = process.cwd();
  if (analyze) {
    await buildPersistedAnalysis(root);
    return;
  }
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
    `${dryRun ? "DRY RUN" : recheck ? "RECHECK" : "PROCESS"}: ${eligible.length} document(s), ${pages.length} page(s), hard page limit ${limit}.\n`
  );
  process.stdout.write("Historical result documents excluded; supplier extraction receives no Basis data.\n");
  if (dryRun) {
    const parser = new PdfJsDocumentParser();
    for (const { document, page } of pages) {
      const file = new Uint8Array(
        await readFile(path.resolve(root, process.env.CORPUS_DIR ?? "pdffirma", document.relativePath))
      );
      const parsed = await parser.extractPage(document.id, file, page.pageNumber);
      const image =
        page.mode === "DIGITAL" || (page.mode === "HYBRID" && nativeTextOnly)
          ? undefined
          : await parser.renderPage(file, page.pageNumber, 1.5);
      const textBytes =
        page.mode === "SCAN"
          ? 0
          : Buffer.byteLength(
              JSON.stringify(
                parsed.textItems.map((item) => ({
                  id: item.id,
                  text: item.rawText,
                  order: item.order,
                  region: item.region
                }))
              ),
              "utf8"
            );
      process.stdout.write(
        `PLAN: model ${process.env.OPENAI_EXTRACTION_MODEL ?? "OPENAI_EXTRACTION_MODEL"}; document ${document.relativePath}; page ${page.pageNumber}; ${requestMode(page.mode, nativeTextOnly)}; metadata ${includeDocumentMetadata ? "included" : "omitted"}; estimated ${textBytes + (image?.byteLength ?? 0)} bytes (${parsed.textItems.length} text items, ${image?.byteLength ?? 0} image bytes).\n`
      );
    }
    process.stdout.write("OpenAI used: no. No commercial text or image left this device.\n");
    return;
  }
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    throw new Error("Set LOCAL_CORPUS_ENABLED=true for this local process.");
  }

  const localEnv = await readLocalEnv();
  if (!localEnv.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required in .env.local.");
  process.env.OPENAI_API_KEY = localEnv.OPENAI_API_KEY;
  process.env.OPENAI_EXTRACTION_MODEL =
    localEnv.OPENAI_EXTRACTION_MODEL ?? process.env.OPENAI_EXTRACTION_MODEL;
  process.env.OPENAI_RECHECK_MODEL =
    localEnv.OPENAI_RECHECK_MODEL ?? process.env.OPENAI_RECHECK_MODEL;
  if (!process.env.OPENAI_EXTRACTION_MODEL || !process.env.OPENAI_RECHECK_MODEL) {
    throw new Error(
      "Add OPENAI_EXTRACTION_MODEL=gpt-5.6-sol and OPENAI_RECHECK_MODEL=gpt-5.6-sol to .env.local, or pass both variables to this process."
    );
  }

  const adapter = new OfficialOpenAiExtractionAdapter(localEnv.OPENAI_API_KEY);
  const parser = new PdfJsDocumentParser();
  const persistence = new LocalPilotPersistence(path.resolve(root, ".data"), true);
  const assetStorage = new LocalDocumentStorage(path.resolve(root, ".data", "pilot-assets"), true);
  const legacyCacheDir = path.resolve(root, ".data", "extractions");
  await mkdir(legacyCacheDir, { recursive: true });
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let cacheHits = 0;
  let issueCount = 0;

  for (const { document, page } of pages) {
    if (page.mode === "UNREADABLE") {
      issueCount += 1;
      process.stdout.write(`blocking issue: unreadable ${document.id} page ${page.pageNumber}\n`);
      continue;
    }
    const file = new Uint8Array(
      await readFile(path.resolve(root, process.env.CORPUS_DIR ?? "pdffirma", document.relativePath))
    );
    const parsed = await parser.extractPage(document.id, file, page.pageNumber);
    const state = await persistence.read();
    const existing = state.runs.find(
      (run) =>
        run.document.id === document.id &&
        run.document.pageNumber === page.pageNumber &&
        run.result.metadata.modelId === process.env.OPENAI_EXTRACTION_MODEL &&
        run.result.metadata.promptVersion ===
          (document.documentType === "BASIS_LV"
            ? BASIS_PROMPT_VERSION
            : PROMPT_VERSION)
    );
    if (existing) {
      cacheHits += 1;
      process.stdout.write(`cache hit: ${document.id} page ${page.pageNumber}, run ${existing.id}\n`);
      if (recheck) {
        const recheckMetadata = await runRecheck(
          adapter,
          persistence,
          existing,
          parsed.textItems.map((item) => item.rawText),
          process.env.OPENAI_RECHECK_MODEL
        );
        inputTokens += recheckMetadata?.inputTokens ?? 0;
        outputTokens += recheckMetadata?.outputTokens ?? 0;
        cachedTokens += recheckMetadata?.cachedTokens ?? 0;
      }
      continue;
    }
    if (recheck) {
      throw new Error("Run the initial extraction before --recheck.");
    }

    let requestImage: Uint8Array | undefined;
    if (page.mode !== "DIGITAL" && !(page.mode === "HYBRID" && nativeTextOnly)) {
      requestImage = await parser.renderPage(file, page.pageNumber, 1.5);
    }
    const estimatedTextBytes =
      page.mode === "SCAN"
        ? 0
        : Buffer.byteLength(
            JSON.stringify(
              parsed.textItems.map((item) => ({
                id: item.id,
                text: item.rawText,
                order: item.order,
                region: item.region
              }))
            ),
            "utf8"
          );
    const estimatedSize = estimatedTextBytes + (requestImage?.byteLength ?? 0);
    process.stdout.write(
      `REQUEST: model ${process.env.OPENAI_EXTRACTION_MODEL}; document ${document.relativePath}; page ${page.pageNumber}; ${requestMode(page.mode, nativeTextOnly)}; metadata ${includeDocumentMetadata ? "included" : "omitted"}; estimated ${estimatedSize} bytes (${parsed.textItems.length} text items, ${requestImage?.byteLength ?? 0} image bytes).\n`
    );

    const extractionInput = {
      documentId: document.id,
      page: parsed,
      pageImageDataUrl: requestImage
        ? `data:image/png;base64,${Buffer.from(requestImage).toString("base64")}`
        : undefined,
      documentType: document.documentType as DocumentType,
      discipline: document.discipline as Discipline,
      includeDocumentMetadata
    };
    const rawResult: ExtractionResult =
      document.documentType === "BASIS_LV"
        ? await adapter.extractBasisPageWithMetadata(extractionInput)
        : await adapter.extractPageWithMetadata(extractionInput);
    const trustedEnvelope = {
      ...rawResult.envelope,
      promptVersion: rawResult.metadata.promptVersion,
      schemaVersion: rawResult.metadata.schemaVersion,
      preprocessingVersion: rawResult.metadata.preprocessingVersion
    };
    const envelope = canonicalizeExtractionEvidence(trustedEnvelope, document.id, parsed);
    const validationIssues = validatePageExtraction(envelope, parsed);
    updateVerificationStatuses(envelope, validationIssues);
    const result = { ...rawResult, envelope };
    const runId = `run_${createHash("sha256")
      .update(`${rawResult.metadata.cacheKey}:${document.sha256}`)
      .digest("hex")
      .slice(0, 18)}`;
    const pageImage = requestImage ?? (await parser.renderPage(file, page.pageNumber, 1.5));
    const pageImageAsset = `pages/${runId}.png`;
    if (!(await assetStorage.exists(pageImageAsset))) {
      await assetStorage.put(pageImageAsset, pageImage, "image/png");
    }
    const cropAssets = await persistCrops(envelope, pageImage, runId, assetStorage);
    const run: PersistedPilotRun = {
      id: runId,
      document: {
        id: document.id,
        relativePath: document.relativePath,
        pageNumber: page.pageNumber,
        pageCount: document.pages.length,
        pageMode: page.mode,
        documentType: document.documentType,
        discipline: document.discipline
      },
      result,
      validationIssues,
      pageImageAsset,
      cropAssets,
      recheck: null,
      createdAt: new Date().toISOString()
    };
    await persistence.saveRun(run);
    await writeFile(
      path.join(legacyCacheDir, `${rawResult.metadata.cacheKey}.local.json`),
      JSON.stringify(run, null, 2),
      "utf8"
    );

    inputTokens += result.metadata.inputTokens ?? 0;
    outputTokens += result.metadata.outputTokens ?? 0;
    cachedTokens += result.metadata.cachedTokens ?? 0;
    issueCount += validationIssues.length;
    process.stdout.write(
      `RESPONSE: ${result.metadata.responseId ?? "n/a"}; input ${result.metadata.inputTokens ?? "n/a"}; output ${result.metadata.outputTokens ?? "n/a"}; cached ${result.metadata.cachedTokens ?? "n/a"}; lines ${result.metadata.extractedLineCount ?? "n/a"}; output/line ${result.metadata.outputTokensPerExtractedLine?.toFixed(1) ?? "n/a"}; cost $${result.metadata.estimatedCostUsd?.toFixed(6) ?? "n/a"}; cost/line $${result.metadata.costPerExtractedLineUsd?.toFixed(6) ?? "n/a"}; duration ${result.metadata.durationMs} ms; validation issues ${validationIssues.length}.\n`
    );
  }

  process.stdout.write(
    `Completed. input tokens ${inputTokens}, output tokens ${outputTokens}, cached tokens ${cachedTokens}, cache hits ${cacheHits}, validation issues ${issueCount}.\n`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
