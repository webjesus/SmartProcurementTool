import { describe, expect, it } from "vitest";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import {
  classifySupplierOption,
  isSelectableSupplierOption,
  supplierDisplayRole,
  supplierPriceDisplay,
  validateSupplierSourceTarget
} from "@/domain/supplier-option-read-model";
import { evidence, offerLine } from "../fixtures";

function line(
  id: string,
  overrides: Partial<OfferLine> = {}
): OfferLine {
  return {
    ...offerLine,
    id,
    sourcePositionNumber: "2.1.100",
    supplierPositionNumber: id,
    evidence: [{ ...evidence, id: `evidence-${id}` }],
    ...overrides
  };
}

function option(lines: OfferLine[], overrides: Partial<SupplierOption> = {}): SupplierOption {
  return {
    id: "option-fixture",
    basisPositionIds: ["basis-fixture"],
    supplierDocumentId: evidence.documentId,
    supplierLabel: "Supplier fixture",
    matchedOfferLineIds: lines.map((candidate) => candidate.id),
    matchLinkIds: ["match-fixture"],
    primaryPrice: lines[0]?.interpretedUnitPrice ?? null,
    mandatoryComponentPrices: [],
    optionalPrices: [],
    pricedTotal: null,
    comparableTotal: null,
    quantity: lines[0]?.quantity ?? null,
    unit: lines[0]?.unit ?? null,
    scopeOfSupply: [],
    technicalDeviations: [],
    missingComponents: [],
    validationIssueIds: [],
    evidenceIds: lines.flatMap((candidate) =>
      candidate.evidence.map((item) => item.id)
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

describe("supplier option corrected read model regression fixtures", () => {
  it("keeps a source-confirmed Gienger GP and EP", () => {
    const primary = line("3000", {
      quantity: 6,
      interpretedUnitPrice: 7_791.62,
      interpretedTotalPrice: 46_749.72,
      role: "ALTERNATIVE"
    });
    expect(supplierPriceDisplay(option([primary]), [primary])).toMatchObject({
      total: 46_749.72,
      unitPrice: 7_791.62,
      state: "SOURCE_CONFIRMED_TOTAL",
      scope: "SINGLE_LINE"
    });
  });

  it("reconciles a P&M multi-line mandatory package", () => {
    const primary = line("10", {
      role: "PRIMARY",
      interpretedTotalPrice: 1_000
    });
    const mandatory = line("20", {
      role: "MANDATORY_COMPONENT",
      interpretedTotalPrice: 250
    });
    const fixture = option([primary, mandatory], {
      pricedTotal: 1_250,
      comparableTotal: 1_250
    });
    expect(supplierPriceDisplay(fixture, [primary, mandatory])).toMatchObject({
      total: 1_250,
      state: "SOURCE_CONFIRMED_TOTAL",
      scope: "PACKAGE_TOTAL"
    });
  });

  it("does not silently include an optional component", () => {
    const primary = line("100", {
      role: "PRIMARY",
      interpretedTotalPrice: 600
    });
    const optional = line("110", {
      role: "OPTIONAL",
      interpretedTotalPrice: 90
    });
    const fixture = option([primary, optional], {
      pricedTotal: 600,
      comparableTotal: 600,
      optionalPrices: [90]
    });
    expect(supplierPriceDisplay(fixture, [primary, optional])).toMatchObject({
      total: 600,
      scope: "PRIMARY_ONLY"
    });
  });

  it("keeps explicit Reisser Wahlweise lines as alternatives", () => {
    const first = line("A", {
      role: "ALTERNATIVE",
      description: "Wahlweise Ausführung A"
    });
    const second = line("B", {
      role: "ALTERNATIVE",
      description: "Alternative Ausführung B"
    });
    expect(supplierDisplayRole(first, [first, second])).toBe("ALTERNATIVE");
    expect(supplierDisplayRole(second, [first, second])).toBe("ALTERNATIVE");
  });

  it("classifies missing mapping and explicit no offer as non-selectable", () => {
    const missing = option([], {
      matchedOfferLineIds: [],
      offerAvailability: "COVERED_WITHOUT_OFFER"
    });
    const noOffer = option([], {
      matchedOfferLineIds: [],
      offerAvailability: "EXPLICIT_NO_OFFER",
      materialScopeStatus: "EXPLICIT_NO_OFFER"
    });
    const missingValidity = classifySupplierOption({
      option: missing,
      lines: [],
      sourceValid: false
    });
    const noOfferValidity = classifySupplierOption({
      option: noOffer,
      lines: [],
      sourceValid: false
    });
    expect(missingValidity).toBe("UNASSIGNED_SUPPLIER");
    expect(noOfferValidity).toBe("EXPLICIT_NO_OFFER");
    expect(isSelectableSupplierOption(missingValidity)).toBe(false);
    expect(isSelectableSupplierOption(noOfferValidity)).toBe(false);
  });

  it("supports page context without inventing an evidence rectangle", () => {
    const contextLine = line("context", {
      continuation: true,
      evidence: [
        {
          ...evidence,
          id: "context-page-1",
          pageNumber: 2,
          region: { x: 0, y: 0, width: 0, height: 0 }
        },
        {
          ...evidence,
          id: "context-page-2",
          pageNumber: 3
        }
      ]
    });
    const fixture = option([contextLine]);
    expect(
      validateSupplierSourceTarget({
        option: fixture,
        line: contextLine,
        activeRevisionId: "revision-1",
        pageCount: 3
      })
    ).toMatchObject({
      status: "PAGE_CONTEXT",
      pageNumber: 2,
      reasonDe: "Genaue Markierung nicht verfügbar"
    });
  });

  it("keeps several repeated-reference source lines independently addressable", () => {
    const lines = [
      line("3000", { role: "ALTERNATIVE" }),
      line("4000", { role: "ALTERNATIVE" }),
      line("5000", { role: "ALTERNATIVE" })
    ];
    expect(new Set(lines.map((candidate) => candidate.id)).size).toBe(3);
    expect(lines.map((candidate) => supplierDisplayRole(candidate, lines))).toEqual([
      "PRIMARY",
      "COMPONENT",
      "COMPONENT"
    ]);
  });
});
