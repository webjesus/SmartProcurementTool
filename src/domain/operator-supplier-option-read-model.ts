import type {
  BasisPosition,
  BasisScopeRequirement,
  OfferLine,
  SupplierOption
} from "@/domain/contracts";
import {
  resolveManufacturerBrand,
  resolveSupplierBrand,
  type BrandResolution
} from "@/domain/brand-registry";
import {
  classifySupplierOption,
  isSelectableSupplierOption,
  primarySupplierLine,
  supplierDisplayRole,
  supplierOptionLines,
  supplierPriceDisplay,
  type SupplierOptionValidity,
  type SupplierPriceDisplay
} from "@/domain/supplier-option-read-model";

export const BASIS_STRUCTURE_INTERPRETATION_VERSION =
  "basis-structure-interpretation-v1" as const;
export const OPERATOR_SUPPLIER_OPTION_READ_MODEL_VERSION =
  "operator-supplier-option-read-model-v1" as const;

export type BasisStructureType =
  | "SINGLE_ITEM"
  | "MULTI_COMPONENT_REQUIREMENT"
  | "PACKAGE_REQUIREMENT"
  | "ALTERNATIVE_REQUIREMENT"
  | "DESCRIPTION_ONLY"
  | "UNCLEAR_STRUCTURE";

export type PackageCompleteness =
  | "COMPLETE"
  | "PARTIAL"
  | "PRIMARY_ONLY"
  | "UNKNOWN";

export type PriceProvenance =
  | "SOURCE_GP"
  | "SOURCE_EP_ONLY"
  | "CALCULATED_EP_X_QUANTITY"
  | "BUNDLE_SUM"
  | "PARTIAL_BUNDLE_SUM"
  | "NO_PRICE";

export type SelectionMode =
  | "COMPLETE_OPTION_SELECTION"
  | "MULTI_LINE_SELECTION"
  | "MIXED_SUPPLIER_SELECTION"
  | "PARTIAL_SELECTION";

export type BasisStructureInterpretation = {
  version: typeof BASIS_STRUCTURE_INTERPRETATION_VERSION;
  type: BasisStructureType;
  requiredComponents: BasisScopeRequirement[];
  continuationPages: number[];
  requiresComponentSelection: boolean;
};

export type PriceCompositionLine = {
  lineId: string;
  articleNumber: string | null;
  roleDe: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  sourcePage: number | null;
  included: boolean;
  reasonDe: string;
};

export type OperatorSupplierOptionReadModel = {
  version: typeof OPERATOR_SUPPLIER_OPTION_READ_MODEL_VERSION;
  optionId: string;
  supplierBrandId: string;
  manufacturerBrandId: string | null;
  supplierDisplayName: string;
  manufacturerDisplayName: string | null;
  supplierBrandConfidence: BrandResolution["confidence"];
  manufacturerBrandConfidence: BrandResolution["confidence"] | null;
  supplierBrand: BrandResolution;
  manufacturerBrand: BrandResolution | null;
  title: string;
  articleNumber: string | null;
  quantity: number | null;
  unit: string | null;
  price: SupplierPriceDisplay;
  priceProvenance: PriceProvenance;
  priceProvenanceLabelDe: string;
  priceComposition: PriceCompositionLine[];
  packageCompleteness: PackageCompleteness;
  packageCompletenessLabelDe: string;
  requiredComponentCount: number;
  coveredRequiredComponentCount: number;
  missingRequiredComponents: string[];
  includedOptionalComponents: string[];
  totalBasisCoverage: number | null;
  selectionMode: SelectionMode;
  selectActionLabelDe: string;
  partialSelectionWarningDe: string | null;
  validity: SupplierOptionValidity;
  selectable: boolean;
  sourceAvailable: boolean;
};

