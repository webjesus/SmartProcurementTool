import { describe, expect, it } from "vitest";
import { decisionAnalysisVersionId, decisionProjectId } from "@/domain/decision-project";
import type { PilotAnalysis, SupplierOption } from "@/domain/contracts";
import { createInMemoryDecisionUnitOfWork } from "@/repositories/in-memory-decision-repositories";
import { RepositoryConflictError } from "@/repositories/decision-repositories";
import { DecisionSyncService } from "@/services/decision-sync-service";
import type { PilotState } from "@/storage/document-storage";
import { basisPosition, offerLine } from "../fixtures";

const supplierOption: SupplierOption = {
  id: "option-1",
  basisPositionIds: [basisPosition.id],
  supplierDocumentId: "doc-offer",
  supplierLabel: "Synthetic supplier",
  matchedOfferLineIds: [offerLine.id],
  matchLinkIds: ["match-1"],
  primaryPrice: 100,
  mandatoryComponentPrices: [],
  optionalPrices: [],
  pricedTotal: 300,
  comparableTotal: 300,
  quantity: 3,
  unit: "Stk",
  scopeOfSupply: ["Pumpe"],
  technicalDeviations: [],
  missingComponents: [],
  validationIssueIds: [],
  evidenceIds: [offerLine.evidence[0].id],
  quantityCompatible: true,
  unitCompatible: true,
  technicalCompatible: true,
  requiredScopeComplete: true,
  optionalSeparated: true,
  bundleCompatible: true,
  evidenceSufficient: true,
  extractionValidated: true,
  matchingAccepted: true,
  matchingReliable: true,
  offerAvailability: "PRESENT",
  materialScopeStatus: "COMPLETE_MATERIAL_SCOPE",
  reasons: [],
  status: "CLEAR_RECOMMENDATION"
};

const analysis: PilotAnalysis = {
  id: "analysis-central-sync",
  basisDocumentId: "doc-basis",
  basisDocumentLabel: "Synthetic Basis-LV",
  basisPages: [1],
  basisPositionFrom: basisPosition.positionNumber,
  basisPositionTo: basisPosition.positionNumber,
  supplierDocuments: [
    { id: "doc-offer", label: "Synthetic supplier", pages: [1] }
  ],
  basisPositions: [basisPosition],
  matchLinks: [],
  supplierOptions: [supplierOption],
  recommendations: [],
  generatedAt: "2026-01-01T00:00:00.000Z"
};

