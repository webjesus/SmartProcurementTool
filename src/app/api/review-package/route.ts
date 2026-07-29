import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import {
  buildPositionSupplierCoverage,
  buildProjectReviewPositions
} from "@/domain/project-review";
import {
  ReviewPackageSchema,
  buildReviewPackage
} from "@/domain/review-package";
import { normalizeLvPositionReference } from "@/domain/matching";
import { buildProjectCompletenessInvariant } from "@/domain/project-invariant";
import { decisionProjectId } from "@/domain/decision-project";
import { getDecisionUnitOfWork } from "@/repositories/decision-repository-factory";
import { centralProjectDecisionData } from "@/services/decision-sync-service";
import { getDecisionDatabase } from "@/db/client";
import { importCentralReviewPackage } from "@/services/central-review-package-import";
import { decisionPersistenceMode } from "@/services/decision-persistence-config";
import { LocalPilotPersistence } from "@/storage/document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ManifestDocument {
  id: string;
  relativePath: string;
  documentType: string;
  discipline: string;
  projectKey?: string;
  active?: boolean;
  relevantPositionNumbers?: string[];
}

async function reviewPackageData() {
  const persistence = new LocalPilotPersistence(
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
    true
  );
  const state = await persistence.read();
  const manifest = JSON.parse(
    await readFile(
      path.resolve(
        /*turbopackIgnore: true*/ process.cwd(),
        ".data",
        "corpus-manifest.local.json"
      ),
      "utf8"
    )
  ) as { documents: ManifestDocument[] };
  const candidates = manifest.documents.filter(
    (document) =>
      ["SUPPLIER_OFFER", "SPECIALIZED_SUPPLIER_OFFER"].includes(
        document.documentType
      ) && ["HEIZUNG", "MIXED"].includes(document.discipline)
  );
  const basisProjectKey = manifest.documents.find(
    (document) => document.id === state.analysis?.basisDocumentId
  )?.projectKey;
  const relevant = basisProjectKey
    ? candidates.filter((document) => document.projectKey === basisProjectKey)
    : candidates;
  const processed = new Set(
    state.analysis?.supplierDocuments.map((document) => document.id) ?? []
  );
  const coverageDocuments = relevant
    .filter((document) => document.active !== false)
    .map((document) => ({
      id: document.id,
      role: document.documentType as
        | "SUPPLIER_OFFER"
        | "SPECIALIZED_SUPPLIER_OFFER",
      processed: processed.has(document.id),
      scope:
        document.documentType === "SUPPLIER_OFFER"
          ? ({ status: "ALL" } as const)
          : document.relevantPositionNumbers
            ? ({
                status: "LISTED",
                basisPositionIds:
                  state.analysis?.basisPositions
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
    (state.analysis?.basisPositions ?? [])
      .filter((basis) => !basis.heading)
      .map((basis) => [
        basis.id,
        buildPositionSupplierCoverage({
          basisPositionId: basis.id,
          documents: coverageDocuments,
          options:
            state.analysis?.supplierOptions.filter((option) =>
              option.basisPositionIds.includes(basis.id)
            ) ?? []
        })
      ])
  );
  const allProcessed = Object.values(coverageByBasisId).every(
    (coverage) => coverage.coverageStatus === "SUFFICIENT"
  );
  const projectContextConfirmed = Boolean(
    basisProjectKey &&
      candidates.every((document) => document.projectKey) &&
      (state.analysis?.supplierDocuments ?? []).every((processedDocument) =>
        candidates.some(
          (document) =>
            document.id === processedDocument.id &&
            document.projectKey === basisProjectKey
        )
      )
  );
  const positions = state.analysis
    ? buildProjectReviewPositions({
        basisPositions: state.analysis.basisPositions,
        options: state.analysis.supplierOptions,
        coverage: {
          activeSupplierDocumentIds: processed,
          allRelevantOffersProcessed: allProcessed,
          supplierCoverageSufficient: allProcessed,
          projectContextConfirmed,
          disciplineContextConfirmed: true,
          materialUncertainty: false
        },
        coverageByBasisId,
        decisions: state.supplierDecisions,
        calculatedAt: state.analysis.generatedAt
      })
    : [];
  const centralProjectId = state.analysis
    ? decisionProjectId(state.analysis)
    : "local-project-without-analysis";
  const centralServerData =
    decisionPersistenceMode() === "CENTRAL_SERVER" && state.analysis
      ? await centralProjectDecisionData(
          getDecisionUnitOfWork().repositories,
          centralProjectId
        )
      : undefined;
  return {
    persistence,
    state,
    invariant: buildProjectCompletenessInvariant({
      basisPositions: state.analysis?.basisPositions ?? [],
      reviewPositions: positions,
      supplierOptions: state.analysis?.supplierOptions ?? [],
      decisions: state.supplierDecisions
    }),
    reviewPackage: buildReviewPackage({
      projectId: centralServerData
        ? centralProjectId
        : state.analysis?.id ?? "local-project-without-analysis",
      state,
      positions,
      centralServerData
    })
  };
}

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF294A91" }
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });
}

async function xlsxResponse(
  reviewPackage: ReturnType<typeof buildReviewPackage>
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Smart Procurement Tool";
  workbook.created = new Date(reviewPackage.exportedAt);
  const summary = workbook.addWorksheet("Review");
  summary.columns = [
    { header: "Basis position", key: "position", width: 18 },
    { header: "Description", key: "description", width: 42 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Independent result", key: "independent", width: 32 },
    { header: "Live status", key: "liveStatus", width: 30 },
    { header: "Supplier coverage", key: "coverage", width: 24 },
    { header: "Comparable total", key: "total", width: 20 },
    { header: "Supplier options", key: "supplierOptions", width: 64 },
    { header: "Selected supplier", key: "selectedSupplier", width: 24 },
    { header: "Comments", key: "comments", width: 54 },
    { header: "Next comparable", key: "next", width: 20 },
    { header: "Historical result", key: "historical", width: 34 },
    { header: "Historical Material EK", key: "materialEk", width: 22 },
    { header: "Discrepancy", key: "reasons", width: 54 },
    { header: "Evidence references", key: "evidence", width: 42 }
  ];
  for (const position of reviewPackage.positions) {
    summary.addRow({
      position: position.basisPositionNumber,
      description: position.description,
      quantity: position.quantity,
      unit: position.unit,
      independent: position.independentStatus,
      liveStatus: position.liveStatus,
      coverage: position.coverage?.coverageStatus,
      total: position.comparableTotal,
      supplierOptions: (position.supplierOptions ?? [])
        .map(
          (option) =>
            `${option.supplierLabel}: priced ${option.pricedTotal ?? "—"}; comparable ${option.comparableTotal ?? "—"}; ${option.status}`
        )
        .join("\n"),
      selectedSupplier: position.selectedSupplierLabel,
      comments: (position.decisionComments ?? []).join("\n"),
      next: position.nextComparableTotal,
      historical: position.historicalClassification,
      materialEk: position.historicalMaterialEk,
      reasons: position.discrepancyReasons.join(" · "),
      evidence: position.evidence
        .map(
          (source) =>
            `${source.documentId} · rev ${source.documentRevisionId} · S. ${source.pageNumber}`
        )
        .join("\n")
    });
  }
  styleSheet(summary);

  const history = workbook.addWorksheet("Entscheidungshistorie");
  history.columns = [
    { header: "Decision ID", key: "id", width: 40 },
    { header: "Basis position ID", key: "basis", width: 28 },
    { header: "Status", key: "status", width: 28 },
    { header: "Supplier option", key: "option", width: 38 },
    { header: "Selected lines", key: "lines", width: 42 },
    { header: "Comment", key: "comment", width: 54 },
    { header: "Previous decision", key: "previous", width: 40 },
    { header: "Catalog version", key: "catalog", width: 34 },
    { header: "Operator", key: "operator", width: 24 },
    { header: "Timestamp", key: "timestamp", width: 28 }
  ];
  for (const decision of reviewPackage.decisions) {
    history.addRow({
      id: decision.id,
      basis: decision.basisPositionId,
      status: decision.status,
      option:
        "selectedSupplierOptionId" in decision
          ? decision.selectedSupplierOptionId
          : decision.supplierDocumentId,
      lines:
        "selectedSupplierLineIds" in decision
          ? decision.selectedSupplierLineIds.join(", ")
          : "",
      comment: decision.comment,
      previous:
        "previousDecisionId" in decision ? decision.previousDecisionId : "",
      catalog: "catalogVersion" in decision ? decision.catalogVersion : "legacy",
      operator: "decidedBy" in decision ? decision.decidedBy : decision.operator,
      timestamp: "decidedAt" in decision ? decision.decidedAt : decision.timestamp
    });
  }
  for (const decision of reviewPackage.centralServer?.decisions ?? []) {
    history.addRow({
      id: decision.id,
      basis: decision.positionId,
      status: decision.outcome,
      option: decision.selectedSupplierOptionId,
      lines: decision.selectedBundleLineIds.join(", "),
      comment: decision.comment,
      previous: decision.previousDecisionId,
      catalog: "CENTRAL_SERVER",
      operator: decision.decidedByDisplayName,
      timestamp: decision.decidedAt
    });
  }
  styleSheet(history);

  const drafts = workbook.addWorksheet("Aktive Entwürfe");
  drafts.columns = [
    { header: "Draft ID", key: "id", width: 40 },
    { header: "Basis position ID", key: "basis", width: 28 },
    { header: "Outcome", key: "outcome", width: 28 },
    { header: "Supplier option", key: "option", width: 38 },
    { header: "Selected bundle lines", key: "lines", width: 50 },
    { header: "Rejected options", key: "rejected", width: 42 },
    { header: "Comment", key: "comment", width: 54 },
    { header: "Author", key: "author", width: 24 },
    { header: "Updated at", key: "updatedAt", width: 28 },
    { header: "Draft version", key: "version", width: 16 },
    { header: "Analysis version", key: "analysis", width: 42 }
  ];
  for (const draft of reviewPackage.centralServer?.drafts ?? []) {
    drafts.addRow({
      id: draft.id,
      basis: draft.positionId,
      outcome: draft.outcome,
      option: draft.selectedSupplierOptionId,
      lines: draft.selectedBundleLineIds.join(", "),
      rejected: draft.rejectedOptionIds.join(", "),
      comment: draft.comment,
      author: draft.updatedByDisplayName,
      updatedAt: draft.updatedAt,
      version: draft.version,
      analysis: draft.analysisVersionId
    });
  }
  styleSheet(drafts);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        'attachment; filename="SPT-review-package-summary.xlsx"',
      "cache-control": "private, no-store"
    }
  });
}

