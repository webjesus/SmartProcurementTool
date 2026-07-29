import type {
  BasisPosition,
  SupplierDecision,
  SupplierOption
} from "@/domain/contracts";
import type {
  LiveProjectPositionStatus,
  ProjectReviewPosition
} from "@/domain/project-review";

const STATUS_KEYS: readonly LiveProjectPositionStatus[] = [
  "AUTO_SELECTED_LOWEST_PRICE",
  "MANUAL_DECISION_REQUIRED",
  "MANUAL_DECIDED",
  "DEFERRED",
  "NO_COMPARABLE_OFFER",
  "PROCESSING_PENDING",
  "PROCESSING_ERROR"
];

export interface ProjectCompletenessInvariant {
  valid: boolean;
  totalBasisLeafPositions: number;
  lvRows: number;
  statusCount: number;
  statusCounts: Record<LiveProjectPositionStatus, number>;
  duplicatePositionIds: string[];
  duplicatePositionNumbers: string[];
  missingPositionIds: string[];
  orphanDecisionIds: string[];
  orphanSupplierOptionIds: string[];
  unknownStatusPositionIds: string[];
  problemPositionIds: string[];
}

function duplicates(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value, index, allValues) => allValues.indexOf(value) !== index
      )
    )
  );
}

function normalizedPositionNumber(value: string): string {
  const numbers = value.match(/\d+/g)?.slice(0, 3).map(Number);
  return numbers?.length === 3 ? numbers.join(".") : value.trim();
}

export function buildProjectCompletenessInvariant(input: {
  basisPositions: readonly BasisPosition[];
  reviewPositions: readonly ProjectReviewPosition[];
  supplierOptions: readonly SupplierOption[];
  decisions: readonly SupplierDecision[];
}): ProjectCompletenessInvariant {
  const leafPositions = input.basisPositions.filter(
    (position) => !position.heading
  );
  const basisIds = new Set(leafPositions.map((position) => position.id));
  const reviewIds = new Set(
    input.reviewPositions.map((position) => position.basis.id)
  );
  const statusCounts = Object.fromEntries(
    STATUS_KEYS.map((status) => [status, 0])
  ) as Record<LiveProjectPositionStatus, number>;
  const unknownStatusPositionIds: string[] = [];
  for (const position of input.reviewPositions) {
    if (STATUS_KEYS.includes(position.liveStatus)) {
      statusCounts[position.liveStatus] += 1;
    } else {
      unknownStatusPositionIds.push(position.basis.id);
    }
  }
  const duplicatePositionIds = duplicates(
    leafPositions.map((position) => position.id)
  );
  const duplicatePositionNumbers = duplicates(
    leafPositions.map((position) =>
      normalizedPositionNumber(position.positionNumber)
    )
  );
  const missingPositionIds = leafPositions
    .filter((position) => !reviewIds.has(position.id))
    .map((position) => position.id);
  const orphanDecisionIds = input.decisions
    .filter((decision) => !basisIds.has(decision.basisPositionId))
    .map((decision) => decision.id);
  const orphanSupplierOptionIds = input.supplierOptions
    .filter(
      (option) =>
        option.basisPositionIds.length === 0 ||
        option.basisPositionIds.some((id) => !basisIds.has(id))
    )
    .map((option) => option.id);
  const statusCount = Object.values(statusCounts).reduce(
    (sum, count) => sum + count,
    0
  );
  const problemPositionIds = Array.from(
    new Set([
      ...duplicatePositionIds,
      ...missingPositionIds,
      ...unknownStatusPositionIds,
      ...input.supplierOptions
        .filter((option) => orphanSupplierOptionIds.includes(option.id))
        .flatMap((option) => option.basisPositionIds)
    ])
  );
  const valid =
    duplicatePositionIds.length === 0 &&
    duplicatePositionNumbers.length === 0 &&
    missingPositionIds.length === 0 &&
    orphanDecisionIds.length === 0 &&
    orphanSupplierOptionIds.length === 0 &&
    unknownStatusPositionIds.length === 0 &&
    input.reviewPositions.length === leafPositions.length &&
    statusCount === leafPositions.length;
  return {
    valid,
    totalBasisLeafPositions: leafPositions.length,
    lvRows: input.reviewPositions.length,
    statusCount,
    statusCounts,
    duplicatePositionIds,
    duplicatePositionNumbers,
    missingPositionIds,
    orphanDecisionIds,
    orphanSupplierOptionIds,
    unknownStatusPositionIds,
    problemPositionIds
  };
}
