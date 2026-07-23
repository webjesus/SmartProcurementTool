import type { EvidenceReference, IssueCode, OfferLine } from "@/domain/contracts";
import { assertEvidenceOwnership } from "@/domain/repositories";

export interface ValidationIssue {
  id: string;
  code: IssueCode;
  severity: "BLOCKING" | "WARNING";
  field?: string;
  message: string;
}

export function parseGermanNumber(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/\s/g, "")
    .replace(/[€$]/g, "")
    .replace(/[^\d,.\-+]/g, "");

  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (comma > dot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (dot > comma && comma >= 0) {
    normalized = cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) ?? []).length > 1) {
    normalized = cleaned.replace(/\./g, "");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function pricesApproximatelyEqual(
  quantity: number,
  unitPrice: number,
  totalPrice: number,
  basis = 1,
  tolerance = 0.02
): boolean {
  if (basis <= 0) return false;
  const expected = (quantity * unitPrice) / basis;
  return Math.abs(expected - totalPrice) <= Math.max(0.02, Math.abs(totalPrice) * tolerance);
}

export function validateEvidence(
  evidence: EvidenceReference[],
  documentId: string,
  pageNumber: number,
  validTextItemIds: Set<string>
): ValidationIssue[] {
  if (evidence.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        code: "EVIDENCE_MISSING",
        severity: "BLOCKING",
        message: "Für dieses Feld fehlt ein prüfbarer Quellenbeleg."
      }
    ];
  }

  const invalid = evidence.some(
    (item) => !assertEvidenceOwnership(item, documentId, pageNumber, validTextItemIds)
  );
  return invalid
    ? [
        {
          id: crypto.randomUUID(),
          code: "EVIDENCE_CONFLICTING",
          severity: "BLOCKING",
          message: "Der Quellenbeleg gehört nicht zur angegebenen Dokumentseite."
        }
      ]
    : [];
}

export function validateOfferLine(line: OfferLine): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (line.interpretedUnitPrice !== null && line.interpretedTotalPrice !== null) {
    if (line.quantity === null || line.priceBasis === null) {
      issues.push({
        id: crypto.randomUUID(),
        code: "PRICE_BASIS_UNCLEAR",
        severity: "BLOCKING",
        field: "priceBasis",
        message: "Preis, Menge oder Preisbasis sind nicht eindeutig belegt."
      });
    } else if (
      !pricesApproximatelyEqual(
        line.quantity,
        line.interpretedUnitPrice,
        line.interpretedTotalPrice,
        line.priceBasis
      )
    ) {
      issues.push({
        id: crypto.randomUUID(),
        code: "PRICE_ARITHMETIC_MISMATCH",
        severity: "BLOCKING",
        field: "interpretedTotalPrice",
        message: "Menge × Einheitspreis stimmt nicht mit dem Gesamtpreis überein."
      });
    }
  }

  if (line.role === "OPTIONAL" && line.groupId === null) {
    issues.push({
      id: crypto.randomUUID(),
      code: "OPTIONAL_PRIMARY_AMBIGUOUS",
      severity: "WARNING",
      field: "role",
      message: "Optionalposition ist keiner Hauptposition eindeutig zugeordnet."
    });
  }

  if (line.evidence.length === 0) {
    issues.push({
      id: crypto.randomUUID(),
      code: "EVIDENCE_MISSING",
      severity: "BLOCKING",
      message: "Extrahierte Zeile besitzt keinen Quellenbeleg."
    });
  }

  return issues;
}

export function canMachineValidate(line: OfferLine, issues: ValidationIssue[]): boolean {
  return (
    line.evidence.some((e) => e.status === "VERIFIED_NATIVE" || e.status === "VERIFIED_VISUAL") &&
    !issues.some((issue) => issue.severity === "BLOCKING")
  );
}
