import { describe, expect, it } from "vitest";
import type {
  BasisPosition,
  OfferLine,
  SupplierOption
} from "@/domain/contracts";
import {
  BASIS_STRUCTURE_INTERPRETATION_VERSION,
  OPERATOR_SUPPLIER_OPTION_READ_MODEL_VERSION,
  buildBasisStructureInterpretation,
  buildOperatorSupplierOptionReadModel
} from "@/domain/operator-supplier-option-read-model";
import { basisPosition, evidence, offerLine } from "../fixtures";

function component(code: string, label: string) {
  return {
    code,
    label,
    category: "MATERIAL" as const,
    inherited: false,
    evidence: [evidence]
  };
}

function multiComponentBasis(): BasisPosition {
  const components = [
    component("PRIMARY", "Hauptgerät"),
    component("CONTROL", "Regelung"),
    component("INSTALLATION_SET", "Anschlussset")
  ];
  return {
    ...basisPosition,
    description: "Komplettes Wärmepumpenpaket bestehend aus Gerät und Regelung",
    scopeProfile: {
      directLeafDescription: basisPosition.description,
      directLeafEvidence: basisPosition.evidence,
      inheritedExecutionDescription: [],
      inheritedMaterialRequirements: [],
      inheritedInstallationRequirements: [],
      fullLvExecutionScope: components,
      procurementMaterialScope: components,
      referenceResolved: true
    }
  };
}

function option(
  lines: OfferLine[],
  overrides: Partial<SupplierOption> = {}
): SupplierOption {
  return {
    id: "option-read-model",
    basisPositionIds: [basisPosition.id],
    supplierDocumentId: "supplier-document",
    supplierLabel: "P & M",
    matchedOfferLineIds: lines.map((line) => line.id),
    matchLinkIds: [],
    primaryPrice: lines[0]?.interpretedUnitPrice ?? null,
    mandatoryComponentPrices: lines
      .slice(1)
      .map((line) => line.interpretedTotalPrice)
      .filter((value): value is number => value !== null),
    optionalPrices: [],
    pricedTotal: lines.reduce(
      (sum, line) => sum + (line.interpretedTotalPrice ?? 0),
      0
    ),
    comparableTotal: lines.reduce(
      (sum, line) => sum + (line.interpretedTotalPrice ?? 0),
      0
    ),
    quantity: basisPosition.quantity,
    unit: basisPosition.unit,
    scopeOfSupply: [],
    technicalDeviations: [],
    missingComponents: [],
    validationIssueIds: [],
    evidenceIds: lines.flatMap((line) =>
      line.evidence.map((item) => item.id)
    ),
    quantityCompatible: true,
    unitCompatible: true,
    technicalCompatible: true,
    requiredScopeComplete: true,
    optionalSeparated: true,
    bundleCompatible: true,
    evidenceSufficient: true,
    extractionValidated: true,
    matchingAccepted: true,
    matchingReliable: true,
    offerAvailability: "PRESENT",
    materialScopeStatus: "COMPLETE_MATERIAL_SCOPE",
    reasons: [],
    status: "CLEAR_RECOMMENDATION",
    ...overrides
  };
}

function line(
  id: string,
  role: OfferLine["role"],
  total: number
): OfferLine {
  return {
    ...offerLine,
    id,
    role,
    manufacturer: id === "primary" ? "ESBE" : null,
    interpretedUnitPrice: total,
    interpretedTotalPrice: total,
    evidence: [{ ...evidence, id: `evidence-${id}` }]
  };
}

describe("versioned operator supplier option read model", () => {
  it("classifies Basis structure independently of a position number", () => {
    const interpretation =
      buildBasisStructureInterpretation(multiComponentBasis());
    expect(interpretation.version).toBe(
      BASIS_STRUCTURE_INTERPRETATION_VERSION
    );
    expect(interpretation.type).toBe("PACKAGE_REQUIREMENT");
    expect(interpretation.requiredComponents).toHaveLength(3);
  });

  it("exposes a complete bundle with explicit local brands and price provenance", () => {
    const basis = multiComponentBasis();
    const lines = [
      line("primary", "PRIMARY", 1_000),
      line("control", "MANDATORY_COMPONENT", 250),
      line("set", "MANDATORY_COMPONENT", 100)
    ];
    const model = buildOperatorSupplierOptionReadModel({
      basis,
      option: option(lines),
      offerLines: new Map(lines.map((item) => [item.id, item]))
    });
    expect(model.version).toBe(
      OPERATOR_SUPPLIER_OPTION_READ_MODEL_VERSION
    );
    expect(model.supplierBrandId).toBe("pfeiffer-may");
    expect(model.manufacturerBrandId).toBe("esbe");
    expect(model.packageCompleteness).toBe("COMPLETE");
    expect(model.priceProvenance).toBe("BUNDLE_SUM");
    expect(model.priceComposition).toHaveLength(3);
    expect(model.selectActionLabelDe).toBe(
      "Gesamtes Angebot auswählen"
    );
  });

  it("marks a missing mandatory component as partial without mutating extraction", () => {
    const basis = multiComponentBasis();
    const lines = [line("primary", "PRIMARY", 1_000)];
    const supplierOption = option(lines, {
      requiredScopeComplete: false,
      bundleCompatible: false,
      materialScopeStatus: "PARTIAL_MATERIAL_SCOPE",
      missingComponents: ["Regelung", "Anschlussset"],
      status: "DIFFERENT_SCOPE_OF_SUPPLY"
    });
    const original = JSON.stringify({ basis, lines, supplierOption });
    const model = buildOperatorSupplierOptionReadModel({
      basis,
      option: supplierOption,
      offerLines: new Map(lines.map((item) => [item.id, item]))
    });
    expect(model.packageCompleteness).toBe("PRIMARY_ONLY");
    expect(model.missingRequiredComponents).toEqual([
      "Regelung",
      "Anschlussset"
    ]);
    expect(model.partialSelectionWarningDe).toContain(
      "nicht den vollständigen Lieferumfang"
    );
    expect(JSON.stringify({ basis, lines, supplierOption })).toBe(original);
  });

  it("keeps explicit no-offer entries non-selectable", () => {
    const supplierOption = option([], {
      offerAvailability: "EXPLICIT_NO_OFFER",
      materialScopeStatus: "EXPLICIT_NO_OFFER",
      pricedTotal: null,
      comparableTotal: null
    });
    const model = buildOperatorSupplierOptionReadModel({
      basis: basisPosition,
      option: supplierOption,
      offerLines: new Map()
    });
    expect(model.validity).toBe("EXPLICIT_NO_OFFER");
    expect(model.selectable).toBe(false);
    expect(model.priceProvenance).toBe("NO_PRICE");
  });
});
