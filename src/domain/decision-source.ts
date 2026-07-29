import type { DecisionEvidenceSource } from "@/domain/contracts";

type DecisionSourceLink = Pick<
  DecisionEvidenceSource,
  "documentId" | "documentRevisionId" | "pageNumber" | "evidenceId"
>;

export function decisionEvidenceHref(
  source: DecisionSourceLink,
  lineId?: string
): string {
  const params = new URLSearchParams({
    documentId: source.documentId,
    documentRevisionId: source.documentRevisionId,
    pageNumber: String(source.pageNumber),
    evidenceId: source.evidenceId
  });
  if (lineId) params.set("lineId", lineId);
  return `/evidence?${params.toString()}`;
}
