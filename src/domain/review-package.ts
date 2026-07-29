import { z } from "zod";
import {
  SupplierDecisionReviewActionSchema,
  SupplierDecisionSchema
} from "@/domain/contracts";
import { buildDocumentRevisionIndex } from "@/domain/decision";
import {
  BacktestClassificationSchema,
  IndependentDecisionStatusSchema,
  LiveProjectPositionStatusSchema,
  PositionCoverageStatusSchema,
  type ProjectReviewPosition
} from "@/domain/project-review";
import type { PilotState } from "@/storage/document-storage";
import { buildOperatorSupplierOptionReadModel } from "@/domain/operator-supplier-option-read-model";
import {
  CentralSupplierDecisionSchema,
  DecisionDraftRecordSchema,
  DecisionEventRecordSchema,
  type CentralSupplierDecision,
  type DecisionDraftRecord,
  type DecisionEventRecord
} from "@/domain/central-decision";

export const REVIEW_PACKAGE_VERSION = "spt-review-package-v1";

export const ReviewPackagePositionSchema = z.object({
  basisPositionId: z.string(),
  basisPositionNumber: z.string(),
  description: z.string(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  supplierOptions: z.array(
    z.object({
      id: z.string(),
      supplierLabel: z.string(),
      status: z.string(),
      pricedTotal: z.number().nullable(),
      comparableTotal: z.number().nullable(),
      matchedOfferLineIds: z.array(z.string()),
      readModelVersion: z.string().optional(),
      supplierBrandId: z.string().optional(),
      manufacturerBrandId: z.string().nullable().optional(),
      priceProvenance: z.string().optional(),
      packageCompleteness: z.string().optional(),
      displayedTotal: z.number().nullable().optional()
    }).strict()
  ).optional(),
  selectedSupplierLabel: z.string().nullable().optional(),
  decisionComments: z.array(z.string()).optional(),
  independentStatus: IndependentDecisionStatusSchema,
  liveStatus: LiveProjectPositionStatusSchema.optional(),
  coverage: z.object({
    relevantSuppliers: z.array(z.string()),
    processedRelevantSuppliers: z.array(z.string()),
    irrelevantSpecializedSuppliers: z.array(z.string()),
    explicitNoOfferSuppliers: z.array(z.string()),
    missingExpectedSuppliers: z.array(z.string()),
    coverageStatus: PositionCoverageStatusSchema
  }).strict().optional(),
  independentSelectedOptionId: z.string().nullable(),
  fullyComparableOptionIds: z.array(z.string()),
  comparableTotal: z.number().nullable(),
  nextComparableTotal: z.number().nullable(),
  discrepancyReasons: z.array(z.string()),
  historicalClassification: BacktestClassificationSchema,
  historicalMaterialEk: z.number().nullable(),
  historicalMatchedOptionId: z.string().nullable(),
  evidence: z.array(
    z.object({
      evidenceId: z.string(),
      documentId: z.string(),
      documentRevisionId: z.string(),
      pageNumber: z.number().int().positive(),
      region: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number()
      }).strict()
    }).strict()
  )
}).strict();

export const ReviewPackageSchema = z.object({
  packageVersion: z.literal(REVIEW_PACKAGE_VERSION),
  projectId: z.string(),
  exportedAt: z.string().datetime(),
  projectRunVersions: z.array(
    z.object({
      analysisId: z.string(),
      generatedAt: z.string().datetime()
    }).strict()
  ),
  sourceDocuments: z.array(
    z.object({
      documentId: z.string(),
      documentRevisionIds: z.array(z.string()),
      relativePath: z.string()
    }).strict()
  ),
  positions: z.array(ReviewPackagePositionSchema),
  decisions: z.array(SupplierDecisionSchema),
  decisionReviewActions: z.array(SupplierDecisionReviewActionSchema),
  centralServer: z.object({
    mode: z.literal("CENTRAL_SERVER"),
    drafts: z.array(DecisionDraftRecordSchema),
    decisions: z.array(CentralSupplierDecisionSchema),
    events: z.array(DecisionEventRecordSchema),
    users: z.array(z.object({
      id: z.string().uuid(),
      displayName: z.string()
    }).strict())
  }).strict().optional()
}).strict();
export type ReviewPackage = z.infer<typeof ReviewPackageSchema>;

