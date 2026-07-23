import type { RecommendationStatus } from "@/domain/contracts";

export interface RecommendationInput {
  matchingConfirmed: boolean;
  priceValidated: boolean;
  quantityCompatible: boolean;
  unitCompatible: boolean;
  requiredScopeEquivalent: boolean;
  mandatoryComponentsIncluded: boolean;
  technicalDeviation: boolean;
  optionalSeparated: boolean;
  evidenceSufficient: boolean;
  hasOffer: boolean;
}

export function recommendationStatus(input: RecommendationInput): RecommendationStatus {
  if (!input.hasOffer) return "NO_OFFER";
  if (input.technicalDeviation) return "TECHNICAL_DEVIATION";
  if (!input.priceValidated) return "PRICE_UNCLEAR";
  if (!input.matchingConfirmed) return "MATCHING_UNCLEAR";
  if (!input.requiredScopeEquivalent || !input.mandatoryComponentsIncluded) {
    return "DIFFERENT_SCOPE_OF_SUPPLY";
  }
  if (
    input.quantityCompatible &&
    input.unitCompatible &&
    input.optionalSeparated &&
    input.evidenceSufficient
  ) {
    return "CLEAR_RECOMMENDATION";
  }
  return "DECISION_REQUIRED";
}
