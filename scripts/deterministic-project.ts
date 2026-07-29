import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildBasisRecommendations,
  buildSupplierOptions,
  proposeMatches,
  type OfferLineContext
} from "../src/domain/matching";
import { buildBasisScopeProfiles } from "../src/domain/basis-scope";
import {
  buildPositionSupplierCoverage,
  buildProjectReviewPositions
} from "../src/domain/project-review";
import type {
  Discipline,
  DocumentType,
  PilotAnalysis,
  SupplierDecision
} from "../src/domain/contracts";
import {
  DETERMINISTIC_BASIS_DOCUMENT_PARSER_VERSION,
  DETERMINISTIC_SUPPLIER_DOCUMENT_PARSER_VERSION,
  extractBasisDocumentDeterministically,
  extractSupplierDocumentDeterministically,
  type DeterministicBasisDocumentResult,
  type DeterministicDocumentPageResult,
  type DeterministicSupplierDocumentResult
} from "../src/pdf/deterministic-document-extraction";
import { PdfJsDocumentParser } from "../src/pdf/pdfjs-parser";
import {
  LocalDocumentStorage,
  LocalPilotPersistence,
  type PersistedPilotRun
} from "../src/storage/document-storage";

type ManifestDocument = {
  id: string;
  relativePath: string;
  sha256: string;
  documentType: DocumentType;
  discipline: Discipline;
  projectKey?: string;
  supplier?: string;
  revision?: number;
  active?: boolean;
  supersededByDocumentId?: string;
  relevantPositionNumbers?: string[];
  pages: Array<{ pageNumber: number; mode: string }>;
};

type Manifest = {
  generatedAt: string;
  documents: ManifestDocument[];
};

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=") || "true"];
  })
);
const projectKey = args.get("--project") ?? "project-heating-a";
const dryRun = args.has("--dry-run");
const skipRender = args.has("--skip-render");

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizePosition(value: string): string {
  const parts = value.match(/\d+/g)?.slice(0, 3).map(Number);
  return parts?.length === 3 ? parts.join(".") : value.trim();
}

