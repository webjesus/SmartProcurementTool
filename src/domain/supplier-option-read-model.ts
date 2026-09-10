import type { OfferLine, SupplierOption } from "@/domain/contracts";

export type SupplierPriceState =
  | "SOURCE_CONFIRMED_TOTAL"
  | "SYSTEM_CALCULATED_TOTAL"
  | "UNIT_PRICE_ONLY"
  | "MISSING";

export type SupplierPriceDisplay = {
  total: number | null;
  unitPrice: number | null;
  priceBasis: number | null;
  state: SupplierPriceState;
  labelDe: string;
  scope: "SINGLE_LINE" | "PACKAGE_TOTAL" | "PRIMARY_ONLY" | "UNKNOWN";
  arithmeticWarning: boolean;
};

export type SupplierDisplayRole =
  | "PRIMARY"
  | "REQUIRED_COMPONENT"
  | "COMPONENT"
  | "OPTIONAL_COMPONENT"
  | "ALTERNATIVE"
  | "UNKNOWN";

export const SUPPLIER_DISPLAY_ROLE_RULE_VERSION =
  "supplier-display-role-v1" as const;
export const SUPPLIER_OPTION_READ_MODEL_VERSION =
  "supplier-option-read-model-v1" as const;

export type SupplierOptionValidity =
  | "REAL_SELECTABLE_OPTION"
  | "REAL_OPTION_PRICE_MISSING"
  | "MATCHING_REVIEW_REQUIRED"
  | "UNASSIGNED_SUPPLIER"
  | "EXPLICIT_NO_OFFER"
  | "NO_RELEVANT_DOCUMENT";

export type SupplierSourceTargetStatus =
  | "EXACT"
  | "PAGE_CONTEXT"
  | "INVALID";

export type SupplierSourceValidation = {
  status: SupplierSourceTargetStatus;
  evidenceId: string | null;
  pageNumber: number | null;
  reasonDe: string;
};

export function supplierOptionLines(
  option: SupplierOption,
  offerLines: ReadonlyMap<string, OfferLine>
): OfferLine[] {
  return option.matchedOfferLineIds
    .map((lineId) => offerLines.get(lineId))
    .filter((line): line is OfferLine => Boolean(line));
}

export function supplierLineHasSource(line: OfferLine | undefined): boolean {
  return Boolean(
    line?.id &&
      line.evidence.some(
        (evidence) =>
          Boolean(evidence.documentId) &&
          Number.isInteger(evidence.pageNumber) &&
          evidence.pageNumber > 0 &&
          Boolean(evidence.id)
      )
  );
}

export function isRealSupplierOption(
  option: SupplierOption,
  offerLines: ReadonlyMap<string, OfferLine>
): boolean {
  return supplierOptionLines(option, offerLines).some(supplierLineHasSource);
}

export function primarySupplierLine(lines: readonly OfferLine[]): OfferLine | undefined {
  return (
    lines.find((line) => line.role === "PRIMARY") ??
    lines.find((line) => line.interpretedTotalPrice !== null) ??
    lines[0]
  );
}

function requiredPricedLines(lines: readonly OfferLine[]): OfferLine[] {
  return lines.filter((line) =>
    [
      "PRIMARY",
      "REQUIRED_COMPONENT",
      "MANDATORY_COMPONENT",
      "INCLUDED_ACCESSORY"
    ].includes(line.role)
  );
}

