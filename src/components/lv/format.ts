import type { ProjectReviewPosition } from "@/domain/project-review";
import type { SupplierOption } from "@/domain/contracts";
import { resolveSupplierBrand } from "@/domain/brand-registry";

export function formatNumber(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(value);
}

export function formatCurrency(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR"
      }).format(value);
}

export function materialScopeLabel(option: SupplierOption): string {
  switch (option.materialScopeStatus) {
    case "COMPLETE_MATERIAL_SCOPE":
      return "Vollständig vergleichbar";
    case "PARTIAL_MATERIAL_SCOPE":
      return "Lieferumfang unvollständig";
    case "TECHNICALLY_DEVIATING":
      return "Technische Abweichung";
    case "EXPLICIT_NO_OFFER":
      return "Nicht angeboten";
    default:
      return "Prüfung erforderlich";
  }
}

export function liveStatusLabel(position: ProjectReviewPosition): string {
  const labels: Record<string, string> = {
    AUTO_SELECTED_LOWEST_PRICE: "Automatisch ausgewählt",
    MANUAL_DECISION_REQUIRED: "Entscheidung erforderlich",
    MANUAL_DECIDED: "Manuell entschieden",
    DEFERRED: "Zurückgestellt",
    NO_COMPARABLE_OFFER: "Kein vergleichbares Angebot",
    PROCESSING_PENDING: "Verarbeitung ausstehend",
    PROCESSING_ERROR: "Verarbeitungsfehler"
  };
  return labels[position.liveStatus] ?? position.liveStatus;
}

export function userReason(position: ProjectReviewPosition): string {
  if (position.primaryReasonDe) return position.primaryReasonDe;
  if (position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE") {
    return "Eindeutig günstigste vollständig vergleichbare Variante";
  }
  if (position.liveStatus === "NO_COMPARABLE_OFFER") {
    return "Keine vollständig vergleichbare Variante verfügbar";
  }
  if (position.liveStatus === "DEFERRED") return "Entscheidung wurde zurückgestellt";
  return position.independent.reasons[0] ?? "Prüfung durch die Leitung erforderlich";
}

export function shortDescription(value: string, length = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= length
    ? normalized
    : `${normalized.slice(0, length - 1).trimEnd()}…`;
}

export function lineRoleLabel(role: string | undefined): string {
  const labels: Record<string, string> = {
    PRIMARY: "Hauptposition",
    REQUIRED_COMPONENT: "Pflichtbestandteil",
    MANDATORY_COMPONENT: "Pflichtbestandteil",
    OPTIONAL_COMPONENT: "Optional",
    OPTIONAL: "Optional",
    INCLUDED_ACCESSORY: "Komponente",
    ALTERNATIVE: "Alternative",
    DISCOUNT_LINE: "Nachlass",
    SURCHARGE_LINE: "Zuschlag",
    TOTAL_LINE: "Summe",
    UNKNOWN: "Angebotszeile"
  };
  return labels[role ?? "UNKNOWN"] ?? "Angebotszeile";
}

export function supplierBucket(label: string): string {
  return resolveSupplierBrand(label).brand.shortName;
}
