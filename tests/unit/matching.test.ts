import { describe, expect, it } from "vitest";
import {
  buildSupplierOptions,
  classifyOfferCompleteness,
  composeMatchLink,
  isMatchingSourceDocumentType,
  matchConstraints,
  proposeMatches,
  scoreMatch
} from "@/domain/matching";
import { basisPosition, offerLine } from "../fixtures";

describe("matching", () => {
  it("uses more than the same position number", () => {
    const unrelated = {
      ...offerLine,
      id: "other",
      description: "Unrelated product",
      quantity: 99,
      unit: "m"
    };
    expect(proposeMatches([basisPosition], [unrelated])).toHaveLength(0);
  });

  it("scores description, number, quantity and unit together", () => {
    const result = scoreMatch(basisPosition, offerLine);
    expect(result.score).toBeGreaterThan(0.8);
    expect(result.reasons).toContain("Menge ist kompatibel");
  });

  it("supports bundle composition constraints", () => {
    const component = {
      ...offerLine,
      id: "component",
      description: "Anschlussset",
      quantity: 1,
      role: "REQUIRED_COMPONENT" as const
    };
    const result = matchConstraints(basisPosition, [
      { ...offerLine, quantity: 2 },
      component
    ]);
    expect(result.quantityCompatible).toBe(true);
    expect(result.requiredScopeComplete).toBe(true);
  });

  it("detects incompatible units and quantities", () => {
    const result = matchConstraints(basisPosition, [{ ...offerLine, quantity: 5, unit: "m" }]);
    expect(result.quantityCompatible).toBe(false);
    expect(result.unitCompatible).toBe(false);
  });

  it("builds one-to-many bundle links and keeps optional prices out of comparable total", () => {
    const primary = {
      ...offerLine,
      id: "primary",
      interpretedTotalPrice: 300,
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const required = {
      ...offerLine,
      id: "required",
      description: "Anschlussset Pumpe",
      interpretedTotalPrice: 40,
      role: "REQUIRED_COMPONENT" as const,
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const optional = {
      ...offerLine,
      id: "optional",
      description: "Optionale Erweiterung",
      interpretedTotalPrice: 50,
      role: "OPTIONAL" as const,
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const link = composeMatchLink({
      basisPositionIds: [basisPosition.id],
      offerLineIds: [primary.id, required.id, optional.id],
      status: "EXACT",
      score: 1,
      reasons: ["fixture"],
      confirmedByOperator: true
    });
    expect(link.kind).toBe("ONE_TO_MANY");
    const [option] = buildSupplierOptions({
      basisPositions: [{ ...basisPosition, requiredScope: [] }],
      offers: [primary, required, optional].map((line) => ({
        documentId: "supplier-a",
        documentLabel: "Supplier A",
        line
      })),
      links: [link]
    });
    expect(option.comparableTotal).toBe(340);
    expect(option.optionalPrices).toEqual([50]);
  });

  it("supports many-to-one and many-to-many link cardinalities", () => {
    expect(
      composeMatchLink({
        basisPositionIds: ["b1", "b2"],
        offerLineIds: ["o1"],
        status: "PROBABLE",
        score: 0.7,
        reasons: []
      }).kind
    ).toBe("MANY_TO_ONE");
    expect(
      composeMatchLink({
        basisPositionIds: ["b1", "b2"],
        offerLineIds: ["o1", "o2"],
        status: "PROBABLE",
        score: 0.7,
        reasons: []
      }).kind
    ).toBe("MANY_TO_MANY");
  });

  it("handles explicit no-offer content without inventing a price", () => {
    expect(
      classifyOfferCompleteness({
        ...offerLine,
        role: "NOT_OFFERED",
        interpretedUnitPrice: null,
        interpretedTotalPrice: null,
        moneyCandidates: []
      })
    ).toBe("NOT_OFFERED");
  });

  it("isolates historical result documents from matching sources", () => {
    expect(isMatchingSourceDocumentType("BASIS_LV")).toBe(true);
    expect(isMatchingSourceDocumentType("SUPPLIER_OFFER")).toBe(true);
    expect(isMatchingSourceDocumentType("HISTORICAL_CALCULATION")).toBe(false);
    expect(isMatchingSourceDocumentType("FINAL_DECISION")).toBe(false);
  });
});
