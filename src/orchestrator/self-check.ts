import type {
  BasisRecommendation,
  MatchLink,
  OfferLine,
  SupplierDecision,
  SupplierOption
} from "@/domain/contracts";
import { pricesApproximatelyEqual } from "@/domain/validation";

export interface SelfCheckResult {
  ok: boolean;
  errors: string[];
}

export function selfCheckExtraction(lines: OfferLine[]): SelfCheckResult {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const line of lines) {
    if (ids.has(line.id)) errors.push(`Duplicate offer line id: ${line.id}`);
    ids.add(line.id);
    for (const evidence of line.evidence) {
      if (!evidence.documentId || evidence.pageNumber < 1) {
        errors.push(`Invalid evidence ownership for line ${line.id}`);
      }
    }
    if (
      line.quantity !== null &&
      line.interpretedUnitPrice !== null &&
      line.interpretedTotalPrice !== null &&
      !pricesApproximatelyEqual(
        line.quantity,
        line.interpretedUnitPrice,
        line.interpretedTotalPrice,
        line.priceBasis ?? 1
      )
    ) {
      errors.push(`Arithmetic mismatch for line ${line.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function selfCheckMatching(
  links: MatchLink[],
  lineRoleById: ReadonlyMap<string, OfferLine["role"]>
): SelfCheckResult {
  const errors: string[] = [];
  const primaryAssignments = new Map<string, Set<string>>();
  for (const link of links) {
    if (link.kind === "MANY_TO_MANY" && !link.confirmedByOperator) {
      errors.push(`Unconfirmed many-to-many link: ${link.id}`);
    }
    for (const lineId of link.offerLineIds) {
      if (lineRoleById.get(lineId) === "OPTIONAL" && link.status === "REQUIRED_COMPONENT") {
        errors.push(`Optional line ${lineId} classified as mandatory`);
      }
      if (lineRoleById.get(lineId) === "PRIMARY") {
        const positions = primaryAssignments.get(lineId) ?? new Set<string>();
        link.basisPositionIds.forEach((positionId) => positions.add(positionId));
        primaryAssignments.set(lineId, positions);
      }
    }
  }
  for (const [lineId, positions] of primaryAssignments) {
    if (positions.size > 1) {
      errors.push(`Primary line ${lineId} assigned to incompatible positions`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function selfCheckComparison(
  options: SupplierOption[],
  recommendations: BasisRecommendation[],
  decisionsBefore: SupplierDecision[],
  decisionsAfter: SupplierDecision[]
): SelfCheckResult {
  const errors: string[] = [];
  for (const option of options) {
    if (
      option.comparableTotal !== null &&
      !(
        option.quantityCompatible &&
        option.unitCompatible &&
        option.technicalCompatible &&
        option.requiredScopeComplete &&
        option.evidenceSufficient &&
        option.extractionValidated &&
        option.matchingReliable
      )
    ) {
      errors.push(`Unconfirmed comparableTotal for option ${option.id}`);
    }
  }
  for (const recommendation of recommendations) {
    if (recommendation.recommendedSupplierDocumentId !== null) {
      errors.push(`Supplier auto-selection is forbidden for ${recommendation.basisPositionId}`);
    }
  }
  if (JSON.stringify(decisionsBefore) !== JSON.stringify(decisionsAfter)) {
    errors.push("Human supplier decisions changed during comparison");
  }
  return { ok: errors.length === 0, errors };
}
