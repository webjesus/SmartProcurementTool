import type {
  OfferAvailability,
  RecommendationStatus
} from "@/domain/contracts";

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
  offerAvailability: OfferAvailability;
}

export function recommendationStatus(input: RecommendationInput): RecommendationStatus {
  if (
    input.offerAvailability === "EXPLICIT_NO_OFFER" ||
    input.offerAvailability === "COVERED_WITHOUT_OFFER"
  ) {
    return "NO_OFFER";
  }
  if (input.offerAvailability === "NOT_COVERED" || !input.matchingConfirmed) {
    return "MATCHING_UNCLEAR";
  }
  if (input.technicalDeviation) return "TECHNICAL_DEVIATION";
  if (!input.requiredScopeEquivalent || !input.mandatoryComponentsIncluded) {
    return "DIFFERENT_SCOPE_OF_SUPPLY";
  }
  if (!input.priceValidated) return "PRICE_UNCLEAR";
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