export async function GET(request: Request) {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    return NextResponse.json({ error: "LOCAL_CORPUS_DISABLED" }, { status: 503 });
  }
  const { reviewPackage, invariant } = await reviewPackageData();
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format === "xlsx" && !invariant.valid) {
    return NextResponse.json(
      {
        error: "COMPLETENESS_INVARIANT_FAILED",
        message:
          "Final export is blocked until every unique Basis leaf position has exactly one known live status.",
        invariant
      },
      { status: 409 }
    );
  }
  if (format === "xlsx") return xlsxResponse(reviewPackage);
  return new Response(JSON.stringify(reviewPackage, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition":
        'attachment; filename="SPT-review-package.json"',
      "cache-control": "private, no-store"
    }
  });
}

export async function POST(request: Request) {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    return NextResponse.json({ error: "LOCAL_CORPUS_DISABLED" }, { status: 503 });
  }
  const parsed = ReviewPackageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REVIEW_PACKAGE", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { persistence, state } = await reviewPackageData();
  const localProjectId =
    parsed.data.centralServer && state.analysis
      ? decisionProjectId(state.analysis)
      : state.analysis?.id ?? "local-project-without-analysis";
  if (parsed.data.projectId !== localProjectId) {
    return NextResponse.json(
      {
        error: "PROJECT_MISMATCH",
        expectedProjectId: localProjectId,
        packageProjectId: parsed.data.projectId
      },
      { status: 409 }
    );
  }
  try {
    if (parsed.data.centralServer) {
      if (decisionPersistenceMode() !== "CENTRAL_SERVER") {
        return NextResponse.json(
          {
            error: "CENTRAL_DATABASE_UNAVAILABLE",
            message: "DATABASE_URL is required to import central decisions."
          },
          { status: 503 }
        );
      }
      const merge = await importCentralReviewPackage(
        getDecisionDatabase(),
        localProjectId,
        parsed.data.centralServer
      );
      if (!merge.applied) {
        return NextResponse.json(
          { error: "REVIEW_PACKAGE_CONFLICT", merge },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { projectId: localProjectId, merge },
        { status: 201 }
      );
    }
    const result = await persistence.importSupplierDecisionHistory({
      decisions: parsed.data.decisions,
      reviewActions: parsed.data.decisionReviewActions,
      importedBy: "local-package-import",
      importedAt: new Date().toISOString()
    });
    return NextResponse.json(
      { ...result, projectId: localProjectId },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "REVIEW_PACKAGE_CONFLICT",
        message: error instanceof Error ? error.message : "Import failed"
      },
      { status: 409 }
    );
  }
}
