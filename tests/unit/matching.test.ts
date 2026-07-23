import { describe, expect, it } from "vitest";
import {
  buildBasisRecommendations,
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
      quantity: 3,
      role: "REQUIRED_COMPONENT" as const
    };
    const result = matchConstraints(basisPosition, [
      { ...offerLine, quantity: 3 },
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

  it("retains direct position references even with low text similarity", () => {
    const basis = {
      ...basisPosition,
      id: "basis-820",
      positionNumber: "2.1.820.",
      description: "Strangabsperrventil DN 50",
      quantity: null,
      unit: null,
      technicalAttributes: [{ name: "Nennweite", value: "DN 50" }]
    };
    const direct = {
      ...offerLine,
      id: "offer-820",
      sourcePositionNumber: "2.1.820",
      description: "MNG-KOMBI 3 PLUS Ventil Innengewinde 2 Zoll"
    };
    const links = proposeMatches([basis], [direct]);
    expect(links).toHaveLength(1);
    expect(links[0].status).toBe("EXACT");
  });

  it("maps a source-position range and explicit provided-by-others line", () => {
    const rangeLine = {
      ...offerLine,
      id: "range-no-offer",
      sourcePositionNumber: "2.1.740-750",
      description: "bauseits",
      role: "PROVIDED_BY_OTHERS" as const,
      interpretedUnitPrice: null,
      interpretedTotalPrice: null
    };
    const positions = ["740", "750"].map((number) => ({
      ...basisPosition,
      id: `basis-${number}`,
      positionNumber: `2.1.${number}.`,
      description: "Kennzeichnungsschild"
    }));
    const links = proposeMatches(positions, [rangeLine]);
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.status === "NOT_OFFERED")).toBe(true);
  });

  it("composes only adjacent unnumbered component rows into a bundle", () => {
    const basis = {
      ...basisPosition,
      id: "basis-760",
      positionNumber: "2.1.760.",
      description: "Kugelhahn DN 32"
    };
    const primary = {
      ...offerLine,
      id: "primary-760",
      sourcePositionNumber: "2.1.760",
      description: "Kugelhahn 1 1/4 Zoll"
    };
    const component = {
      ...offerLine,
      id: "component-760",
      sourcePositionNumber: null,
      description: "Dämmschale DN 32",
      role: "PRIMARY" as const
    };
    const next = {
      ...offerLine,
      id: "primary-770",
      sourcePositionNumber: "2.1.770",
      description: "Kugelhahn 1 1/2 Zoll"
    };
    const [link] = proposeMatches([basis], [primary, component, next]);
    expect(link.offerLineIds).toEqual([primary.id, component.id]);
  });

  it("compares piece-unit aliases and standard DN/inch equivalents", () => {
    const basis = {
      ...basisPosition,
      quantity: 24,
      unit: "St",
      requiredScope: [],
      technicalAttributes: [{ name: "Nennweite", value: "DN 32" }]
    };
    const result = matchConstraints(basis, [
      {
        ...offerLine,
        quantity: 24,
        unit: "Stück",
        description: "Kugelhahn Innengewinde 1 1/4 Zoll"
      }
    ]);
    expect(result.quantityCompatible).toBe(true);
    expect(result.unitCompatible).toBe(true);
    expect(result.technicalCompatible).toBe(true);
  });

  it("distinguishes covered no-offer from an uncovered supplier range", () => {
    const supplierOffers = ["730", "760"].map((number) => ({
      documentId: "supplier-a",
      documentLabel: "Supplier A",
      line: {
        ...offerLine,
        id: `offer-${number}`,
        sourcePositionNumber: `2.1.${number}`
      }
    }));
    const [covered] = buildSupplierOptions({
      basisPositions: [
        {
          ...basisPosition,
          id: "basis-740",
          positionNumber: "2.1.740."
        }
      ],
      offers: supplierOffers,
      links: []
    });
    const [uncovered] = buildSupplierOptions({
      basisPositions: [
        {
          ...basisPosition,
          id: "basis-800",
          positionNumber: "2.1.800."
        }
      ],
      offers: supplierOffers,
      links: []
    });
    expect(covered.offerAvailability).toBe("COVERED_WITHOUT_OFFER");
    expect(covered.status).toBe("NO_OFFER");
    expect(uncovered.offerAvailability).toBe("NOT_COVERED");
    expect(uncovered.status).toBe("MATCHING_UNCLEAR");
  });

  it("does not treat an unbound manufacturer as a technical deviation", () => {
    const result = matchConstraints(
      {
        ...basisPosition,
        manufacturerRequirements: [],
        requiredScope: [],
        technicalAttributes: []
      },
      [{ ...offerLine, manufacturer: "Different Manufacturer" }]
    );
    expect(result.technicalCompatible).toBe(true);
    expect(result.positiveReasons.join(" ")).toContain("ohne Herstellerbindung");
  });

  it("keeps a confirmed material price out of comparable total when required scope differs", () => {
    const primary = {
      ...offerLine,
      id: "scope-primary",
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const link = composeMatchLink({
      basisPositionIds: [basisPosition.id],
      offerLineIds: [primary.id],
      status: "EXACT",
      score: 1,
      reasons: ["Direkter LV-Positionsbezug"],
      confirmedByOperator: true
    });
    const [option] = buildSupplierOptions({
      basisPositions: [
        {
          ...basisPosition,
          requiredScope: ["Komplett liefern und montieren"]
        }
      ],
      offers: [
        {
          documentId: "supplier-a",
          documentLabel: "Supplier A",
          line: primary
        }
      ],
      links: [link]
    });
    expect(option.pricedTotal).toBe(300);
    expect(option.comparableTotal).toBeNull();
    expect(option.status).toBe("DIFFERENT_SCOPE_OF_SUPPLY");
  });

  it("allows a clear option without automatically selecting its supplier", () => {
    const primary = {
      ...offerLine,
      id: "clear-primary",
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const link = composeMatchLink({
      basisPositionIds: [basisPosition.id],
      offerLineIds: [primary.id],
      status: "EXACT",
      score: 1,
      reasons: ["Direkter LV-Positionsbezug"]
    });
    const positions = [{ ...basisPosition, requiredScope: [] }];
    const options = buildSupplierOptions({
      basisPositions: positions,
      offers: [
        {
          documentId: "supplier-a",
          documentLabel: "Supplier A",
          line: primary
        }
      ],
      links: [link]
    });
    const [recommendation] = buildBasisRecommendations(positions, options);
    expect(recommendation.status).toBe("CLEAR_RECOMMENDATION");
    expect(recommendation.recommendedSupplierDocumentId).toBeNull();
    expect(recommendation.requiresOperatorConfirmation).toBe(true);
  });
});
