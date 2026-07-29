import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildDocumentRevisionIndex } from "@/domain/decision";
import {
  decisionAnalysisVersionId,
  decisionProjectId
} from "@/domain/decision-project";
import {
  buildPositionSupplierCoverage,
  buildProjectReviewPositions
} from "@/domain/project-review";
import { normalizeLvPositionReference } from "@/domain/matching";
import { buildProjectCompletenessInvariant } from "@/domain/project-invariant";
import { LocalPilotPersistence } from "@/storage/document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "LOCAL_CORPUS_DISABLED",
        message: "Set LOCAL_CORPUS_ENABLED=true on localhost. Production storage is not configured."
      },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const asset = url.searchParams.get("asset");
  const sourceDocumentId = url.searchParams.get("documentId");
  const sourceDocumentRevisionId = url.searchParams.get("documentRevisionId");
  const persistence = new LocalPilotPersistence(
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
    true
  );

  if (asset) {
    const state = await persistence.read();
    const snapshotAssets = state.supplierDecisions.flatMap((decision) => {
      if (!("evidenceSnapshot" in decision) || !decision.evidenceSnapshot) return [];
      const snapshot = decision.evidenceSnapshot;
      return [
        ...snapshot.basisPosition.sources,
        ...snapshot.basisContext.flatMap((position) => position.sources),
        ...snapshot.selectedLines.flatMap((line) => line.sources),
        ...snapshot.supplierContextLines.flatMap((line) => line.sources),
        ...snapshot.includedRequiredComponents.flatMap((line) => line.sources),
        ...snapshot.excludedOptionalComponents.flatMap((line) => line.sources),
        ...(snapshot.visibleSupplierOptions ?? []).flatMap((option) =>
          option.lines.flatMap((line) => line.sources)
        ),
        ...snapshot.continuationPages
      ].map((source) => source.assetKey);
    });
    const allowedAssets = new Set(
      [
        ...state.runs.flatMap((run) => [
          run.pageImageAsset,
          ...Object.values(run.cropAssets)
        ]),
        ...snapshotAssets
      ]
    );
    if (!allowedAssets.has(asset)) {
      return NextResponse.json({ error: "ASSET_NOT_FOUND" }, { status: 404 });
    }
    const bytes = await readFile(
      path.resolve(
        /*turbopackIgnore: true*/ process.cwd(),
        ".data",
        "pilot-assets",
        asset
      )
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store"
      }
    });
  }

  if (sourceDocumentId || sourceDocumentRevisionId) {
    if (!sourceDocumentId || !sourceDocumentRevisionId) {
      return NextResponse.json({ error: "SOURCE_REFERENCE_INCOMPLETE" }, { status: 400 });
    }
    const state = await persistence.read();
    const currentRevision =
      buildDocumentRevisionIndex(state.runs)[sourceDocumentId];
    if (currentRevision !== sourceDocumentRevisionId) {
      return NextResponse.json({ error: "DOCUMENT_REVISION_NOT_AVAILABLE" }, { status: 404 });
    }
    const manifest = JSON.parse(
      await readFile(
        path.resolve(
          /*turbopackIgnore: true*/ process.cwd(),
          ".data",
          "corpus-manifest.local.json"
        ),
        "utf8"
      )
    ) as {
      documents?: Array<{ id: string; relativePath: string }>;
    };
    const document = manifest.documents?.find(
      (candidate) => candidate.id === sourceDocumentId
    );
    if (!document) {
      return NextResponse.json({ error: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    }
    const corpusRoot = path.resolve(
      /*turbopackIgnore: true*/ process.cwd(),
      "pdffirma"
    );
    const documentPath = path.resolve(corpusRoot, document.relativePath);
    if (
      documentPath !== corpusRoot &&
      !documentPath.startsWith(`${corpusRoot}${path.sep}`)
    ) {
      return NextResponse.json({ error: "DOCUMENT_PATH_INVALID" }, { status: 400 });
    }
    const bytes = await readFile(documentPath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(
          path.basename(document.relativePath)
        )}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }

  if (view === "pilot") {
    const state = await persistence.read();
    let corpusDocuments: Array<{
      id: string;
      relativePath: string;
      documentType: string;
      discipline: string;
      projectKey?: string;
      supplier?: string;
      offerNumber?: string;
      dateHints?: string[];
      revision?: number;
      active?: boolean;
      supersededByDocumentId?: string;
      relevantPositionNumbers?: string[];
      pages?: Array<{
        pageNumber: number;
        lvPositionReferences?: string[];
      }>;
    }> = [];
    try {
      const manifest = JSON.parse(
        await readFile(
          path.resolve(
            /*turbopackIgnore: true*/ process.cwd(),
            ".data",
            "corpus-manifest.local.json"
          ),
          "utf8"
        )
      ) as { documents?: typeof corpusDocuments };
      corpusDocuments = manifest.documents ?? [];
    } catch {
      corpusDocuments = [];
    }
    const analysis = state.analysis;
    const supplierDocumentCandidates = corpusDocuments.filter(
      (document) =>
        ["SUPPLIER_OFFER", "SPECIALIZED_SUPPLIER_OFFER"].includes(
          document.documentType
        ) &&
        ["HEIZUNG", "MIXED"].includes(document.discipline)
    );
    const basisProjectKey = corpusDocuments.find(
      (document) => document.id === analysis?.basisDocumentId
    )?.projectKey;
    const projectContextConfirmed = Boolean(
      basisProjectKey &&
        supplierDocumentCandidates.every((document) => document.projectKey) &&
        (analysis?.supplierDocuments ?? []).every((processed) =>
          supplierDocumentCandidates.some(
            (document) =>
              document.id === processed.id &&
              document.projectKey === basisProjectKey
          )
        )
    );
    const projectSupplierDocuments = basisProjectKey
      ? supplierDocumentCandidates.filter(
          (document) => document.projectKey === basisProjectKey
        )
      : supplierDocumentCandidates;
    const processedSupplierDocumentIds = new Set(
      analysis?.supplierDocuments.map((document) => document.id) ?? []
    );
    const coverageDocuments = projectSupplierDocuments
      .filter((document) => document.active !== false)
      .map((document) => ({
        id: document.id,
        role: document.documentType as
          | "SUPPLIER_OFFER"
          | "SPECIALIZED_SUPPLIER_OFFER",
        processed: processedSupplierDocumentIds.has(document.id),
        scope:
          document.documentType === "SUPPLIER_OFFER"
            ? ({ status: "ALL" } as const)
            : document.relevantPositionNumbers
              ? ({
                  status: "LISTED",
                  basisPositionIds:
                    analysis?.basisPositions
                      .filter((basis) =>
                        document.relevantPositionNumbers?.some(
                          (reference) =>
                            normalizeLvPositionReference(reference) ===
                            normalizeLvPositionReference(
                              basis.positionNumber
                            )
                        )
                      )
                      .map((basis) => basis.id) ?? []
                } as const)
              : ({ status: "UNKNOWN" } as const)
      }));
    const coverageByBasisId = Object.fromEntries(
      (analysis?.basisPositions ?? [])
        .filter((basis) => !basis.heading)
        .map((basis) => {
          const options =
            analysis?.supplierOptions.filter((option) =>
              option.basisPositionIds.includes(basis.id)
            ) ?? [];
          const coverage = buildPositionSupplierCoverage({
              basisPositionId: basis.id,
              documents: coverageDocuments,
              options
            });
          const normalizedPosition = normalizeLvPositionReference(
            basis.positionNumber
          );
          return [
            basis.id,
            {
              ...coverage,
              missingSources: coverage.missingExpectedSuppliers.map(
                (supplierDocumentId) => {
                  const document = projectSupplierDocuments.find(
                    (candidate) => candidate.id === supplierDocumentId
                  );
                  return {
                    supplierDocumentId,
                    pages:
                      normalizedPosition && document?.pages
                        ? document.pages
                            .filter((page) =>
                              page.lvPositionReferences?.includes(
                                normalizedPosition
                              )
                            )
                            .map((page) => page.pageNumber)
                        : []
                  };
                }
              )
            }
          ];
        })
    );
    const missingSupplierIds = new Set(
      Object.values(coverageByBasisId).flatMap(
        (coverage) => coverage.missingExpectedSuppliers
      )
    );
    const relevantSupplierIds = new Set(
      Object.values(coverageByBasisId).flatMap(
        (coverage) => coverage.relevantSuppliers
      )
    );
    const missingSupplierDocuments = projectSupplierDocuments.filter(
      (document) => missingSupplierIds.has(document.id)
    );
    const allPositionCoverageSufficient = Object.values(
      coverageByBasisId
    ).every((coverage) => coverage.coverageStatus === "SUFFICIENT");
    const projectReviewPositions = analysis
      ? buildProjectReviewPositions({
          basisPositions: analysis.basisPositions,
          options: analysis.supplierOptions,
          coverage: {
            activeSupplierDocumentIds: processedSupplierDocumentIds,
            allRelevantOffersProcessed: allPositionCoverageSufficient,
            supplierCoverageSufficient: allPositionCoverageSufficient,
            projectContextConfirmed,
            disciplineContextConfirmed: true,
            materialUncertainty: false
          },
          coverageByBasisId,
          decisions: state.supplierDecisions,
          calculatedAt: analysis.generatedAt
        })
      : [];
    const invariant = buildProjectCompletenessInvariant({
      basisPositions: analysis?.basisPositions ?? [],
      reviewPositions: projectReviewPositions,
      supplierOptions: analysis?.supplierOptions ?? [],
      decisions: state.supplierDecisions
    });
    return NextResponse.json(
      {
        ...state,
        documentRevisions: buildDocumentRevisionIndex(state.runs),
        projectReview: {
          projectId: analysis ? decisionProjectId(analysis) : "",
          analysisVersionId: analysis
            ? decisionAnalysisVersionId(analysis)
            : "",
          positions: projectReviewPositions,
          invariant,
          coverage: {
            relevantSupplierDocumentIds: [...relevantSupplierIds],
            relevantSupplierDocuments: projectSupplierDocuments
              .filter((document) => relevantSupplierIds.has(document.id))
              .map((document) => ({
                id: document.id,
                label: document.relativePath,
                supplier: document.supplier ?? document.relativePath,
                offerNumber: document.offerNumber,
                revision: document.revision,
                date: document.dateHints?.[0]
              }))
              .sort((left, right) =>
                left.supplier.localeCompare(right.supplier, "de")
              ),
            processedSupplierDocumentIds: [...processedSupplierDocumentIds],
            missingSupplierDocuments: missingSupplierDocuments.map((document) => ({
              id: document.id,
              label: document.relativePath
            })),
            allRelevantOffersProcessed: allPositionCoverageSufficient,
            projectContextConfirmed,
            historicalCalculationAvailable: corpusDocuments.some((document) =>
              ["HISTORICAL_CALCULATION", "FINAL_INTERNAL_CALCULATION"].includes(
                document.documentType
              )
            )
          }
        },
        confidentiality: "LOCAL_ONLY"
      },
      { headers: { "cache-control": "private, no-store" } }
    );
  }

  try {
    const manifest = JSON.parse(
      await readFile(
        path.resolve(
          /*turbopackIgnore: true*/ process.cwd(),
          ".data",
          "corpus-manifest.local.json"
        ),
        "utf8"
      )
    ) as {
      documents: Array<{
        id: string;
        pages: unknown[];
        active?: boolean;
        supersededByDocumentId?: string;
        [key: string]: unknown;
      }>;
      generatedAt: string;
    };
    const state = await persistence.read();
    const documents = manifest.documents.map((document) => {
      const extractedPages = Array.from(
        new Set(
          state.runs
            .filter((run) => run.document.id === document.id)
            .map((run) => run.document.pageNumber)
        )
      ).sort((left, right) => left - right);
      const completedPageNumbers = new Set(extractedPages);
      return {
        ...document,
        active: document.active ?? !document.supersededByDocumentId,
        pages: document.pages.map((page, index) => ({
          ...(typeof page === "object" && page !== null ? page : {}),
          pageNumber:
            typeof page === "object" &&
            page !== null &&
            "pageNumber" in page &&
            typeof page.pageNumber === "number"
              ? page.pageNumber
              : index + 1,
          processingStatus: completedPageNumbers.has(
            typeof page === "object" &&
              page !== null &&
              "pageNumber" in page &&
              typeof page.pageNumber === "number"
              ? page.pageNumber
              : index + 1
          )
            ? "COMPLETED"
            : "NOT_STARTED"
        })),
        extractedPages,
        extractionStatus:
          extractedPages.length === 0
            ? "NOT_STARTED"
            : extractedPages.length === document.pages.length
              ? "COMPLETE"
              : "PARTIAL"
      };
    });
    return NextResponse.json({
      documents,
      generatedAt: manifest.generatedAt,
      confidentiality: "LOCAL_ONLY"
    });
  } catch {
    return NextResponse.json(
      { error: "CORPUS_NOT_SCANNED", message: "Run npm run corpus:scan first." },
      { status: 404 }
    );
  }
}