function comparePosition(left: string, right: string): number {
  const a = normalizePosition(left).split(".").map(Number);
  const b = normalizePosition(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function assertProjectDocuments(documents: readonly ManifestDocument[]): {
  basis: ManifestDocument;
  suppliers: ManifestDocument[];
} {
  const scoped = documents.filter(
    (document) =>
      document.projectKey === projectKey &&
      document.discipline === "HEIZUNG" &&
      document.active !== false &&
      !document.supersededByDocumentId
  );
  const basis = scoped.filter(
    (document) => document.documentType === "BASIS_LV"
  );
  const suppliers = scoped.filter((document) =>
    ["SUPPLIER_OFFER", "SPECIALIZED_SUPPLIER_OFFER"].includes(
      document.documentType
    )
  );
  if (basis.length !== 1) {
    throw new Error(
      `Project gate expected exactly one active HEIZUNG Basis document, found ${basis.length}.`
    );
  }
  const expectedSuppliers = new Set(["Gienger", "P&M", "Reisser", "Weishaupt"]);
  const actualSuppliers = new Set(suppliers.map((document) => document.supplier));
  if (
    suppliers.length !== 4 ||
    [...expectedSuppliers].some((supplier) => !actualSuppliers.has(supplier))
  ) {
    throw new Error(
      `Project gate expected Gienger, P&M, Reisser and Weishaupt only; found ${[
        ...actualSuppliers
      ].join(", ")}.`
    );
  }
  const pum = suppliers.find((document) => document.supplier === "P&M");
  if (!pum || pum.revision !== 2) {
    throw new Error("Active revision gate requires P&M revision 2.");
  }
  return { basis: basis[0], suppliers };
}

async function parseDocumentPages(
  parser: PdfJsDocumentParser,
  document: ManifestDocument,
  root: string
) {
  const bytes = new Uint8Array(
    await readFile(
      path.resolve(
        root,
        process.env.CORPUS_DIR ?? "pdffirma",
        document.relativePath
      )
    )
  );
  const pages = [];
  for (const page of document.pages) {
    pages.push(
      await parser.extractPage(document.id, bytes, page.pageNumber)
    );
  }
  return { bytes, pages };
}

function buildRun(input: {
  document: ManifestDocument;
  result: DeterministicDocumentPageResult;
  parserVersion: string;
  pageImageAsset: string;
  startedAt: string;
  completedAt: string;
}): PersistedPilotRun {
  const cacheKey = stableHash({
    method: "DETERMINISTIC_TEXT_LAYER",
    documentId: input.document.id,
    pageNumber: input.result.pageNumber,
    rawTextItemsHash: input.result.provenance.rawTextItemsHash,
    parserVersion: input.parserVersion
  });
  const runId = `run_${stableHash({
    documentSha256: input.document.sha256,
    rawTextItemsHash: input.result.provenance.rawTextItemsHash,
    parserVersion: input.parserVersion
  }).slice(0, 18)}`;
  return {
    id: runId,
    document: {
      id: input.document.id,
      relativePath: input.document.relativePath,
      pageNumber: input.result.pageNumber,
      pageCount: input.document.pages.length,
      pageMode: input.result.envelope.extraction.pageMode,
      documentType: input.document.documentType,
      discipline: input.document.discipline
    },
    result: {
      envelope: input.result.envelope,
      metadata: {
        modelId: "local-deterministic",
        responseId: null,
        promptVersion: input.parserVersion,
        schemaVersion: input.result.envelope.schemaVersion,
        preprocessingVersion: input.result.envelope.preprocessingVersion,
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        durationMs:
          new Date(input.completedAt).getTime() -
          new Date(input.startedAt).getTime(),
        attempt: 0,
        estimatedCostUsd: 0,
        error: null,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        cacheKey,
        extractedLineCount: input.result.parsedRecordCount,
        inputTokensPerPage: null,
        outputTokensPerExtractedLine: null,
        costPerExtractedLineUsd: 0
      }
    },
    validationIssues: input.result.validationIssues,
    pageImageAsset: input.pageImageAsset,
    cropAssets: {},
    recheck: null,
    provenance: input.result.provenance,
    createdAt: input.completedAt
  };
}

async function writeImmutableCache(
  root: string,
  run: PersistedPilotRun
): Promise<void> {
  const cacheDir = path.resolve(root, ".data", "deterministic-extractions");
  await mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(
    cacheDir,
    `${run.result.metadata.cacheKey}.local.json`
  );
  try {
    await writeFile(cachePath, JSON.stringify(run, null, 2), {
      flag: "wx"
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(cachePath, "utf8"));
    if (JSON.stringify(existing) !== JSON.stringify(run)) {
      throw new Error(`Deterministic cache conflict: ${cachePath}`);
    }
  }
}

function buildAnalysis(input: {
  basisDocument: ManifestDocument;
  supplierDocuments: ManifestDocument[];
  basisResult: DeterministicBasisDocumentResult;
  runs: readonly PersistedPilotRun[];
  decisions?: readonly SupplierDecision[];
  generatedAt: string;
}): {
  analysis: PilotAnalysis;
  review: ReturnType<typeof buildProjectReviewPositions>;
  coverageDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
} {
  const basisPages = input.basisResult.pages.map((pageResult) => ({
    pageNumber: pageResult.pageNumber,
    positions: [
      ...input.basisResult.leafPositions,
      ...input.basisResult.headingPositions
    ].filter((position) =>
      position.evidence.some(
        (reference, index) =>
          index === 0 && reference.pageNumber === pageResult.pageNumber
      )
    ),
    sections: input.basisResult.sections.filter(
      (section) =>
        section.evidence[0]?.pageNumber === pageResult.pageNumber
    )
  }));
  const basisPositions = buildBasisScopeProfiles({
    positions: input.basisResult.leafPositions,
    pages: basisPages
  }).sort((left, right) =>
    comparePosition(left.positionNumber, right.positionNumber)
  );
  const supplierIds = new Set(
    input.supplierDocuments.map((document) => document.id)
  );
  const offers: OfferLineContext[] = input.runs
    .filter((run) => supplierIds.has(run.document.id))
    .flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => ({
          documentId: run.document.id,
          documentLabel:
            input.supplierDocuments.find(
              (document) => document.id === run.document.id
            )?.supplier ?? run.document.relativePath,
          line,
          blockingIssueIds: ["OPTIONAL", "ALTERNATIVE"].includes(line.role)
            ? []
            : run.validationIssues
                .filter(
                  (candidate) =>
                    candidate.lineId === line.id &&
                    candidate.severity === "BLOCKING"
                )
                .map((candidate) => candidate.id)
        }))
      )
    );
  const matchLinks = proposeMatches(basisPositions, offers);
  const unfilteredOptions = buildSupplierOptions({
    basisPositions,
    offers,
    links: matchLinks,
    fullyProcessedSupplierDocumentIds: new Set(
      input.supplierDocuments.map((document) => document.id)
    )
  });
  const specialized = input.supplierDocuments.find(
    (document) => document.documentType === "SPECIALIZED_SUPPLIER_OFFER"
  );
  const specializedRelevant = new Set(
    specialized?.relevantPositionNumbers?.map(normalizePosition) ?? []
  );
  const basisById = new Map(
    basisPositions.map((position) => [position.id, position])
  );
  const supplierOptions = unfilteredOptions.filter((option) => {
    if (option.supplierDocumentId !== specialized?.id) return true;
    return option.basisPositionIds.some((basisId) => {
      const basis = basisById.get(basisId);
      return basis
        ? specializedRelevant.has(normalizePosition(basis.positionNumber))
        : false;
    });
  });
  const analysis: PilotAnalysis = {
    id: `analysis_${stableHash({
      basis: basisPositions.map((position) => position.id),
      offers: offers.map((offer) => offer.line.id),
      parserVersions: [
        DETERMINISTIC_BASIS_DOCUMENT_PARSER_VERSION,
        DETERMINISTIC_SUPPLIER_DOCUMENT_PARSER_VERSION
      ]
    }).slice(0, 18)}`,
    basisDocumentId: input.basisDocument.id,
    basisDocumentLabel: input.basisDocument.relativePath,
    basisPages: input.basisDocument.pages.map((page) => page.pageNumber),
    basisPositionFrom: basisPositions[0]?.positionNumber ?? "",
    basisPositionTo: basisPositions.at(-1)?.positionNumber ?? "",
    supplierDocuments: input.supplierDocuments.map((document) => ({
      id: document.id,
      label: document.supplier ?? document.relativePath,
      pages: document.pages.map((page) => page.pageNumber)
    })),
    basisPositions,
    matchLinks,
    supplierOptions,
    recommendations: buildBasisRecommendations(
      basisPositions,
      supplierOptions
    ),
    generatedAt: input.generatedAt
  };
  const coverageDocuments = input.supplierDocuments.map((document) => ({
    id: document.id,
    role: document.documentType as
      | "SUPPLIER_OFFER"
      | "SPECIALIZED_SUPPLIER_OFFER",
    processed: true,
    scope:
      document.documentType === "SUPPLIER_OFFER"
        ? ({ status: "ALL" } as const)
        : ({
            status: "LISTED",
            basisPositionIds: basisPositions
              .filter((position) =>
                specializedRelevant.has(
                  normalizePosition(position.positionNumber)
                )
              )
              .map((position) => position.id)
          } as const)
  }));
  const coverageByBasisId = Object.fromEntries(
    basisPositions.map((basis) => [
      basis.id,
      buildPositionSupplierCoverage({
        basisPositionId: basis.id,
        documents: coverageDocuments,
        options: supplierOptions.filter((option) =>
          option.basisPositionIds.includes(basis.id)
        )
      })
    ])
  );
  const allCoverageSufficient = Object.values(coverageByBasisId).every(
    (coverage) => coverage.coverageStatus === "SUFFICIENT"
  );
  const review = buildProjectReviewPositions({
    basisPositions,
    options: supplierOptions,
    coverage: {
      activeSupplierDocumentIds: new Set(
        input.supplierDocuments.map((document) => document.id)
      ),
      allRelevantOffersProcessed: allCoverageSufficient,
      supplierCoverageSufficient: allCoverageSufficient,
      projectContextConfirmed: true,
      disciplineContextConfirmed: true,
      materialUncertainty: false
    },
    coverageByBasisId,
    decisions: input.decisions ?? [],
    calculatedAt: input.generatedAt
  });
  const coverageDistribution = Object.values(coverageByBasisId).reduce<
    Record<string, number>
  >((counts, coverage) => {
    counts[coverage.coverageStatus] =
      (counts[coverage.coverageStatus] ?? 0) + 1;
    return counts;
  }, {});
  const statusDistribution = review.reduce<Record<string, number>>(
    (counts, position) => {
      counts[position.liveStatus] =
        (counts[position.liveStatus] ?? 0) + 1;
      return counts;
    },
    {}
  );
  return { analysis, review, coverageDistribution, statusDistribution };
}