const normalized = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("de")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function uniqueRequirements(
  requirements: readonly BasisScopeRequirement[]
): BasisScopeRequirement[] {
  return Array.from(
    new Map(
      requirements.map((requirement) => [
        `${requirement.category}:${requirement.code}`,
        requirement
      ])
    ).values()
  );
}
function fallbackRequirements(position: BasisPosition): BasisScopeRequirement[] {
  const evidence = [...position.evidence];
  return uniqueRequirements([
    {
      code: "MAIN_PRODUCT",
      label: position.description,
      category: "MATERIAL",
      inherited: false,
      evidence
    },
    ...position.requiredScope.map((label, index) => ({
      code: `REQUIRED_SCOPE_${index + 1}`,
      label,
      category: "MATERIAL" as const,
      inherited: false,
      evidence
    }))
  ]);
}

export function buildBasisStructureInterpretation(
  position: BasisPosition
): BasisStructureInterpretation {
  const requiredComponents = uniqueRequirements(
    position.scopeProfile?.procurementMaterialScope?.length
      ? position.scopeProfile.procurementMaterialScope
      : fallbackRequirements(position)
  );
  const continuationPages = Array.from(
    new Set(
      [...position.evidence, ...(position.continuationEvidence ?? [])].map(
        (evidence) => evidence.pageNumber
      )
    )
  ).sort((left, right) => left - right);
  const description = normalized(
    [position.description, ...position.notes, ...position.requiredScope].join(" ")
  );
  let type: BasisStructureType;
  if (position.heading || (position.quantity === null && position.unit === null)) {
    type = "DESCRIPTION_ONLY";
  } else if (position.scopeProfile?.referenceResolved === false) {
    type = "UNCLEAR_STRUCTURE";
  } else if (position.alternative) {
    type = "ALTERNATIVE_REQUIREMENT";
  } else if (requiredComponents.length <= 1) {
    type = "SINGLE_ITEM";
  } else if (
    /\b(paket|set|anlage|system|komplett|bestehend aus|einschliesslich)\b/.test(
      description
    )
  ) {
    type = "PACKAGE_REQUIREMENT";
  } else {
    type = "MULTI_COMPONENT_REQUIREMENT";
  }
  return {
    version: BASIS_STRUCTURE_INTERPRETATION_VERSION,
    type,
    requiredComponents,
    continuationPages,
    requiresComponentSelection:
      type === "MULTI_COMPONENT_REQUIREMENT" ||
      type === "PACKAGE_REQUIREMENT"
  };
}

function completenessFor(input: {
  structure: BasisStructureInterpretation;
  option: SupplierOption;
  lines: readonly OfferLine[];
}): PackageCompleteness {
  if (!input.lines.length) return "UNKNOWN";
  if (
    input.option.requiredScopeComplete &&
    input.option.bundleCompatible &&
    input.option.materialScopeStatus === "COMPLETE_MATERIAL_SCOPE"
  ) {
    return "COMPLETE";
  }
  if (!input.structure.requiresComponentSelection) {
    return input.option.materialScopeStatus === "PARTIAL_MATERIAL_SCOPE"
      ? "PARTIAL"
      : "COMPLETE";
  }
  const includedRequired = input.lines.filter((line) =>
    ["PRIMARY", "REQUIRED_COMPONENT", "MANDATORY_COMPONENT"].includes(
      supplierDisplayRole(line, input.lines)
    )
  );
  if (
    includedRequired.length <= 1 &&
    !input.option.requiredScopeComplete
  ) {
    return "PRIMARY_ONLY";
  }
  return "PARTIAL";
}

function priceProvenanceFor(
  price: SupplierPriceDisplay,
  completeness: PackageCompleteness,
  lines: readonly OfferLine[]
): PriceProvenance {
  if (price.state === "MISSING") return "NO_PRICE";
  if (price.state === "UNIT_PRICE_ONLY") return "SOURCE_EP_ONLY";
  if (price.state === "SYSTEM_CALCULATED_TOTAL") {
    return "CALCULATED_EP_X_QUANTITY";
  }
  const includedTotals = lines.filter(
    (line) =>
      ["PRIMARY", "REQUIRED_COMPONENT", "MANDATORY_COMPONENT"].includes(
        supplierDisplayRole(line, lines)
      ) && line.interpretedTotalPrice !== null
  );
  if (completeness === "PARTIAL" && includedTotals.length > 1) {
    return "PARTIAL_BUNDLE_SUM";
  }
  if (price.scope === "PACKAGE_TOTAL" && includedTotals.length > 1) {
    return "BUNDLE_SUM";
  }
  return "SOURCE_GP";
}

