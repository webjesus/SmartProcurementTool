import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@/ai/openai-extraction-adapter";
import {
  CURRENT_DECISION_REASON_CATALOG,
  DecisionReasonCatalogSchema,
  activeDecisionReasons
} from "@/domain/decision-catalog";
import {
  SupplierDecisionV2Schema,
  type SupplierOption
} from "@/domain/contracts";
import {
  buildDecisionEvidenceSnapshot,
  buildDocumentRevisionIndex,
  createAutomaticSupplierDecision,
  validateDecisionEvidence,
  validateDecisionReasons,
  validateManagerDecisionComment
} from "@/domain/decision";
import { decisionEvidenceHref } from "@/domain/decision-source";
import { buildProjectReviewPositions } from "@/domain/project-review";
import {
  REVIEW_PACKAGE_VERSION,
  buildReviewPackage
} from "@/domain/review-package";
import type {
  PersistedPilotRun,
  PilotState
} from "@/storage/document-storage";
import { basisPosition, offerLine } from "../fixtures";

function extractionResult(
  documentId: string,
  kind: "BASIS_LV" | "SUPPLIER_OFFER",
  cacheKey: string
): ExtractionResult {
  return {
    envelope: {
      promptVersion: "fixture-prompt-v1",
      schemaVersion: "fixture-schema-v1",
      preprocessingVersion: "fixture-page-v1",
      extraction: {
        documentId,
        pageNumber: 1,
        pageMode: "DIGITAL",
        documentType: kind,
        discipline: "HEIZUNG",
        documentMetadataCandidates: [],
        sections: [],
        offerGroups:
          kind === "SUPPLIER_OFFER"
            ? [
                {
                  id: "group-1",
                  documentId,
                  label: "Angebot",
                  adjustments: [],
                  evidence: [],
                  lines: [offerLine]
                }
              ]
            : [],
        basisPositions: kind === "BASIS_LV" ? [basisPosition] : [],
        unresolvedNotes: []
      }
    },
    metadata: {
      modelId: "fixture-model",
      responseId: `response-${cacheKey}`,
      promptVersion: "fixture-prompt-v1",
      schemaVersion: "fixture-schema-v1",
      preprocessingVersion: "fixture-page-v1",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      attempt: 0,
      estimatedCostUsd: 0,
      error: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.000Z",
      cacheKey
    }
  };
}