const CONTROL_POSITION_NUMBERS = new Set([
  "2.1.730",
  "2.1.740",
  "2.1.750",
  "2.1.760",
  "2.1.770",
  "2.1.780",
  "2.1.790",
  "2.1.800",
  "2.1.810",
  "2.1.820"
]);

function changedControlOptionIds(
  previous: PilotAnalysis | null,
  current: PilotAnalysis
) {
  if (!previous) return [];
  const previousOptions = new Map<string, string>(
    previous.supplierOptions
      .flatMap((option) => {
        const basisPosition = previous.basisPositions.find((position) =>
          option.basisPositionIds.includes(position.id)
        );
        return basisPosition &&
          CONTROL_POSITION_NUMBERS.has(
            normalizePosition(basisPosition.positionNumber)
          )
          ? [
              [
                `${normalizePosition(
                  basisPosition.positionNumber
                )}:${option.supplierDocumentId}`,
                option.id
              ] as const
            ]
          : [];
      })
  );
  return current.supplierOptions.flatMap((option) => {
    const basisPosition = current.basisPositions.find((position) =>
      option.basisPositionIds.includes(position.id)
    );
    if (
      !basisPosition ||
      !CONTROL_POSITION_NUMBERS.has(
        normalizePosition(basisPosition.positionNumber)
      )
    ) {
      return [];
    }
    const key = `${normalizePosition(
      basisPosition.positionNumber
    )}:${option.supplierDocumentId}`;
    const previousId = previousOptions.get(key);
    return previousId && previousId !== option.id
      ? [
          {
            position: basisPosition.positionNumber,
            supplierDocumentId: option.supplierDocumentId,
            previousId,
            currentId: option.id
          }
        ]
      : [];
  });
}