export function supplierPriceDisplay(
  option: SupplierOption,
  lines: readonly OfferLine[]
): SupplierPriceDisplay {
  const primary = primarySupplierLine(lines);
  // primaryPrice is a total, not an EP. Unknown unit prices stay unknown.
  const unitPrice = primary?.interpretedUnitPrice ?? null;
  const priceBasis = primary?.priceBasis != null && Number.isFinite(primary.priceBasis) && primary.priceBasis > 0 ? primary.priceBasis : null;
  const calculatedTotal = unitPrice !== null && Number.isFinite(unitPrice) &&
    primary?.quantity != null && Number.isFinite(primary.quantity) && priceBasis !== null
    ? Math.round(unitPrice * primary.quantity / priceBasis * 100) / 100 : null;
  const optionTotal = option.comparableTotal ?? option.pricedTotal;
  const requiredLines = requiredPricedLines(lines);
  const sourceTotals = requiredLines
    .map((line) => line.interpretedTotalPrice)
    .filter((value): value is number => value !== null);
  const sourceSum =
    sourceTotals.length === requiredLines.length && sourceTotals.length > 0
      ? Math.round(sourceTotals.reduce((sum, value) => sum + value, 0) * 100) /
        100
      : null;
  const optionTotalConfirmed =
    optionTotal !== null &&
    sourceSum !== null &&
    Math.abs(sourceSum - optionTotal) <= 0.02;
  const arithmeticWarning =
    primary?.interpretedTotalPrice !== null &&
    primary?.interpretedTotalPrice !== undefined &&
    calculatedTotal !== null &&
    Math.abs(primary.interpretedTotalPrice - calculatedTotal) >
      Math.max(0.02, Math.abs(primary.interpretedTotalPrice) * 0.001);

  if (optionTotalConfirmed) {
    return {
      total: optionTotal,
      unitPrice,
      priceBasis,
      state: "SOURCE_CONFIRMED_TOTAL",
      labelDe: "Gesamtpreis laut Quelle",
      scope:
        requiredLines.length > 1
          ? "PACKAGE_TOTAL"
          : lines.length > requiredLines.length
            ? "PRIMARY_ONLY"
            : "SINGLE_LINE",
      arithmeticWarning
    };
  }
  if (
    primary?.interpretedTotalPrice !== null &&
    primary?.interpretedTotalPrice !== undefined
  ) {
    return {
      total: primary.interpretedTotalPrice,
      unitPrice,
      priceBasis,
      state: "SOURCE_CONFIRMED_TOTAL",
      labelDe: "Gesamtpreis laut Quelle",
      scope: lines.length > 1 ? "PRIMARY_ONLY" : "SINGLE_LINE",
      arithmeticWarning
    };
  }
  if (optionTotal !== null && requiredLines.length > 0) {
    const derivedFromUnitPrice =
      calculatedTotal !== null && Math.abs(optionTotal - calculatedTotal) <= 0.02;
    return {
      total: optionTotal,
      unitPrice,
      priceBasis,
      state: "SYSTEM_CALCULATED_TOTAL",
      labelDe: derivedFromUnitPrice
        ? priceBasis === 1 ? "Aus EP × Menge berechnet" : "Aus EP × Menge / Preisbasis berechnet"
        : "Berechneter Gesamtpreis",
      scope: requiredLines.length > 1 ? "PACKAGE_TOTAL" : "SINGLE_LINE",
      arithmeticWarning
    };
  }
  if (
    calculatedTotal !== null
  ) {
    return {
      total: calculatedTotal,
      unitPrice,
      priceBasis,
      state: "SYSTEM_CALCULATED_TOTAL",
      labelDe: priceBasis === 1 ? "Aus EP × Menge berechnet" : "Aus EP × Menge / Preisbasis berechnet",
      scope: lines.length > 1 ? "PRIMARY_ONLY" : "SINGLE_LINE",
      arithmeticWarning
    };
  }
  if (unitPrice !== null && unitPrice !== undefined) {
    return {
      total: null,
      unitPrice,
      priceBasis,
      state: "UNIT_PRICE_ONLY",
      labelDe: "Gesamtpreis nicht gefunden",
      scope: lines.length > 1 ? "PRIMARY_ONLY" : "SINGLE_LINE",
      arithmeticWarning
    };
  }
  return {
    total: null,
    unitPrice: null,
    priceBasis,
    state: "MISSING",
    labelDe: "Preis nicht gefunden",
    scope: "UNKNOWN",
    arithmeticWarning: false
  };
}

export function validateSupplierSourceTarget(input: {
  option: SupplierOption;
  line: OfferLine;
  activeRevisionId: string | null;
  pageCount: number | null;
}): SupplierSourceValidation {
  if (!input.activeRevisionId || !input.pageCount) {
    return {
      status: "INVALID",
      evidenceId: null,
      pageNumber: null,
      reasonDe: "Dokumentrevision oder Seitenzahl ist nicht verfügbar"
    };
  }
  const pageCount = input.pageCount;
  const evidence = input.line.evidence.find(
    (candidate) =>
      candidate.documentId === input.option.supplierDocumentId &&
      Number.isInteger(candidate.pageNumber) &&
      candidate.pageNumber > 0 &&
      candidate.pageNumber <= pageCount
  );
  if (!evidence) {
    return {
      status: "INVALID",
      evidenceId: null,
      pageNumber: null,
      reasonDe: "Keine passende Belegseite für die Angebotszeile"
    };
  }
  const exactRegion =
    evidence.region.width > 0 &&
    evidence.region.height > 0 &&
    evidence.region.x >= 0 &&
    evidence.region.y >= 0 &&
    evidence.region.x + evidence.region.width <= 1.001 &&
    evidence.region.y + evidence.region.height <= 1.001;
  return {
    status: exactRegion ? "EXACT" : "PAGE_CONTEXT",
    evidenceId: evidence.id,
    pageNumber: evidence.pageNumber,
    reasonDe: exactRegion
      ? "Genaue Belegstelle verfügbar"
      : "Genaue Markierung nicht verfügbar"
  };
}