export function buildReviewPackage(input: {
  projectId: string;
  state: PilotState;
  positions: readonly ProjectReviewPosition[];
  centralServerData?: {
    drafts: DecisionDraftRecord[];
    decisions: CentralSupplierDecision[];
    events: DecisionEventRecord[];
  };
  exportedAt?: string;
}): ReviewPackage {
  const centralDecisions = input.centralServerData?.decisions ?? [];
  const currentRevisions = buildDocumentRevisionIndex(input.state.runs);
  const offerLineIndex = new Map(
    input.state.runs.flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => [line.id, line] as const)
      )
    )
  );
  const revisionIdsByDocument = new Map<string, Set<string>>();
  for (const decision of input.state.supplierDecisions) {
    if (!("evidenceSnapshot" in decision) || !decision.evidenceSnapshot) continue;
    for (const revisionId of decision.documentRevisionIds) {
      for (const source of [
        ...decision.evidenceSnapshot.basisPosition.sources,
        ...decision.evidenceSnapshot.selectedLines.flatMap((line) => line.sources),
        ...(decision.evidenceSnapshot.visibleSupplierOptions ?? []).flatMap(
          (option) => option.lines.flatMap((line) => line.sources)
        )
      ]) {
        if (source.documentRevisionId !== revisionId) continue;
        const ids =
          revisionIdsByDocument.get(source.documentId) ?? new Set<string>();
        ids.add(revisionId);
        revisionIdsByDocument.set(source.documentId, ids);
      }
    }
  }
  const sourceDocuments = Array.from(
    new Map(
      input.state.runs.map((run) => [
        run.document.id,
        {
          documentId: run.document.id,
          documentRevisionIds: [
            ...new Set([
              ...(revisionIdsByDocument.get(run.document.id) ?? []),
              ...(currentRevisions[run.document.id]
                ? [currentRevisions[run.document.id]]
                : [])
            ])
          ],
          relativePath: run.document.relativePath
        }
      ])
    ).values()
  );
  return ReviewPackageSchema.parse({
    packageVersion: REVIEW_PACKAGE_VERSION,
    projectId: input.projectId,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    projectRunVersions: input.state.analysis
      ? [
          {
            analysisId: input.state.analysis.id,
            generatedAt: input.state.analysis.generatedAt
          }
        ]
      : [],
    sourceDocuments,
    positions: input.positions.map((position) => ({
      basisPositionId: position.basis.id,
      basisPositionNumber: position.basis.positionNumber,
      description: position.basis.description,
      quantity: position.basis.quantity,
      unit: position.basis.unit,
      supplierOptions: position.options.map((option) => {
        const model = buildOperatorSupplierOptionReadModel({
          basis: position.basis,
          option,
          offerLines: offerLineIndex
        });
        return {
          id: option.id,
          supplierLabel: model.supplierDisplayName,
          status: option.status,
          pricedTotal: option.pricedTotal,
          comparableTotal: option.comparableTotal,
          matchedOfferLineIds: option.matchedOfferLineIds,
          readModelVersion: model.version,
          supplierBrandId: model.supplierBrandId,
          manufacturerBrandId: model.manufacturerBrandId,
          priceProvenance: model.priceProvenance,
          packageCompleteness: model.packageCompleteness,
          displayedTotal: model.price.total
        };
      }),
      selectedSupplierLabel: position.options.find((option) => {
        const latest = centralDecisions
          .filter((decision) => decision.positionId === position.basis.id)
          .sort((left, right) => left.decisionVersion - right.decisionVersion)
          .at(-1);
        return option.id === (
          latest?.selectedSupplierOptionId ??
          position.independent.selectedSupplierOptionId
        );
      })?.supplierLabel ?? null,
      decisionComments: centralDecisions.length
        ? centralDecisions
            .filter(
              (decision) =>
                decision.positionId === position.basis.id &&
                decision.comment.trim().length > 0
            )
            .map((decision) => decision.comment)
        : input.state.supplierDecisions
            .filter(
              (decision) =>
                decision.basisPositionId === position.basis.id &&
                decision.comment.trim().length > 0
            )
            .map((decision) => decision.comment),
      independentStatus: position.independent.status,
      liveStatus: position.liveStatus,
      coverage: {
        relevantSuppliers: position.coverage.relevantSuppliers,
        processedRelevantSuppliers:
          position.coverage.processedRelevantSuppliers,
        irrelevantSpecializedSuppliers:
          position.coverage.irrelevantSpecializedSuppliers,
        explicitNoOfferSuppliers:
          position.coverage.explicitNoOfferSuppliers,
        missingExpectedSuppliers:
          position.coverage.missingExpectedSuppliers,
        coverageStatus: position.coverage.coverageStatus
      },
      independentSelectedOptionId:
        position.independent.selectedSupplierOptionId,
      fullyComparableOptionIds: position.independent.fullyComparableOptionIds,
      comparableTotal: position.independent.comparableTotal,
      nextComparableTotal: position.independent.nextComparableTotal,
      discrepancyReasons: [
        ...position.independent.reasons,
        ...position.historical.reasons
      ],
      historicalClassification: position.historical.classification,
      historicalMaterialEk: position.historical.historicalMaterialEk,
      historicalMatchedOptionId:
        position.historical.historicalMatchedOptionId,
      evidence: [
        ...position.basis.evidence,
        ...position.options.flatMap((option) =>
          option.matchedOfferLineIds.flatMap(
            (lineId) => offerLineIndex.get(lineId)?.evidence ?? []
          )
        )
      ].flatMap((evidence) => {
        const documentRevisionId = currentRevisions[evidence.documentId];
        return documentRevisionId
          ? [{
              evidenceId: evidence.id,
              documentId: evidence.documentId,
              documentRevisionId,
              pageNumber: evidence.pageNumber,
              region: evidence.region
            }]
          : [];
      })
    })),
    decisions: input.state.supplierDecisions,
    decisionReviewActions: input.state.supplierDecisionReviewActions,
    centralServer: input.centralServerData
      ? {
          mode: "CENTRAL_SERVER",
          ...input.centralServerData,
          users: [
            ...new Map(
              [
                ...input.centralServerData.events.map((event) => [
                  event.actorId,
                  "Importierter Benutzer"
                ] as const),
                ...input.centralServerData.drafts.map((draft) => [
                  draft.updatedBy,
                  draft.updatedByDisplayName
                ] as const),
                ...input.centralServerData.drafts.map((draft) => [
                  draft.userId,
                  draft.userId === draft.updatedBy
                    ? draft.updatedByDisplayName
                    : "Importierter Benutzer"
                ] as const),
                ...input.centralServerData.decisions.map((decision) => [
                  decision.decidedBy,
                  decision.decidedByDisplayName
                ] as const)
              ]
            ).entries()
          ].map(([id, displayName]) => ({ id, displayName }))
        }
      : undefined
  });
}