function run(
  documentId: string,
  kind: "BASIS_LV" | "SUPPLIER_OFFER",
  asset: string
): PersistedPilotRun {
  return {
    id: `run-${documentId}`,
    document: {
      id: documentId,
      relativePath: `${documentId}.pdf`,
      pageNumber: 1,
      pageCount: 1,
      pageMode: "DIGITAL",
      documentType: kind,
      discipline: "HEIZUNG"
    },
    result: extractionResult(documentId, kind, `cache-${documentId}`),
    validationIssues: [],
    pageImageAsset: asset,
    cropAssets: {},
    recheck: null,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

const supplierOption: SupplierOption = {
  id: "option-1",
  basisPositionIds: [basisPosition.id],
  supplierDocumentId: "doc-offer",
  supplierLabel: "Supplier fixture",
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

function pilotState(): PilotState {
  return {
    version: 2,
    runs: [
      run("doc-basis", "BASIS_LV", "pages/basis-1.png"),
      run("doc-offer", "SUPPLIER_OFFER", "pages/offer-1.png")
    ],
    reviewActions: [],
    matchReviewActions: [],
    supplierDecisions: [],
    supplierDecisionReviewActions: [],
    auditEvents: [],
    analysis: {
      id: "analysis-1",
      basisDocumentId: "doc-basis",
      basisDocumentLabel: "Basis",
      basisPages: [1],
      basisPositionFrom: basisPosition.positionNumber,
      basisPositionTo: basisPosition.positionNumber,
      supplierDocuments: [
        { id: "doc-offer", label: "Supplier fixture", pages: [1] }
      ],
      basisPositions: [basisPosition],
      matchLinks: [],
      supplierOptions: [supplierOption],
      recommendations: [],
      generatedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

describe("decision reason catalog", () => {
  it("drives new active options without a UI code change", () => {
    const version = "test-catalog-v2";
    const extended = DecisionReasonCatalogSchema.parse({
      version,
      placeholder: false,
      reasons: [
        {
          ...CURRENT_DECISION_REASON_CATALOG.reasons[0],
          version
        },
        {
          code: "FUTURE_APPROVED_REASON",
          labelDe: "Später freigegebener Grund",
          descriptionDe: "Test-only catalog extension.",
          active: true,
          sortOrder: 1,
          requiresComment: false,
          allowsMultiple: false,
          scope: "GLOBAL",
          version
        }
      ]
    });

    expect(activeDecisionReasons(extended).map((reason) => reason.code)).toEqual([
      "FUTURE_APPROVED_REASON",
      "OTHER_REQUIRES_COMMENT"
    ]);
  });

  it("rejects an inactive reason for a new decision", () => {
    const version = "test-inactive-v1";
    const catalog = DecisionReasonCatalogSchema.parse({
      version,
      placeholder: false,
      reasons: [
        {
          code: "INACTIVE_REASON",
          labelDe: "Inaktiv",
          descriptionDe: "Nicht mehr für neue Entscheidungen verfügbar.",
          active: false,
          sortOrder: 1,
          requiresComment: false,
          allowsMultiple: false,
          scope: "GLOBAL",
          version
        }
      ]
    });
    expect(validateDecisionReasons(["INACTIVE_REASON"], "", catalog)).toEqual({
      valid: false,
      errors: ["DECISION_REASON_INACTIVE"]
    });
  });

  it("requires a non-empty comment for the placeholder", () => {
    expect(
      validateDecisionReasons(
        ["OTHER_REQUIRES_COMMENT"],
        "   ",
        CURRENT_DECISION_REASON_CATALOG
      ).errors
    ).toContain("DECISION_COMMENT_REQUIRED");
  });

  it("keeps the catalog version stored on an old decision", () => {
    const old = SupplierDecisionV2Schema.parse({
      id: "decision-old",
      basisPositionId: "basis-1",
      supplierDocumentId: null,
      status: "DEFERRED",
      selectedSupplierOptionId: null,
      selectedSupplierLineIds: [],
      reasonCodes: [],
      comment: "",
      evidenceSnapshot: null,
      documentRevisionIds: [],
      decidedBy: "operator",
      decidedAt: "2026-01-01T00:00:00.000Z",
      catalogVersion: "decision-reasons-placeholder-v0",
      previousDecisionId: null
    });
    expect(old.catalogVersion).toBe("decision-reasons-placeholder-v0");
    expect(CURRENT_DECISION_REASON_CATALOG.version).not.toBe(old.catalogVersion);
  });
});

describe("decision evidence snapshot", () => {
  it("requires both Basis and supplier source evidence", () => {
    expect(
      validateDecisionEvidence({
        basisPosition: { sources: [] },
        selectedLines: [{ sources: [] }]
      }).errors
    ).toEqual(["BASIS_EVIDENCE_REQUIRED", "SUPPLIER_EVIDENCE_REQUIRED"]);
  });

  it("stores exact revisions and regions and creates revision-bound links", () => {
    const state = pilotState();
    const snapshot = buildDecisionEvidenceSnapshot({
      state,
      basis: basisPosition,
      option: supplierOption,
      capturedAt: "2026-01-01T00:00:00.000Z"
    });
    const revisions = buildDocumentRevisionIndex(state.runs);
    const basisSource = snapshot.basisPosition.sources[0];
    const supplierSource = snapshot.selectedLines[0].sources[0];

    expect(basisSource.documentRevisionId).toBe(revisions["doc-basis"]);
    expect(basisSource.region).toEqual(basisPosition.evidence[0].region);
    expect(supplierSource.documentRevisionId).toBe(revisions["doc-offer"]);
    expect(supplierSource.region).toEqual(offerLine.evidence[0].region);
    expect(Object.fromEntries(
      new URL(
        decisionEvidenceHref(supplierSource, offerLine.id),
        "http://local"
      ).searchParams
    )).toEqual(Object.fromEntries(new URLSearchParams({
        documentId: "doc-offer",
        documentRevisionId: revisions["doc-offer"],
        pageNumber: "1",
        evidenceId: offerLine.evidence[0].id,
        lineId: offerLine.id
      })));
  });

  it("does not rewrite a stored snapshot when the current document revision changes", () => {
    const state = pilotState();
    const snapshot = buildDecisionEvidenceSnapshot({
      state,
      basis: basisPosition,
      option: supplierOption,
      capturedAt: "2026-01-01T00:00:00.000Z"
    });
    const storedRevision = snapshot.selectedLines[0].sources[0].documentRevisionId;
    state.runs[1] = {
      ...state.runs[1],
      result: extractionResult("doc-offer", "SUPPLIER_OFFER", "cache-doc-offer-v2")
    };

    expect(buildDocumentRevisionIndex(state.runs)["doc-offer"]).not.toBe(storedRevision);
    expect(snapshot.selectedLines[0].sources[0].documentRevisionId).toBe(storedRevision);
  });

  it("captures every supplier option visible when the decision was made", () => {
    const state = pilotState();
    const snapshot = buildDecisionEvidenceSnapshot({
      state,
      basis: basisPosition,
      option: supplierOption,
      capturedAt: "2026-01-01T00:00:00.000Z"
    });
    expect(snapshot.visibleSupplierOptions).toEqual([
      expect.objectContaining({
        optionId: supplierOption.id,
        lines: [expect.objectContaining({ lineId: offerLine.id })]
      })
    ]);
  });

  it("creates an evidence-bound automatic decision without a manager comment", () => {
    const automatic = createAutomaticSupplierDecision({
      id: "decision-auto",
      state: pilotState(),
      basis: basisPosition,
      option: supplierOption,
      decidedBy: "system",
      decidedAt: "2026-01-01T00:00:00.000Z"
    });
    expect(automatic.decisionType).toBe("AUTOMATIC_LOWEST_PRICE");
    expect(automatic.evidenceSnapshot?.selectedLines[0].lineId).toBe(offerLine.id);
  });
});

describe("manager comment gates", () => {
  it("allows a direct manual supplier selection without a mandatory comment", () => {
    expect(
      validateManagerDecisionComment({
        status: "SELECTED",
        decisionType: "MANUAL_SELECTION",
        comment: " "
      }).valid
    ).toBe(true);
  });

  it.each([
    ["SELECTED", "AUTOMATIC_OVERRIDE"],
    ["NONE_CORRECT", undefined]
  ] as const)("requires a comment for %s / %s", (status, decisionType) => {
    expect(
      validateManagerDecisionComment({
        status,
        decisionType,
        comment: " "
      }).errors
    ).toContain("DECISION_COMMENT_REQUIRED");
  });

  it("requires a meaningful free-text explanation for defer and additional review", () => {
    expect(
      validateManagerDecisionComment({ status: "DEFERRED", comment: "" }).valid
    ).toBe(false);
    expect(
      validateManagerDecisionComment({
        status: "ADDITIONAL_CHECK_REQUESTED",
        comment: "ok"
      }).valid
    ).toBe(false);
    const explanation =
      "Die vorhandenen Unterlagen reichen für eine belastbare Entscheidung noch nicht aus.";
    expect(
      validateManagerDecisionComment({
        status: "DEFERRED",
        comment: explanation
      }).valid
    ).toBe(true);
    expect(
      validateManagerDecisionComment({
        status: "ADDITIONAL_CHECK_REQUESTED",
        comment: explanation
      }).valid
    ).toBe(true);
  });
});

describe("portable review package", () => {
  it("exports decisions, revisions and evidence coordinates without PDF bytes", () => {
    const state = pilotState();
    const positions = buildProjectReviewPositions({
      basisPositions: state.analysis!.basisPositions,
      options: state.analysis!.supplierOptions,
      coverage: {
        activeSupplierDocumentIds: new Set(["doc-offer"]),
        allRelevantOffersProcessed: true,
        supplierCoverageSufficient: true,
        projectContextConfirmed: true,
        disciplineContextConfirmed: true,
        materialUncertainty: false
      },
      calculatedAt: "2026-01-01T00:00:00.000Z"
    });
    const reviewPackage = buildReviewPackage({
      projectId: "project-fixture",
      state,
      positions,
      exportedAt: "2026-01-01T00:00:00.000Z"
    });
    const serialized = JSON.stringify(reviewPackage);

    expect(reviewPackage.packageVersion).toBe(REVIEW_PACKAGE_VERSION);
    expect(reviewPackage.positions[0].evidence[0]).toEqual(
      expect.objectContaining({
        documentId: "doc-basis",
        pageNumber: 1,
        region: basisPosition.evidence[0].region
      })
    );
    expect(reviewPackage.sourceDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "doc-basis",
          documentRevisionIds: [expect.stringMatching(/^local-revision-/)]
        })
      ])
    );
    expect(reviewPackage.positions[0].supplierOptions?.[0]).toEqual(
      expect.objectContaining({
        readModelVersion: "operator-supplier-option-read-model-v1",
        priceProvenance: "SOURCE_GP",
        packageCompleteness: "COMPLETE",
        displayedTotal: 300
      })
    );
    expect(serialized).not.toContain("data:application/pdf");
    expect(serialized).not.toContain("%PDF");
  });
});