export function classifySupplierOption(input: {
  option: SupplierOption;
  lines: readonly OfferLine[];
  sourceValid: boolean;
  relevantDocument?: boolean;
}): SupplierOptionValidity {
  if (input.relevantDocument === false) return "NO_RELEVANT_DOCUMENT";
  if (
    input.option.offerAvailability === "EXPLICIT_NO_OFFER" ||
    input.option.materialScopeStatus === "EXPLICIT_NO_OFFER"
  ) {
    return "EXPLICIT_NO_OFFER";
  }
  if (!input.option.matchingAccepted && !input.option.matchingReliable) {
    return "MATCHING_REVIEW_REQUIRED";
  }
  const hasProduct = input.lines.some(
    (line) =>
      line.description.trim().length > 0 ||
      Boolean(line.articleNumber?.trim()) ||
      Boolean(line.supplierPositionNumber?.trim())
  );
  if (!input.lines.length || !hasProduct || !input.sourceValid) {
    return "UNASSIGNED_SUPPLIER";
  }
  const price = supplierPriceDisplay(input.option, input.lines);
  return price.state === "MISSING"
    ? "REAL_OPTION_PRICE_MISSING"
    : "REAL_SELECTABLE_OPTION";
}

export function isSelectableSupplierOption(
  validity: SupplierOptionValidity
): boolean {
  return (
    validity === "REAL_SELECTABLE_OPTION" ||
    validity === "REAL_OPTION_PRICE_MISSING"
  );
}

/**
 * Display-only correction v1.
 *
 * Some supplier bundle extractions label every row as ALTERNATIVE although the
 * rows share one LV reference and have ordered, priced source positions. The
 * immutable extraction remains unchanged: only the first row is displayed as
 * the main item and following rows as neutral components.
 */
export function supplierDisplayRole(
  line: OfferLine,
  lines: readonly OfferLine[]
): SupplierDisplayRole {
  if (line.role === "PRIMARY") return "PRIMARY";
  if (line.role === "MANDATORY_COMPONENT") return "REQUIRED_COMPONENT";
  if (line.role === "OPTIONAL" || line.role === "INCLUDED_ACCESSORY") {
    return "OPTIONAL_COMPONENT";
  }
  if (line.role !== "ALTERNATIVE") return "UNKNOWN";

  const allAlternativeBundle =
    lines.length > 1 &&
    lines.every((candidate) => candidate.role === "ALTERNATIVE") &&
    !lines.some((candidate) =>
      /\b(wahlweise|alternative|alternativ\s+zu|oder\s+gleichwertig)\b/i.test(
        candidate.description
      )
    ) &&
    new Set(lines.map((candidate) => candidate.sourcePositionNumber).filter(Boolean))
      .size === 1;
  if (!allAlternativeBundle) return "ALTERNATIVE";
  return lines[0]?.id === line.id ? "PRIMARY" : "COMPONENT";
}

export function supplierDisplayRoleLabel(
  role: SupplierDisplayRole
): string {
  const labels: Record<SupplierDisplayRole, string> = {
    PRIMARY: "Hauptposition",
    REQUIRED_COMPONENT: "Pflichtbestandteil",
    COMPONENT: "Komponente",
    OPTIONAL_COMPONENT: "Optional",
    ALTERNATIVE: "Alternative",
    UNKNOWN: "Angebotszeile"
  };
  return labels[role];
}

export function unavailableSupplierStatus(option: SupplierOption): string {
  if (
    option.offerAvailability === "EXPLICIT_NO_OFFER" ||
    option.materialScopeStatus === "EXPLICIT_NO_OFFER"
  ) {
    return "Kein Angebot";
  }
  if (option.offerAvailability === "COVERED_WITHOUT_OFFER") {
    return "Zuordnung erforderlich";
  }
  return "Preis nicht gefunden";
}