async function main() {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    throw new Error(
      "Set LOCAL_CORPUS_ENABLED=true for local deterministic project processing."
    );
  }
  const root = process.cwd();
  const manifest = JSON.parse(
    await readFile(
      path.resolve(root, ".data", "corpus-manifest.local.json"),
      "utf8"
    )
  ) as Manifest;
  const { basis, suppliers } = assertProjectDocuments(manifest.documents);
  const orderedDocuments = [
    basis,
    ...suppliers.sort((left, right) =>
      (left.supplier ?? "").localeCompare(right.supplier ?? "", "de")
    )
  ];
  const persistence = new LocalPilotPersistence(
    path.resolve(root, ".data"),
    true
  );
  const stateBefore = await persistence.read();
  const decisionsBefore = JSON.stringify(stateBefore.supplierDecisions);
  const decisionReviewBefore = JSON.stringify(
    stateBefore.supplierDecisionReviewActions
  );
  const existingPositionIdsByNumber = Object.fromEntries(
    (stateBefore.analysis?.basisPositions ?? []).map((position) => [
      normalizePosition(position.positionNumber),
      position.id
    ])
  );
  const existingPages = new Set(
    stateBefore.runs.map(
      (run) => `${run.document.id}:${run.document.pageNumber}`
    )
  );
  const parser = new PdfJsDocumentParser();
  const assetStorage = new LocalDocumentStorage(
    path.resolve(root, ".data", "pilot-assets"),
    true
  );
  const runsToAppend: PersistedPilotRun[] = [];
  let basisResult: DeterministicBasisDocumentResult | null = null;
  const supplierResults = new Map<
    string,
    DeterministicSupplierDocumentResult
  >();
  const documentReports: Array<Record<string, unknown>> = [];

  for (const document of orderedDocuments) {
    const startedAt = new Date().toISOString();
    const parsed = await parseDocumentPages(parser, document, root);
    const result =
      document.documentType === "BASIS_LV"
        ? extractBasisDocumentDeterministically({
            documentId: document.id,
            documentRevisionId: document.id,
            pages: parsed.pages,
            discipline: document.discipline,
            existingPositionIdsByNumber,
            createdAt: startedAt
          })
        : extractSupplierDocumentDeterministically({
            documentId: document.id,
            documentRevisionId: document.id,
            documentType: document.documentType as
              | "SUPPLIER_OFFER"
              | "SPECIALIZED_SUPPLIER_OFFER",
            discipline: document.discipline,
            pages: parsed.pages,
            createdAt: startedAt
          });
    if (document.documentType === "BASIS_LV") {
      basisResult = result as DeterministicBasisDocumentResult;
    } else {
      supplierResults.set(
        document.id,
        result as DeterministicSupplierDocumentResult
      );
    }
    const parserVersion =
      document.documentType === "BASIS_LV"
        ? DETERMINISTIC_BASIS_DOCUMENT_PARSER_VERSION
        : DETERMINISTIC_SUPPLIER_DOCUMENT_PARSER_VERSION;
    const pageResults = result.pages;
    const missingPageResults = pageResults.filter(
      (pageResult) =>
        !existingPages.has(`${document.id}:${pageResult.pageNumber}`)
    );
    for (const pageResult of missingPageResults) {
      const completedAt = new Date().toISOString();
      const provisionalRunId = `run_${stableHash({
        documentSha256: document.sha256,
        rawTextItemsHash: pageResult.provenance.rawTextItemsHash,
        parserVersion
      }).slice(0, 18)}`;
      const pageImageAsset = `pages/${provisionalRunId}.png`;
      if (!dryRun && !skipRender && !(await assetStorage.exists(pageImageAsset))) {
        await assetStorage.put(
          pageImageAsset,
          await parser.renderPage(parsed.bytes, pageResult.pageNumber, 1.25),
          "image/png"
        );
      }
      const run = buildRun({
        document,
        result: pageResult,
        parserVersion,
        pageImageAsset,
        startedAt,
        completedAt
      });
      if (!dryRun) await writeImmutableCache(root, run);
      runsToAppend.push(run);
    }
    documentReports.push({
      documentId: document.id,
      document: document.relativePath,
      pages: document.pages.length,
      cachedPages: document.pages.length - missingPageResults.length,
      newDeterministicPages: missingPageResults.length,
      parsedRecords:
        document.documentType === "BASIS_LV"
          ? (result as DeterministicBasisDocumentResult).metrics
              .totalValidLeafPositions
          : (result as DeterministicSupplierDocumentResult).metrics.parsedLines,
      fallbackCandidates:
        document.documentType === "BASIS_LV"
          ? (result as DeterministicBasisDocumentResult).metrics.unresolvedBlocks
          : (result as DeterministicSupplierDocumentResult).metrics
              .fallbackCandidateIds,
      layout:
        document.documentType === "BASIS_LV"
          ? "BASIS_HIERARCHY"
          : (result as DeterministicSupplierDocumentResult).layout
    });
  }

  if (!basisResult) throw new Error("Basis deterministic result is missing.");
  const proposed = buildAnalysis({
    basisDocument: basis,
    supplierDocuments: suppliers,
    basisResult,
    runs: [...stateBefore.runs, ...runsToAppend],
    decisions: stateBefore.supplierDecisions,
    generatedAt: new Date().toISOString()
  });
  const proposedControlChanges = changedControlOptionIds(
    stateBefore.analysis,
    proposed.analysis
  );
  if (proposedControlChanges.length > 0) {
    throw new Error(
      `Control option IDs changed: ${JSON.stringify(
        proposedControlChanges
      )}`
    );
  }
  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          projectKey,
          documents: documentReports,
          newRuns: runsToAppend.length,
          basis: basisResult.metrics,
          suppliers: Object.fromEntries(
            [...supplierResults.entries()].map(([id, result]) => [
              id,
              result.metrics
            ])
          ),
          analysisPreview: {
            basisLeafPositions: proposed.analysis.basisPositions.length,
            matchLinks: proposed.analysis.matchLinks.length,
            supplierOptions: proposed.analysis.supplierOptions.length,
            coverageDistribution: proposed.coverageDistribution,
            statusDistribution: proposed.statusDistribution,
            changedControlOptionIds: proposedControlChanges
          },
          openAiCalls: 0,
          tokens: 0,
          costUsd: 0,
          persisted: false
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const appendResult = await persistence.appendImmutableRuns(runsToAppend);
  const stateWithRuns = await persistence.read();
  const generatedAt = proposed.analysis.generatedAt;
  const rebuilt = buildAnalysis({
    basisDocument: basis,
    supplierDocuments: suppliers,
    basisResult,
    runs: stateWithRuns.runs,
    decisions: stateBefore.supplierDecisions,
    generatedAt
  });
  const persistedControlChanges = changedControlOptionIds(
    stateBefore.analysis,
    rebuilt.analysis
  );
  if (persistedControlChanges.length > 0) {
    throw new Error(
      `Persisted control option IDs changed: ${JSON.stringify(
        persistedControlChanges
      )}`
    );
  }
  await persistence.saveAnalysis(rebuilt.analysis);
  const stateAfter = await persistence.read();
  if (
    JSON.stringify(stateAfter.supplierDecisions) !== decisionsBefore ||
    JSON.stringify(stateAfter.supplierDecisionReviewActions) !==
      decisionReviewBefore
  ) {
    throw new Error("Decision history changed during deterministic rebuild.");
  }
  const reviewWithDecisions = buildProjectReviewPositions({
    basisPositions: rebuilt.analysis.basisPositions,
    options: rebuilt.analysis.supplierOptions,
    coverage: {
      activeSupplierDocumentIds: new Set(
        suppliers.map((document) => document.id)
      ),
      allRelevantOffersProcessed: true,
      supplierCoverageSufficient: true,
      projectContextConfirmed: true,
      disciplineContextConfirmed: true,
      materialUncertainty: false
    },
    decisions: stateAfter.supplierDecisions,
    calculatedAt: rebuilt.analysis.generatedAt
  });
  const statusDistributionWithDecisions =
    reviewWithDecisions.reduce<Record<string, number>>((counts, position) => {
      counts[position.liveStatus] =
        (counts[position.liveStatus] ?? 0) + 1;
      return counts;
    }, {});
  const report = {
    generatedAt,
    projectKey,
    documents: documentReports,
    extraction: {
      appendedRuns: appendResult.appended,
      cachedRuns: appendResult.cached,
      totalRuns: stateAfter.runs.length,
      basis: basisResult.metrics,
      suppliers: Object.fromEntries(
        suppliers.map((document) => [
          document.supplier ?? document.id,
          supplierResults.get(document.id)?.metrics
        ])
      )
    },
    analysis: {
      id: rebuilt.analysis.id,
      basisLeafPositions: rebuilt.analysis.basisPositions.length,
      matchLinks: rebuilt.analysis.matchLinks.length,
      supplierOptions: rebuilt.analysis.supplierOptions.length,
      bundles: new Set(
        stateAfter.runs
          .flatMap((run) =>
            run.result.envelope.extraction.offerGroups.flatMap(
              (group) => group.lines
            )
          )
          .map((line) => line.groupId)
          .filter(Boolean)
      ).size,
      coverageDistribution: rebuilt.coverageDistribution,
      statusDistribution: statusDistributionWithDecisions,
      duplicateBasisIds:
        rebuilt.analysis.basisPositions.length -
        new Set(
          rebuilt.analysis.basisPositions.map((position) => position.id)
        ).size,
      duplicatePositionNumbers:
        rebuilt.analysis.basisPositions.length -
        new Set(
          rebuilt.analysis.basisPositions.map((position) =>
            normalizePosition(position.positionNumber)
          )
        ).size,
      orphanOptions: rebuilt.analysis.supplierOptions.filter((option) =>
        option.basisPositionIds.some(
          (id) =>
            !rebuilt.analysis.basisPositions.some(
              (position) => position.id === id
            )
        )
      ).length,
      orphanDecisions: stateAfter.supplierDecisions.filter(
        (decision) =>
          !rebuilt.analysis.basisPositions.some(
            (position) => position.id === decision.basisPositionId
          )
      ).length,
      changedControlOptionIds: persistedControlChanges
    },
    decisionsPreserved: true,
    openAiCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0
  };
  await writeFile(
    path.resolve(root, ".data", "live-project-rebuild.local.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
