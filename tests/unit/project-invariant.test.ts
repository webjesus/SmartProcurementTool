import { describe, expect, it } from "vitest";
import { buildProjectCompletenessInvariant } from "@/domain/project-invariant";
import type { BasisPosition } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";

const basis: BasisPosition = {
  id: "basis-1",
  documentId: "basis-doc",
  parentId: null,
  positionNumber: "1.1.10.",
  description: "Kugelhahn",
  quantity: 1,
  unit: "St",
  technicalAttributes: [],
  manufacturerRequirements: [],
  requiredScope: [],
  notes: [],
  optional: false,
  alternative: false,
  heading: false,
  evidence: [],
  verificationStatus: "MACHINE_VALIDATED"
};

const review = {
  basis,
  options: [],
  coverage: {
    basisPositionId: basis.id,
    relevantSuppliers: [],
    processedRelevantSuppliers: [],
    irrelevantSpecializedSuppliers: [],
    explicitNoOfferSuppliers: [],
    missingExpectedSuppliers: [],
    missingSources: [],
    coverageStatus: "SUFFICIENT"
  },
  independent: {
    basisPositionId: basis.id,
    status: "MANAGER_EXPLANATION_REQUIRED",
    selectedSupplierOptionId: null,
    fullyComparableOptionIds: [],
    systemCheapestOptionId: null,
    nextComparableOptionId: null,
    comparableTotal: null,
    nextComparableTotal: null,
    saving: null,
    reasons: [],
    calculatedAt: "2026-07-24T12:00:00.000Z"
  },
  historical: {
    basisPositionId: basis.id,
    classification: "NOT_COMPARABLE",
    historicalMaterialEk: null,
    historicalMatchedOptionId: null,
    independentSelectedOptionId: null,
    reasons: []
  },
  liveStatus: "NO_COMPARABLE_OFFER"
} satisfies ProjectReviewPosition;

describe("project completeness invariant", () => {
  it("accepts exactly one known status per unique Basis leaf", () => {
    const invariant = buildProjectCompletenessInvariant({
      basisPositions: [basis],
      reviewPositions: [review],
      supplierOptions: [],
      decisions: []
    });
    expect(invariant.valid).toBe(true);
    expect(invariant.statusCount).toBe(1);
    expect(invariant.lvRows).toBe(1);
  });

  it("blocks duplicate positions and orphan decisions", () => {
    const invariant = buildProjectCompletenessInvariant({
      basisPositions: [basis, basis],
      reviewPositions: [review],
      supplierOptions: [],
      decisions: [
        {
          id: "orphan",
          basisPositionId: "missing",
          supplierDocumentId: null,
          status: "DEFERRED",
          comment: "wait",
          operator: "operator",
          timestamp: "2026-07-24T12:00:00.000Z"
        }
      ]
    });
    expect(invariant.valid).toBe(false);
    expect(invariant.duplicatePositionIds).toEqual(["basis-1"]);
    expect(invariant.orphanDecisionIds).toEqual(["orphan"]);
  });
});