const PRICE_LABELS: Record<PriceProvenance, string> = {
  SOURCE_GP: "Gesamtpreis aus Angebot",
  SOURCE_EP_ONLY: "Nur Einzelpreis aus Angebot",
  CALCULATED_EP_X_QUANTITY: "Aus Einzelpreis × Menge berechnet",
  BUNDLE_SUM: "Summe der Pflichtbestandteile",
  PARTIAL_BUNDLE_SUM: "Unvollständige Paketsumme",
  NO_PRICE: "Preis nicht gefunden"
};

const COMPLETENESS_LABELS: Record<PackageCompleteness, string> = {
  COMPLETE: "Vollständiges Paket",
  PARTIAL: "Unvollständiges Paket",
  PRIMARY_ONLY: "Nur Hauptposition",
  UNKNOWN: "Lieferumfang unklar"
};

function actionLabel(
  completeness: PackageCompleteness,
  structure: BasisStructureInterpretation,
  lines: readonly OfferLine[]
): string {
  if (completeness === "COMPLETE" && lines.length > 1) {
    return "Gesamtes Angebot auswählen";
  }
  if (completeness === "PRIMARY_ONLY") return "Hauptposition auswählen";
  if (completeness === "PARTIAL") {
    return structure.requiresComponentSelection
      ? "Komponenten auswählen"
      : "Teilangebot auswählen";
  }
  return "Angebot auswählen";
}

