import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildBasisRecommendations,
  buildSupplierOptions,
  proposeMatches,
  type OfferLineContext
} from "../src/domain/matching";
import {
  buildPositionSupplierCoverage,
  buildProjectReviewPositions,
  type ManualPrimaryReasonCategory
} from "../src/domain/project-review";
import { buildProjectCompletenessInvariant } from "../src/domain/project-invariant";
import type {
  DocumentType,
  PilotAnalysis,
  SupplierOption
} from "../src/domain/contracts";
import {
  LocalPilotPersistence,
  type PersistedPilotRun
} from "../src/storage/document-storage";

const AUDIT_VERSION = "demo-readiness-audit-v1";
const NO_COMPARABLE_TARGETS = [
  "1.1.490",
  "1.1.500",
  "1.1.510",
  "1.1.520",
  "1.1.530",
  "1.1.540",
  "2.1.890",
  "3.1.70",
  "3.1.80",
  "3.1.110",
  "3.2.120",
  "3.2.130"
] as const;

type Manifest = {
  documents: Array<{
    id: string;
    documentType: DocumentType;
    projectKey?: string;
    active?: boolean;
    relevantPositionNumbers?: string[];
  }>;
};

function normalizePosition(value: string): string {
  const parts = value.match(/\d+/g)?.slice(0, 3).map(Number);
  return parts?.length === 3 ? parts.join(".") : value.trim();
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function offerContexts(
  runs: readonly PersistedPilotRun[],
  suppliers: readonly PilotAnalysis["supplierDocuments"][number][]
): OfferLineContext[] {
  const labels = new Map(
    suppliers.map((supplier) => [supplier.id, supplier.label])
  );
  return runs
    .filter((run) => labels.has(run.document.id))
    .flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => ({
          documentId: run.document.id,
          documentLabel: labels.get(run.document.id)!,
          line,
          blockingIssueIds: ["OPTIONAL", "ALTERNATIVE"].includes(line.role)
            ? []
            : run.validationIssues
                .filter(
                  (issue) =>
                    issue.lineId === line.id && issue.severity === "BLOCKING"
                )
                .map((issue) => issue.id)
        }))
      )
    );
}

function optionTrace(option: SupplierOption, lines: Map<string, OfferLineContext>) {
  return {
    supplier: option.supplierLabel,
    supplierDocumentId: option.supplierDocumentId,
    matchedLines: option.matchedOfferLineIds.map((id) => {
      const context = lines.get(id);
      return {
        id,
        page: context?.line.evidence[0]?.pageNumber ?? null,
        sourcePositionNumber: context?.line.sourcePositionNumber ?? null,
        supplierPositionNumber: context?.line.supplierPositionNumber ?? null,
        role: context?.line.role ?? null,
        quantity: context?.line.quantity ?? null,
        unit: context?.line.unit ?? null,
        unitPrice: context?.line.interpretedUnitPrice ?? null,
        totalPrice: context?.line.interpretedTotalPrice ?? null,
        evidenceIds: context?.line.evidence.map((evidence) => evidence.id) ?? []
      };
    }),
    matchLinkIds: option.matchLinkIds,
    optionId: option.id,
    offerAvailability: option.offerAvailability,
    materialScopeStatus: option.materialScopeStatus,
    technicalComparisonStatus:
      option.technicalComparisonStatus ?? null,
    unresolvedTechnicalAttributes:
      option.unresolvedTechnicalAttributes ?? [],
    missingComponents: option.missingComponents,
    pricedTotal: option.pricedTotal,
    comparableTotal: option.comparableTotal,
    quantityCompatible: option.quantityCompatible,
    unitCompatible: option.unitCompatible,
    requiredScopeComplete: option.requiredScopeComplete,
    bundleCompatible: option.bundleCompatible,
    evidenceSufficient: option.evidenceSufficient,
    reasons: option.reasons
  };
}

