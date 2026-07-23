import { describe, expect, it } from "vitest";
import { recommendationStatus } from "@/domain/recommendation";

const valid = {
  matchingConfirmed: true,
  priceValidated: true,
  quantityCompatible: true,
  unitCompatible: true,
  requiredScopeEquivalent: true,
  mandatoryComponentsIncluded: true,
  technicalDeviation: false,
  optionalSeparated: true,
  evidenceSufficient: true,
  offerAvailability: "PRESENT" as const
};

describe("recommendations", () => {
  it("only produces a clear recommendation when all gates pass", () => {
    expect(recommendationStatus(valid)).toBe("CLEAR_RECOMMENDATION");
    expect(recommendationStatus({ ...valid, matchingConfirmed: false })).toBe("MATCHING_UNCLEAR");
    expect(recommendationStatus({ ...valid, evidenceSufficient: false })).toBe(
      "DECISION_REQUIRED"
    );
  });

  it("prioritizes technical deviations and missing offers", () => {
    expect(recommendationStatus({ ...valid, technicalDeviation: true })).toBe(
      "TECHNICAL_DEVIATION"
    );
    expect(
      recommendationStatus({ ...valid, offerAvailability: "EXPLICIT_NO_OFFER" })
    ).toBe("NO_OFFER");
    expect(
      recommendationStatus({ ...valid, offerAvailability: "NOT_COVERED" })
    ).toBe("MATCHING_UNCLEAR");
  });
});
