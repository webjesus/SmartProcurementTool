import { describe, expect, it } from "vitest";
import {
  buildBasisRecommendations,
  buildSupplierOptions,
  classifyOfferCompleteness,
  composeMatchLink,
  isSubtotalOfferLine,
  isMatchingSourceDocumentType,
  matchConstraints,
  normalizeLvPositionReference,
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

  it("confirms technical identity only from matching manufacturer and type", () => {
    const result = matchConstraints(
      {
        ...basisPosition,
        description:
          'Membran-Ausdehnungsgefäß Fabrikat: Reflex Typ: N200 Komplett liefern',
        manufacturerRequirements: ["Reflex"],
        technicalAttributes: [
          { name: "Nennvolumen", value: "200 l" },
          { name: "Anschluss", value: 'R 1"' }
        ]
      },
      [
        {
          ...offerLine,
          manufacturer: "Reflex",
          description:
            'Reflex Membran-Ausdehnungsgefäß N grau 200 Liter R 1"'
        }
      ]
    );
    expect(result.productIdentityConfirmed).toBe(true);
    expect(result.technicalComparisonStatus).toBe("CONFIRMED_COMPATIBLE");
    expect(result.unresolvedTechnicalAttributes).toEqual([]);
  });

  it("keeps unprinted technical attributes unresolved instead of inventing a deviation", () => {
    const result = matchConstraints(
      {
        ...basisPosition,
        manufacturerRequirements: [],
        technicalAttributes: [{ name: "Betriebsdruck", value: "10 bar" }]
      },
      [{ ...offerLine, description: "Kappenventil mit Entleerung" }]
    );
    expect(result.technicalDeviations).toEqual([]);
    expect(result.technicalComparisonStatus).toBe("UNRESOLVED");
    expect(result.unresolvedTechnicalAttributes).toHaveLength(1);
  });

  it("detects a confirmed connection-size deviation", () => {
    const result = matchConstraints(
      {
        ...basisPosition,
        manufacturerRequirements: ["Reflex"],
        description: 'Kappenventil Fabrikat: Reflex Typ: SU G 1" × 1" Komplett',
        technicalAttributes: [{ name: "Anschluss", value: 'R 1"' }]
      },
      [
        {
          ...offerLine,
          manufacturer: "Reflex",
          description: 'Reflex Kappenventil SU R 3/4" x 3/4"'
        }
      ]
    );
    expect(result.technicalComparisonStatus).toBe("CONFIRMED_DEVIATION");
    expect(result.technicalDeviations[0]).toContain(
      "nachweislich abweichend"
    );
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

  it("does not let a Wahlweise alternative without total block the priced main option", () => {
    const primary = {
      ...offerLine,
      id: "wahlweise-main",
      interpretedTotalPrice: 300,
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const alternative = {
      ...offerLine,
      id: "wahlweise-alternative",
      role: "ALTERNATIVE" as const,
      interpretedUnitPrice: 25,
      interpretedTotalPrice: null,
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const link = composeMatchLink({
      basisPositionIds: [basisPosition.id],
      offerLineIds: [primary.id, alternative.id],
      status: "EXACT",
      score: 1,
      reasons: ["Direkter LV-Positionsbezug"],
      confirmedByOperator: true
    });
    const [option] = buildSupplierOptions({
      basisPositions: [
        {
          ...basisPosition,
          requiredScope: [],
          technicalAttributes: [],
          manufacturerRequirements: []
        }
      ],
      offers: [primary, alternative].map((line) => ({
        documentId: "reisser",
        documentLabel: "Reisser",
        line
      })),
      links: [link]
    });
    expect(option.materialScopeStatus).toBe("COMPLETE_MATERIAL_SCOPE");
    expect(option.comparableTotal).toBe(300);
    expect(option.optionalPrices).toEqual([]);
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

  it.each([
    ["2 1 730", "2.1.730"],
    ["2. 1. 730", "2.1.730"],
    ["2-1-730", "2.1.730"],
    ["2.1.740-750", "2.1.740-750"]
  ])("normalizes LV reference %s without changing the source value", (raw, expected) => {
    const sourceValue = raw;
    expect(normalizeLvPositionReference(raw)).toBe(expected);
    expect(raw).toBe(sourceValue);
  });

  it("does not interpret an internal supplier number as an LV reference", () => {
    expect(normalizeLvPositionReference("163000")).toBeNull();
    const giengerLine = {
      ...offerLine,
      id: "gienger-730",
      sourcePositionNumber: "163000",
      supplierPositionNumber: "2 1 730"
    };
    const [link] = proposeMatches(
      [{ ...basisPosition, positionNumber: "2.1.730." }],
      [giengerLine]
    );
    expect(link.status).toBe("EXACT");
    expect(giengerLine.sourcePositionNumber).toBe("163000");
    expect(giengerLine.supplierPositionNumber).toBe("2 1 730");
  });

  it("keeps same-reference rows in one priced bundle", () => {
    const primary = {
      ...offerLine,
      id: "gienger-manometer",
      sourcePositionNumber: "163000",
      supplierPositionNumber: "2 1 730",
      groupId: "group-017",
      description: "Manometer",
      interpretedTotalPrice: 92.88,
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const required = {
      ...offerLine,
      id: "gienger-valve",
      sourcePositionNumber: "164000",
      supplierPositionNumber: "2 1 730",
      groupId: "group-017",
      description: "Manometerventil",
      interpretedTotalPrice: 213.84,
      verificationStatus: "MACHINE_VALIDATED" as const
    };
    const positions = [
      {
        ...basisPosition,
        positionNumber: "2.1.730.",
        description: "Manometerventil",
        requiredScope: [],
        technicalAttributes: []
      }
    ];
    const links = proposeMatches(positions, [primary, required]);
    const [option] = buildSupplierOptions({
      basisPositions: positions,
      offers: [primary, required].map((line) => ({
        documentId: "gienger",
        documentLabel: "Gienger",
        line
      })),
      links
    });
    expect(option.matchedOfferLineIds).toEqual([primary.id, required.id]);
    expect(option.primaryPrice).toBe(92.88);
    expect(option.mandatoryComponentPrices).toEqual([213.84]);
    expect(option.pricedTotal).toBe(306.72);
  });

  it("excludes subtotal rows from matching and supplier options", () => {
    const subtotal = {
      ...offerLine,
      id: "subtotal",
      sourcePositionNumber: null,
      supplierPositionNumber: null,
      description: "Objektsumme 017",
      interpretedTotalPrice: 306.72,
      role: "PRIMARY" as const
    };
    expect(isSubtotalOfferLine(subtotal)).toBe(true);
    expect(proposeMatches([basisPosition], [subtotal])).toEqual([]);
    expect(
      buildSupplierOptions({
        basisPositions: [basisPosition],
        offers: [
          {
            documentId: "gienger",
            documentLabel: "Gienger",
            line: subtotal
          }
        ],
        links: []
      })
    ).toEqual([]);
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
      groupId: "supplier-section",
      description: "Kugelhahn 1 1/4 Zoll"
    };
    const previous = {
      ...offerLine,
      id: "previous-alternative",
      sourcePositionNumber: null,
      groupId: "supplier-section",
      description: "Alternative der vorherigen Position",
      role: "ALTERNATIVE" as const
    };
    const component = {
      ...offerLine,
      id: "component-760",
      sourcePositionNumber: null,
      groupId: "supplier-section",
      description: "Dämmschale DN 32",
      role: "PRIMARY" as const
    };
    const next = {
      ...offerLine,
      id: "primary-770",
      sourcePositionNumber: "2.1.770",
      groupId: "supplier-section",
      description: "Kugelhahn 1 1/2 Zoll"
    };
    const [link] = proposeMatches([basis], [
      previous,
      primary,
      component,
      next
    ]);
    expect(link.offerLineIds).toEqual([primary.id, component.id]);
  });

  it.each([
    ["2.1.760.", "DN 32", 24, 636.24, 1004.16, 928.37],
    ["2.1.770.", "DN 40", 60, 2278.8, 3193.8, 3396.96],
    ["2.1.780.", "DN 15", 1, 20.1, 33.44, 34.16],
    ["2.1.790.", "DN 20", 1, 22.32, 37.32, 37.48]
  ])(
    "%s compares complete material bundles independently",
    (
      positionNumber,
      nominalDiameter,
      quantity,
      giengerTotal,
      pumTotal,
      reisserTotal
    ) => {
      const basis = {
        ...basisPosition,
        id: `basis-${positionNumber}`,
        positionNumber,
        description: `Ventil ${nominalDiameter}`,
        quantity,
        unit: "St",
        technicalAttributes: [
          { name: "Nennweite", value: nominalDiameter }
        ],
        requiredScope: [
          "Komplett liefern und montieren",
          "Dichtungs- und Kleinmaterialien einkalkulieren"
        ],
        scopeProfile: {
          directLeafDescription: `Ventil ${nominalDiameter}`,
          directLeafEvidence: basisPosition.evidence,
          inheritedExecutionDescription: [
            "Ausführungsbeschreibung inklusive Wärmedämmschale"
          ],
          inheritedMaterialRequirements: [
            {
              code: "THERMAL_INSULATION",
              label: "Wärmedämmschale",
              category: "MATERIAL" as const,
              inherited: true,
              evidence: basisPosition.evidence
            }
          ],
          inheritedInstallationRequirements: [],
          fullLvExecutionScope: [],
          procurementMaterialScope: [
            {
              code: "MAIN_PRODUCT",
              label: `Ventil ${nominalDiameter}`,
              category: "MATERIAL" as const,
              inherited: false,
              evidence: basisPosition.evidence
            },
            {
              code: "THERMAL_INSULATION",
              label: "Wärmedämmschale",
              category: "MATERIAL" as const,
              inherited: true,
              evidence: basisPosition.evidence
            }
          ],
          referenceResolved: true
        }
      };
      const line = (
        id: string,
        description: string,
        total: number,
        role: "PRIMARY" | "REQUIRED_COMPONENT",
        sourcePositionNumber: string | null
      ) => ({
        ...offerLine,
        id,
        sourcePositionNumber,
        supplierPositionNumber: sourcePositionNumber,
        description,
        quantity,
        unit: "St",
        role,
        groupId: id.split("-")[0],
        interpretedTotalPrice: total,
        verificationStatus: "MACHINE_VALIDATED" as const
      });
      const gienger = line(
        "gienger-primary",
        `Ventil ${nominalDiameter}`,
        giengerTotal,
        "PRIMARY",
        positionNumber
      );
      const pumPrimary = line(
        "pum-primary",
        `Ventil ${nominalDiameter}`,
        pumTotal - 10,
        "PRIMARY",
        positionNumber
      );
      const pumShell = line(
        "pum-shell",
        `Wärmedämmschale ${nominalDiameter}`,
        10,
        "REQUIRED_COMPONENT",
        positionNumber
      );
      const reisserPrimary = line(
        "reisser-primary",
        `Ventil ${nominalDiameter}`,
        reisserTotal - 10,
        "PRIMARY",
        positionNumber
      );
      const reisserShell = line(
        "reisser-shell",
        `Wärmedämmschale ${nominalDiameter}`,
        10,
        "REQUIRED_COMPONENT",
        positionNumber
      );
      const offers = [
        { documentId: "gienger", documentLabel: "Gienger", line: gienger },
        { documentId: "pum", documentLabel: "P&M", line: pumPrimary },
        { documentId: "pum", documentLabel: "P&M", line: pumShell },
        {
          documentId: "reisser",
          documentLabel: "Reisser",
          line: reisserPrimary
        },
        {
          documentId: "reisser",
          documentLabel: "Reisser",
          line: reisserShell
        }
      ];
      const options = buildSupplierOptions({
        basisPositions: [basis],
        offers,
        links: proposeMatches([basis], offers)
      });
      const bySupplier = new Map(
        options.map((option) => [option.supplierDocumentId, option])
      );

      expect(bySupplier.get("gienger")).toMatchObject({
        materialScopeStatus: "PARTIAL_MATERIAL_SCOPE",
        pricedTotal: giengerTotal,
        comparableTotal: null,
        missingComponents: ["Wärmedämmschale"]
      });
      expect(bySupplier.get("pum")).toMatchObject({
        materialScopeStatus: "COMPLETE_MATERIAL_SCOPE",
        pricedTotal: pumTotal,
        comparableTotal: pumTotal
      });
      expect(bySupplier.get("reisser")).toMatchObject({
        materialScopeStatus: "COMPLETE_MATERIAL_SCOPE",
        pricedTotal: reisserTotal,
        comparableTotal: reisserTotal
      });
    }
  );

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
    expect(covered.status).toBe("MATCHING_UNCLEAR");
    expect(covered.materialScopeStatus).toBe("UNKNOWN");
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

  it("does not let an installation phrase block material comparison", () => {
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
    expect(option.comparableTotal).toBe(300);
    expect(option.materialScopeStatus).toBe("COMPLETE_MATERIAL_SCOPE");
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