const state: PilotState = {
  version: 2,
  runs: [
    {
      id: "run-basis",
      document: {
        id: "doc-basis",
        relativePath: "synthetic-basis.pdf",
        pageNumber: 1,
        pageCount: 1,
        pageMode: "DIGITAL",
        documentType: "BASIS_LV",
        discipline: "HEIZUNG"
      },
      result: {
        envelope: {
          promptVersion: "fixture-v1",
          schemaVersion: "fixture-v1",
          preprocessingVersion: "fixture-v1",
          extraction: {
            documentId: "doc-basis",
            pageNumber: 1,
            pageMode: "DIGITAL",
            documentType: "BASIS_LV",
            discipline: "HEIZUNG",
            documentMetadataCandidates: [],
            sections: [],
            offerGroups: [],
            basisPositions: [basisPosition],
            unresolvedNotes: []
          }
        },
        metadata: {
          modelId: "fixture",
          responseId: "fixture-basis",
          promptVersion: "fixture-v1",
          schemaVersion: "fixture-v1",
          preprocessingVersion: "fixture-v1",
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          durationMs: 0,
          attempt: 0,
          estimatedCostUsd: 0,
          error: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.000Z",
          cacheKey: "fixture-basis"
        }
      },
      validationIssues: [],
      pageImageAsset: "pages/synthetic-basis.png",
      cropAssets: {},
      recheck: null,
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "run-offer",
      document: {
        id: "doc-offer",
        relativePath: "synthetic-offer.pdf",
        pageNumber: 1,
        pageCount: 1,
        pageMode: "DIGITAL",
        documentType: "SUPPLIER_OFFER",
        discipline: "HEIZUNG"
      },
      result: {
        envelope: {
          promptVersion: "fixture-v1",
          schemaVersion: "fixture-v1",
          preprocessingVersion: "fixture-v1",
          extraction: {
            documentId: "doc-offer",
            pageNumber: 1,
            pageMode: "DIGITAL",
            documentType: "SUPPLIER_OFFER",
            discipline: "HEIZUNG",
            documentMetadataCandidates: [],
            sections: [],
            offerGroups: [
              {
                id: "group-1",
                documentId: "doc-offer",
                label: "Synthetic offer",
                lines: [offerLine],
                adjustments: [],
                evidence: []
              }
            ],
            basisPositions: [],
            unresolvedNotes: []
          }
        },
        metadata: {
          modelId: "fixture",
          responseId: "fixture-offer",
          promptVersion: "fixture-v1",
          schemaVersion: "fixture-v1",
          preprocessingVersion: "fixture-v1",
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          durationMs: 0,
          attempt: 0,
          estimatedCostUsd: 0,
          error: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.000Z",
          cacheKey: "fixture-offer"
        }
      },
      validationIssues: [],
      pageImageAsset: "pages/synthetic-offer.png",
      cropAssets: {},
      recheck: null,
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  reviewActions: [],
  matchReviewActions: [],
  supplierDecisions: [],
  supplierDecisionReviewActions: [],
  auditEvents: [],
  analysis,
  analysisVersions: []
};

describe("central server decision synchronization", () => {
  it("loads a draft on a second device and atomically creates a final decision", async () => {
    const basis = analysis.basisPositions.find(
      (candidate) =>
        !candidate.heading &&
        candidate.evidence.length > 0 &&
        analysis.supplierOptions.some(
          (option) =>
            option.basisPositionIds.includes(candidate.id) &&
            option.matchedOfferLineIds.length > 0
        )
    );
    expect(basis).toBeDefined();
    const option = analysis.supplierOptions.find(
      (candidate) =>
        candidate.basisPositionIds.includes(basis!.id) &&
        candidate.matchedOfferLineIds.length > 0
    );
    expect(option).toBeDefined();

    const unit = createInMemoryDecisionUnitOfWork();
    const service = new DecisionSyncService(unit, {
      read: async () => structuredClone(state)
    });
    const userA = await unit.repositories.users.create("Gerät A");
    const userB = await unit.repositories.users.create("Gerät B");
    const projectId = decisionProjectId(analysis);
    const analysisVersionId = decisionAnalysisVersionId(analysis);
    const draft = await service.saveDraft({
      projectId,
      positionId: basis!.id,
      actorId: userA.id,
      actorSessionId: "session-a",
      draft: {
        selectedSupplierOptionId: option!.id,
        selectedBundleLineIds: [...option!.matchedOfferLineIds],
        rejectedOptionIds: [],
        reasonCodes: ["OTHER_REQUIRES_COMMENT"],
        outcome: "SELECTED",
        comment: "Die Quellen wurden auf Gerät A geöffnet und geprüft.",
        analysisVersionId,
        expectedVersion: 0,
        deviceSessionId: "device-a"
      }
    });

    const secondDevice = await service.getDraft(
      projectId,
      basis!.id,
      analysisVersionId
    );
    expect(secondDevice).toMatchObject({
      id: draft.id,
      selectedSupplierOptionId: option!.id,
      selectedBundleLineIds: option!.matchedOfferLineIds,
      updatedByDisplayName: "Gerät A"
    });

    await service.saveDraft({
      projectId,
      positionId: basis!.id,
      actorId: userB.id,
      actorSessionId: "session-b",
      draft: {
        ...draft,
        comment:
          "Die Quellen wurden auf Gerät B vollständig ergänzt und geprüft.",
        expectedVersion: draft.version,
        deviceSessionId: "device-b"
      }
    });
    await expect(
      service.saveDraft({
        projectId,
        positionId: basis!.id,
        actorId: userA.id,
        actorSessionId: "session-a",
        draft: {
          ...draft,
          comment: "Diese veraltete Fassung darf nicht still überschreiben.",
          expectedVersion: draft.version,
          deviceSessionId: "device-a"
        }
      })
    ).rejects.toBeInstanceOf(RepositoryConflictError);

    const decision = await service.createDecision({
      projectId,
      positionId: basis!.id,
      actorId: userB.id,
      decision: {
        selectedSupplierOptionId: option!.id,
        selectedBundleLineIds: [...option!.matchedOfferLineIds],
        rejectedOptionIds: [],
        outcome: "SELECTED",
        reasonCodes: ["OTHER_REQUIRES_COMMENT"],
        comment:
          "Die vollständige Variante wurde anhand der Basis- und Angebotsquellen nachvollziehbar geprüft.",
        analysisVersionId,
        expectedDecisionVersion: 0,
        decisionType: "MANUAL_SELECTION"
      }
    });

    expect(decision).toMatchObject({
      decisionVersion: 1,
      decidedByDisplayName: "Gerät B",
      selectedBundleLineIds: option!.matchedOfferLineIds
    });
    expect(decision.evidenceSnapshot).toBeTruthy();
    expect(await service.getDraft(projectId, basis!.id, analysisVersionId))
      .toBeNull();
    expect((await unit.repositories.events.list(projectId, basis!.id)).map(
      (event) => event.eventType
    )).toEqual(expect.arrayContaining([
      "DRAFT_CREATED",
      "DRAFT_UPDATED",
      "FINAL_DECISION_CREATED",
      "REVIEW_ACTION_CREATED"
    ]));
  });
});