async function main() {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    throw new Error("Set LOCAL_CORPUS_ENABLED=true for the local audit.");
  }
  const root = process.cwd();
  const persistence = new LocalPilotPersistence(
    path.resolve(root, ".data"),
    true
  );
  const before = await persistence.read();
  if (!before.analysis) throw new Error("Existing pilot analysis is missing.");
  const runsBefore = stableHash(before.runs);
  const decisionsBefore = stableHash(before.supplierDecisions);
  const decisionReviewsBefore = stableHash(
    before.supplierDecisionReviewActions
  );
  const previousAnalysis = before.analysis;
  const auditBaselineAnalysis =
    before.analysisVersions?.[0] ?? previousAnalysis;
  const manifest = JSON.parse(
    await readFile(
      path.resolve(root, ".data", "corpus-manifest.local.json"),
      "utf8"
    )
  ) as Manifest;
  const supplierIds = new Set(
    previousAnalysis.supplierDocuments.map((supplier) => supplier.id)
  );
  const suppliers = previousAnalysis.supplierDocuments;
  const offers = offerContexts(before.runs, suppliers);
  const offerById = new Map(
    offers.map((offer) => [offer.line.id, offer])
  );
  const matchLinks = proposeMatches(previousAnalysis.basisPositions, offers);
  const allOptions = buildSupplierOptions({
    basisPositions: previousAnalysis.basisPositions,
    offers,
    links: matchLinks,
    fullyProcessedSupplierDocumentIds: supplierIds
  });
  const specialized = manifest.documents.find(
    (document) =>
      document.projectKey === "project-heating-a" &&
      document.documentType === "SPECIALIZED_SUPPLIER_OFFER" &&
      supplierIds.has(document.id)
  );
  const specializedRelevant = new Set(
    specialized?.relevantPositionNumbers?.map(normalizePosition) ?? []
  );
  const basisById = new Map(
    previousAnalysis.basisPositions.map((basis) => [basis.id, basis])
  );
  const supplierOptions = allOptions.filter((option) => {
    if (option.supplierDocumentId !== specialized?.id) return true;
    return option.basisPositionIds.some((basisId) => {
      const basis = basisById.get(basisId);
      return Boolean(
        basis &&
          specializedRelevant.has(normalizePosition(basis.positionNumber))
      );
    });
  });
  const coverageDocuments = suppliers.map((supplier) => ({
    id: supplier.id,
    role:
      supplier.id === specialized?.id
        ? ("SPECIALIZED_SUPPLIER_OFFER" as const)
        : ("SUPPLIER_OFFER" as const),
    processed: true,
    scope:
      supplier.id === specialized?.id
        ? ({
            status: "LISTED" as const,
            basisPositionIds: previousAnalysis.basisPositions
              .filter((basis) =>
                specializedRelevant.has(
                  normalizePosition(basis.positionNumber)
                )
              )
              .map((basis) => basis.id)
          } as const)
        : ({ status: "ALL" as const } as const)
  }));
  const coverageByBasisId = Object.fromEntries(
    previousAnalysis.basisPositions.map((basis) => [
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
  const generatedAt = new Date().toISOString();
  const analysis: PilotAnalysis = {
    ...previousAnalysis,
    id: `analysis_${stableHash({
      previousAnalysisId: previousAnalysis.id,
      auditVersion: AUDIT_VERSION,
      options: supplierOptions.map((option) => ({
        id: option.id,
        scope: option.materialScopeStatus,
        technical: option.technicalComparisonStatus,
        comparableTotal: option.comparableTotal
      }))
    }).slice(0, 18)}`,
    matchLinks,
    supplierOptions,
    recommendations: buildBasisRecommendations(
      previousAnalysis.basisPositions,
      supplierOptions
    ),
    generatedAt
  };
  const review = buildProjectReviewPositions({
    basisPositions: analysis.basisPositions,
    options: analysis.supplierOptions,
    coverage: {
      activeSupplierDocumentIds: supplierIds,
      allRelevantOffersProcessed: true,
      supplierCoverageSufficient: true,
      projectContextConfirmed: true,
      disciplineContextConfirmed: true,
      materialUncertainty: false
    },
    coverageByBasisId,
    decisions: before.supplierDecisions,
    calculatedAt: generatedAt
  });
  const invariant = buildProjectCompletenessInvariant({
    basisPositions: analysis.basisPositions,
    reviewPositions: review,
    supplierOptions: analysis.supplierOptions,
    decisions: before.supplierDecisions
  });
  const statusDistribution = review.reduce<Record<string, number>>(
    (result, position) => {
      result[position.liveStatus] = (result[position.liveStatus] ?? 0) + 1;
      return result;
    },
    {}
  );
  const manualPositions = review.filter(
    (position) => position.liveStatus === "MANUAL_DECISION_REQUIRED"
  );
  const reasonDistribution = manualPositions.reduce<
    Record<
      string,
      {
        count: number;
        percentage: number;
        examples: string[];
        reviewQueue: string;
      }
    >
  >((result, position) => {
    const category =
      position.primaryReasonCategory ??
      ("OTHER" satisfies ManualPrimaryReasonCategory);
    const entry = result[category] ?? {
      count: 0,
      percentage: 0,
      examples: [],
      reviewQueue: position.reviewQueue ?? "SYSTEM_REVIEW"
    };
    entry.count += 1;
    if (entry.examples.length < 8) {
      entry.examples.push(position.basis.positionNumber);
    }
    result[category] = entry;
    return result;
  }, {});
  for (const entry of Object.values(reasonDistribution)) {
    entry.percentage =
      manualPositions.length === 0
        ? 0
        : Math.round((entry.count / manualPositions.length) * 10000) / 100;
  }
  const previousReview = buildProjectReviewPositions({
    basisPositions: auditBaselineAnalysis.basisPositions,
    options: auditBaselineAnalysis.supplierOptions,
    coverage: {
      activeSupplierDocumentIds: supplierIds,
      allRelevantOffersProcessed: true,
      supplierCoverageSufficient: true,
      projectContextConfirmed: true,
      disciplineContextConfirmed: true,
      materialUncertainty: false
    },
    coverageByBasisId,
    decisions: before.supplierDecisions,
    calculatedAt: auditBaselineAnalysis.generatedAt
  });
  const noComparableAudit = NO_COMPARABLE_TARGETS.map((positionNumber) => {
    const basis = analysis.basisPositions.find(
      (candidate) =>
        normalizePosition(candidate.positionNumber) === positionNumber
    );
    if (!basis) throw new Error(`Audit position ${positionNumber} is missing.`);
    const previous = previousReview.find(
      (candidate) => candidate.basis.id === basis.id
    );
    const current = review.find(
      (candidate) => candidate.basis.id === basis.id
    );
    const options = supplierOptions.filter((option) =>
      option.basisPositionIds.includes(basis.id)
    );
    const hasPotentiallyOutcomeChangingLine = options.some(
      (option) =>
        option.offerAvailability === "PRESENT" &&
        (option.materialScopeStatus === "UNKNOWN" ||
          option.technicalComparisonStatus === "UNRESOLVED")
    );
    return {
      positionNumber,
      basisPositionId: basis.id,
      basisQuantity: basis.quantity,
      basisUnit: basis.unit,
      basisEvidence: basis.evidence.map((evidence) => ({
        documentId: evidence.documentId,
        page: evidence.pageNumber,
        evidenceId: evidence.id
      })),
      previousStatus: previous?.liveStatus ?? null,
      correctedStatus: current?.liveStatus ?? null,
      reviewQueue: current?.reviewQueue ?? null,
      primaryReasonCategory: current?.primaryReasonCategory ?? null,
      hasPotentiallyOutcomeChangingLine,
      options: options.map((option) => optionTrace(option, offerById)),
      exclusionPoint:
        previous?.independent.fullyComparableOptionIds.length === 0
          ? "SupplierOption technicalCompatible/materialScope gate"
          : "Unique-lowest decision gate"
    };
  });
  const deterministicFallbackIds = new Set(
    before.runs.flatMap(
      (run) => run.provenance?.fallbackCandidateBlockIds ?? []
    )
  );
  const reisserDocumentId = suppliers.find((supplier) =>
    /reisser/i.test(supplier.label)
  )?.id;
  const reisserAlternatives = offers
    .filter(
      (offer) =>
        offer.documentId === reisserDocumentId &&
        offer.line.role === "ALTERNATIVE" &&
        offer.line.interpretedTotalPrice === null
    )
    .map((offer) => {
      const containingOption = supplierOptions.find((option) =>
        option.matchedOfferLineIds.includes(offer.line.id)
      );
      const mainLines =
        containingOption?.matchedOfferLineIds
          .map((id) => offerById.get(id)?.line)
          .filter(
            (line) =>
              line &&
              !["OPTIONAL", "ALTERNATIVE"].includes(line.role)
          ) ?? [];
      return {
        lineId: offer.line.id,
        deterministicFallbackFlag: deterministicFallbackIds.has(
          offer.line.id
        ),
        page: offer.line.evidence[0]?.pageNumber ?? null,
        sourcePositionNumber: offer.line.sourcePositionNumber,
        supplierPositionNumber: offer.line.supplierPositionNumber,
        mainPricedOptionExists: mainLines.some(
          (line) => line?.interpretedTotalPrice !== null
        ),
        alternativeTotalMissing:
          offer.line.interpretedTotalPrice === null,
        influencesMandatoryBundle: false,
        managerDecisionRequired: false,
        evidenceIds: offer.line.evidence.map((evidence) => evidence.id)
      };
    });
  const queueCounts = {
    managerDecision: manualPositions.filter(
      (position) => position.reviewQueue === "MANAGER_DECISION"
    ).length,
    systemReview: manualPositions.filter(
      (position) => position.reviewQueue === "SYSTEM_REVIEW"
    ).length
  };
  const sourceLinksReady =
    analysis.basisPositions.every((basis) => basis.evidence.length > 0) &&
    analysis.supplierOptions
      .filter((option) => option.offerAvailability === "PRESENT")
      .every((option) => option.evidenceIds.length > 0);
  const report = {
    reportVersion: AUDIT_VERSION,
    generatedAt,
    previousAnalysisId: auditBaselineAnalysis.id,
    parentAnalysisId: previousAnalysis.id,
    analysisId: analysis.id,
    extractionRunsChanged: false,
    decisionsChanged: false,
    noComparableAudit,
    statusDistribution,
    queueCounts,
    reasonDistribution,
    reisserWahlweise: {
      fallbackCandidates: reisserAlternatives.length,
      deterministicFallbackFlags: reisserAlternatives.filter(
        (alternative) => alternative.deterministicFallbackFlag
      ).length,
      cachedAiAlternativesWithoutTotal: reisserAlternatives.filter(
        (alternative) => !alternative.deterministicFallbackFlag
      ).length,
      auditedAlternatives: reisserAlternatives.length,
      alternatives: reisserAlternatives
    },
    invariant,
    sourceLinksReady,
    demoReadiness: {
      status:
        invariant.valid &&
        sourceLinksReady &&
        noComparableAudit.every(
          (entry) =>
            entry.correctedStatus !== "NO_COMPARABLE_OFFER" ||
            !entry.hasPotentiallyOutcomeChangingLine
        )
          ? "DEMO_READY"
          : "NOT_DEMO_READY",
      unresolvedBlockers: manualPositions
        .filter((position) => position.reviewQueue === "SYSTEM_REVIEW")
        .map((position) => position.basis.positionNumber)
    },
    openAi: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
  };
  await persistence.saveAnalysis(analysis);
  const after = await persistence.read();
  if (stableHash(after.runs) !== runsBefore) {
    throw new Error("Immutable extraction runs changed during audit.");
  }
  if (
    stableHash(after.supplierDecisions) !== decisionsBefore ||
    stableHash(after.supplierDecisionReviewActions) !==
      decisionReviewsBefore
  ) {
    throw new Error("Human decision state changed during audit.");
  }
  await writeFile(
    path.resolve(root, ".data", "demo-readiness-audit.local.json"),
    `${JSON.stringify(report, null, 2)}\n`,
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
