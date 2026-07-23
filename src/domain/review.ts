import type { OfferLine } from "@/domain/contracts";

export interface ReviewAction {
  id: string;
  issueId: string;
  entityId: string;
  field: string;
  action: "CONFIRM" | "CORRECT" | "CLEAR" | "CHANGE_ROLE" | "CONFIRM_MATCH" | "DECIDE";
  previousValue: unknown;
  newValue: unknown;
  operator: string;
  timestamp: string;
  reason: string;
  comment: string;
}

export function applyOfferLineReview(line: OfferLine, action: ReviewAction): OfferLine {
  if (line.lockedFields.includes(action.field) && action.action !== "CONFIRM") {
    throw new Error(`Field ${action.field} is locked by a previous operator decision.`);
  }

  if (!(action.field in line)) {
    throw new Error(`Unknown OfferLine field: ${action.field}`);
  }

  return {
    ...line,
    [action.field]: action.action === "CLEAR" ? null : action.newValue,
    verificationStatus: action.action === "CONFIRM" ? "HUMAN_CONFIRMED" : "HUMAN_CORRECTED",
    lockedFields: Array.from(new Set([...line.lockedFields, action.field]))
  } as OfferLine;
}

export function mayRunSemanticRecheck(attempt: number): boolean {
  return attempt < 1;
}