export function buildOperatorSupplierOptionReadModel(input: {
  basis: BasisPosition;
  option: SupplierOption;
  offerLines: ReadonlyMap<string, OfferLine>;
  sourceAvailable?: boolean;
}): OperatorSupplierOptionReadModel {
  const lines = supplierOptionLines(input.option, input.offerLines);
  const primary = primarySupplierLine(lines);
  const structure = buildBasisStructureInterpretation(input.basis);
  const sourceAvailable =
    input.sourceAvailable ??
    lines.some((line) => line.evidence.length > 0);
  const validity = classifySupplierOption({
    option: input.option,
    lines,
    sourceValid: sourceAvailable
  });
  const price = supplierPriceDisplay(input.option, lines);
  const packageCompleteness = completenessFor({
    structure,
    option: input.option,
    lines
  });
  const missingRequiredComponents = [...input.option.missingComponents];
  const requiredComponentCount = structure.requiredComponents.length;
  const coveredRequiredComponentCount =
    packageCompleteness === "COMPLETE"
      ? requiredComponentCount
      : packageCompleteness === "PRIMARY_ONLY"
        ? Math.min(1, requiredComponentCount)
        : Math.max(
            0,
            requiredComponentCount -
              Math.max(
                missingRequiredComponents.length,
                requiredComponentCount > 0 ? 1 : 0
              )
          );
  const supplierBrand = resolveSupplierBrand(input.option.supplierLabel);
  const manufacturerBrand = primary?.manufacturer
    ? resolveManufacturerBrand(primary.manufacturer)
    : null;
  const priceProvenance = priceProvenanceFor(
    price,
    packageCompleteness,
    lines
  );
  const priceComposition = lines.map((line) => {
    const role = supplierDisplayRole(line, lines);
    const included = ["PRIMARY", "REQUIRED_COMPONENT"].includes(role);
    return {
      lineId: line.id,
      articleNumber: line.articleNumber,
      roleDe:
        role === "PRIMARY"
          ? "Hauptposition"
          : role === "REQUIRED_COMPONENT"
            ? "Pflichtbestandteil"
            : role === "OPTIONAL_COMPONENT"
              ? "Optional"
              : role === "ALTERNATIVE"
                ? "Alternative"
                : "Komponente",
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.interpretedUnitPrice,
      totalPrice: line.interpretedTotalPrice,
      sourcePage: line.evidence[0]?.pageNumber ?? null,
      included,
      reasonDe: included
        ? "Im angezeigten Gesamtpreis berücksichtigt"
        : role === "OPTIONAL_COMPONENT"
          ? "Optionales Zubehör nicht eingerechnet"
          : role === "ALTERNATIVE"
            ? "Alternative nicht gleichzeitig eingerechnet"
            : "Nicht als Pflichtbestandteil bestätigt"
    };
  });
  const includedOptionalComponents = lines
    .filter(
      (line) => supplierDisplayRole(line, lines) === "OPTIONAL_COMPONENT"
    )
    .map((line) => line.description);
  const selectionMode: SelectionMode =
    packageCompleteness === "PARTIAL" ||
    packageCompleteness === "PRIMARY_ONLY"
      ? structure.requiresComponentSelection
        ? "MULTI_LINE_SELECTION"
        : "PARTIAL_SELECTION"
      : lines.length > 1
        ? "MULTI_LINE_SELECTION"
        : "COMPLETE_OPTION_SELECTION";
  return {
    version: OPERATOR_SUPPLIER_OPTION_READ_MODEL_VERSION,
    optionId: input.option.id,
    supplierBrandId: supplierBrand.brand.canonicalId,
    manufacturerBrandId:
      manufacturerBrand?.confidence === "UNKNOWN"
        ? null
        : manufacturerBrand?.brand.canonicalId ?? null,
    supplierDisplayName: input.option.supplierLabel,
    manufacturerDisplayName: primary?.manufacturer ?? null,
    supplierBrandConfidence: supplierBrand.confidence,
    manufacturerBrandConfidence: manufacturerBrand?.confidence ?? null,
    supplierBrand,
    manufacturerBrand,
    title: primary?.description ?? "Keine Produktzeile erkannt",
    articleNumber: primary?.articleNumber ?? null,
    quantity: primary?.quantity ?? input.option.quantity,
    unit: primary?.unit ?? input.option.unit,
    price,
    priceProvenance,
    priceProvenanceLabelDe: PRICE_LABELS[priceProvenance],
    priceComposition,
    packageCompleteness,
    packageCompletenessLabelDe:
      COMPLETENESS_LABELS[packageCompleteness],
    requiredComponentCount,
    coveredRequiredComponentCount,
    missingRequiredComponents,
    includedOptionalComponents,
    totalBasisCoverage:
      requiredComponentCount > 0
        ? coveredRequiredComponentCount / requiredComponentCount
        : null,
    selectionMode,
    selectActionLabelDe: actionLabel(
      packageCompleteness,
      structure,
      lines
    ),
    partialSelectionWarningDe:
      packageCompleteness === "PARTIAL" ||
      packageCompleteness === "PRIMARY_ONLY"
        ? "Dieses Angebot deckt nicht den vollständigen Lieferumfang ab."
        : null,
    validity,
    selectable: isSelectableSupplierOption(validity),
    sourceAvailable
  };
}

export function buildPositionSelectionMode(
  basis: BasisPosition,
  options: readonly OperatorSupplierOptionReadModel[]
): SelectionMode {
  const structure = buildBasisStructureInterpretation(basis);
  if (!structure.requiresComponentSelection) {
    return "COMPLETE_OPTION_SELECTION";
  }
  if (options.some((option) => option.packageCompleteness === "COMPLETE")) {
    return "MULTI_LINE_SELECTION";
  }
  return options.filter((option) => option.selectable).length > 1
    ? "MIXED_SUPPLIER_SELECTION"
    : "PARTIAL_SELECTION";
}
