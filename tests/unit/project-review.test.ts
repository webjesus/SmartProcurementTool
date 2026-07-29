import { describe, expect, it } from "vitest";
import type { SupplierOption } from "@/domain/contracts";
import {
  buildPositionSupplierCoverage,
  buildProjectReviewPositions,
  classifyManualReview,
  deriveLiveProjectStatus,
  evaluateHistoricalMaterialEk,
  isFullyComparableSupplierOption,
  type ProjectDocumentDescriptor,
  selectActiveSupplierRevisions,
  selectUniqueLowestComparableOption,
  type SupplierCoverageContext
} from "@/domain/project-review";

const coverage: SupplierCoverageContext = {
  activeSupplierDocumentIds: new Set(["pum", "gienger", "reisser", "special"]),
  allRelevantOffersProcessed: true,
  supplierCoverageSufficient: true,
  projectContextConfirmed: true,
  disciplineContextConfirmed: true,
  materialUncertainty: false
};

function document(
  id: string,
  overrides: Partial<ProjectDocumentDescriptor> = {}
): ProjectDocumentDescriptor {
  return {
    id,
    revisionId: `${id}-r1`,
    role: "SUPPLIER_OFFER",
    projectKey: "project-a",
    projectNumber: null,
    projectName: "Project A",
    discipline: "HEIZUNG",
    lvNumber: null,
    supplier: id,
    offerNumber: null,
    documentDate: null,
    revision: 1,
    documentFamily: id,
    relevantBasisPositionIds: [],
    pageContext: [],
    ...overrides
  };
}

function option(
  id: string,
  comparableTotal: number,
  overrides: Partial<SupplierOption> = {}
): SupplierOption {
  return {
    id,
    basisPositionIds: ["basis"],
    supplierDocumentId: id,
    supplierLabel: id,
    matchedOfferLineIds: [`line-${id}`],
    matchLinkIds: [`match-${id}`],
    primaryPrice: comparableTotal,
    mandatoryComponentPrices: [],
    optionalPrices: [],
    pricedTotal: comparableTotal,
    comparableTotal,
    quantity: 1,
    unit: "Stk",
    scopeOfSupply: ["Vollständige Leistung"],
    technicalDeviations: [],
    missingComponents: [],
    validationIssueIds: [],
    evidenceIds: [`evidence-${id}`],
    quantityCompatible: true,
    unitCompatible: true,
    technicalCompatible: true,
    requiredScopeComplete: true,
    optionalSeparated: true,
    bundleCompatible: overrides.bundleCompatible ?? true,
    evidenceSufficient: true,
    extractionValidated: true,
    matchingAccepted: true,
    matchingReliable: true,
    offerAvailability: "PRESENT",
    materialScopeStatus:
      overrides.materialScopeStatus ?? "COMPLETE_MATERIAL_SCOPE",
    reasons: [],
    status: "CLEAR_RECOMMENDATION",
    ...overrides
  };
}

describe("project document chain", () => {
  it("selects only the active supplier revision before the historical cutoff", () => {
    const result = selectActiveSupplierRevisions({
      projectKey: "project-a",
      discipline: "HEIZUNG",
      historicalCutoff: "2025-10-10",
      documents: [
        document("old", {
          revisionId: "r1",
          documentFamily: "offer-family",
          supplier: "supplier-a",
          offerNumber: "4711",
          documentDate: "2025-09-01",
          revision: 1
        }),
        document("active", {
          revisionId: "r2",
          documentFamily: "offer-family",
          supplier: "supplier-a",
          offerNumber: "4711",
          documentDate: "2025-09-15",
          revision: 2
        }),
        document("late", {
          revisionId: "r3",
          documentFamily: "offer-family",
          supplier: "supplier-a",
          offerNumber: "4711",
          documentDate: "2025-10-11",
          revision: 3
        })
      ]
    });

    expect(result.active.map((document) => document.id)).toEqual([
      "active"
    ]);
    expect(result.superseded.map((document) => document.id)).toEqual([
      "old"
    ]);
    expect(result.excluded).toContainEqual(
      expect.objectContaining({ reason: "AFTER_HISTORICAL_CUTOFF" })
    );
  });

  it("keeps specialized supplier offers and excludes other projects and manufacturer calculations", () => {
    const result = selectActiveSupplierRevisions({
      projectKey: "project-a",
      discipline: "HEIZUNG",
      historicalCutoff: null,
      documents: [
        document("special", {
          revisionId: "special-r1",
          documentFamily: "special",
          role: "SPECIALIZED_SUPPLIER_OFFER",
          supplier: "special",
        }),
        document("other-project", {
          revisionId: "other-r1",
          documentFamily: "other",
          projectKey: "project-b",
          supplier: "other",
        }),
        document("manufacturer", {
          revisionId: "manufacturer-r1",
          documentFamily: "manufacturer",
          role: "MANUFACTURER_CALCULATION",
          supplier: null,
        })
      ]
    });

    expect(result.active.map((document) => document.id)).toEqual([
      "special"
    ]);
    expect(result.excluded.map((item) => item.reason).sort()).toEqual([
      "PROJECT_MISMATCH",
      "ROLE_NOT_SUPPLIER"
    ]);
  });
});

describe("fully comparable supplier options", () => {
  it.each([
    ["insufficient quantity", { quantityCompatible: false }],
    ["partial bundle", { requiredScopeComplete: false }],
    ["missing component", { missingComponents: ["Ventil"] }],
    ["optional component included", { optionalSeparated: false }],
    ["technical mismatch", { technicalCompatible: false }],
    [
      "unconfirmed matching",
      { matchingAccepted: false, matchingReliable: false }
    ]
  ])("excludes %s", (_label, overrides) => {
    expect(
      isFullyComparableSupplierOption(option("pum", 100, overrides), coverage)
    ).toBe(false);
  });

  it("does not let a lower incomplete quantity beat a complete bundle", () => {
    const result = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      coverage,
      options: [
        option("reisser", 90, { quantityCompatible: false }),
        option("pum", 100),
        option("gienger", 110)
      ]
    });
    expect(result.selectedSupplierOptionId).toBe("pum");
    expect(result.fullyComparableOptionIds).not.toContain("reisser");
  });

  it("lets complete options compete while a partial option keeps its price", () => {
    const result = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      coverage,
      options: [
        option("gienger", 80, {
          materialScopeStatus: "PARTIAL_MATERIAL_SCOPE",
          requiredScopeComplete: false,
          missingComponents: ["Wärmedämmschale"],
          comparableTotal: null
        }),
        option("pum", 100),
        option("reisser", 90)
      ]
    });
    expect(result.status).toBe("AUTO_SELECTED_LOWEST_PRICE");
    expect(result.selectedSupplierOptionId).toBe("reisser");
    expect(result.fullyComparableOptionIds).toEqual(["pum", "reisser"]);
  });

  it("selects the only complete option when all other responses are explicit no-offers", () => {
    const result = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      coverage,
      options: [
        option("gienger", 100),
        option("pum", 0, {
          offerAvailability: "EXPLICIT_NO_OFFER",
          materialScopeStatus: "EXPLICIT_NO_OFFER",
          pricedTotal: null,
          comparableTotal: null,
          status: "NO_OFFER"
        }),
        option("reisser", 0, {
          offerAvailability: "EXPLICIT_NO_OFFER",
          materialScopeStatus: "EXPLICIT_NO_OFFER",
          pricedTotal: null,
          comparableTotal: null,
          status: "NO_OFFER"
        })
      ]
    });
    expect(result.status).toBe("AUTO_SELECTED_LOWEST_PRICE");
    expect(result.selectedSupplierOptionId).toBe("gienger");
    expect(result.reasons).toContain(
      "Einziges vollständig vergleichbares Angebot"
    );
  });

  it("does not treat an ambiguous missing supplier line as explicit no-offer", () => {
    const result = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      coverage,
      options: [
        option("gienger", 100),
        option("pum", 0, {
          offerAvailability: "COVERED_WITHOUT_OFFER",
          materialScopeStatus: "UNKNOWN",
          pricedTotal: null,
          comparableTotal: null,
          status: "MATCHING_UNCLEAR"
        }),
        option("reisser", 0, {
          offerAvailability: "EXPLICIT_NO_OFFER",
          materialScopeStatus: "EXPLICIT_NO_OFFER",
          pricedTotal: null,
          comparableTotal: null,
          status: "NO_OFFER"
        })
      ]
    });
    expect(result.status).toBe("MANAGER_EXPLANATION_REQUIRED");
    expect(result.selectedSupplierOptionId).toBeNull();
  });

  it("rejects an equal minimum and incomplete supplier coverage", () => {
    const equal = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      coverage,
      options: [option("pum", 100), option("gienger", 100)]
    });
    const incomplete = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      coverage: { ...coverage, allRelevantOffersProcessed: false },
      options: [option("pum", 100), option("gienger", 110)]
    });
    expect(equal.status).toBe("MANAGER_EXPLANATION_REQUIRED");
    expect(incomplete.status).toBe("MANAGER_EXPLANATION_REQUIRED");
  });
});

describe("live project production status", () => {
  it("selects a unique lowest comparable option without historical documents", () => {
    const positions = buildProjectReviewPositions({
      basisPositions: [
        {
          id: "basis-live",
          documentId: "basis-document",
          positionNumber: "1.1.1",
          description: "Live fixture",
          quantity: 1,
          unit: "Stk",
          heading: false,
          optional: false,
          alternative: false,
          parentId: null,
          technicalAttributes: [],
          manufacturerRequirements: [],
          requiredScope: [],
          notes: [],
          evidence: [],
          verificationStatus: "MACHINE_VALIDATED"
        }
      ],
      options: [
        option("pum", 100, { basisPositionIds: ["basis-live"] }),
        option("gienger", 110, { basisPositionIds: ["basis-live"] })
      ],
      coverage,
      historicalMaterialEkByBasisId: {},
      calculatedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(positions[0].independent.status).toBe(
      "AUTO_SELECTED_LOWEST_PRICE"
    );
    expect(positions[0].liveStatus).toBe("AUTO_SELECTED_LOWEST_PRICE");
    expect(positions[0].historical.classification).toBe(
      "HISTORICAL_EK_UNRESOLVED"
    );
  });

  it("does not require an irrelevant specialized supplier for an ordinary position", () => {
    const ordinary = buildPositionSupplierCoverage({
      basisPositionId: "ordinary",
      documents: [
        {
          id: "pum",
          role: "SUPPLIER_OFFER",
          processed: true,
          scope: { status: "ALL" }
        },
        {
          id: "special",
          role: "SPECIALIZED_SUPPLIER_OFFER",
          processed: false,
          scope: {
            status: "LISTED",
            basisPositionIds: ["special-position"]
          }
        }
      ],
      options: [option("pum", 100, { basisPositionIds: ["ordinary"] })]
    });
    const specialized = buildPositionSupplierCoverage({
      basisPositionId: "special-position",
      documents: [
        {
          id: "pum",
          role: "SUPPLIER_OFFER",
          processed: true,
          scope: { status: "ALL" }
        },
        {
          id: "special",
          role: "SPECIALIZED_SUPPLIER_OFFER",
          processed: false,
          scope: {
            status: "LISTED",
            basisPositionIds: ["special-position"]
          }
        }
      ],
      options: []
    });

    expect(ordinary.coverageStatus).toBe("SUFFICIENT");
    expect(ordinary.irrelevantSpecializedSuppliers).toEqual(["special"]);
    expect(specialized.coverageStatus).toBe("PARTIAL");
    expect(specialized.missingExpectedSuppliers).toContain("special");
  });

  it("maps incomplete processing to PROCESSING_PENDING and preserves DEFERRED", () => {
    const partial = buildPositionSupplierCoverage({
      basisPositionId: "basis",
      documents: [
        {
          id: "pum",
          role: "SUPPLIER_OFFER",
          processed: true,
          scope: { status: "ALL" }
        },
        {
          id: "gienger",
          role: "SUPPLIER_OFFER",
          processed: false,
          scope: { status: "ALL" }
        }
      ],
      options: [option("pum", 100)]
    });
    const independent = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      options: [option("pum", 100)],
      coverage
    });
    expect(
      deriveLiveProjectStatus({ independent, coverage: partial })
    ).toBe("PROCESSING_PENDING");
    expect(
      deriveLiveProjectStatus({
        independent,
        coverage: partial,
        decisions: [
          {
            id: "deferred",
            basisPositionId: "basis",
            supplierDocumentId: null,
            status: "DEFERRED",
            comment: "Später prüfen",
            operator: "operator",
            timestamp: "2026-01-01T00:00:00.000Z"
          }
        ]
      })
    ).toBe("DEFERRED");
  });

  it("does not count a globally processed supplier as covered when the position source is not covered", () => {
    const positionCoverage = buildPositionSupplierCoverage({
      basisPositionId: "basis",
      documents: [
        {
          id: "pum",
          role: "SUPPLIER_OFFER",
          processed: true,
          scope: { status: "ALL" }
        },
        {
          id: "reisser",
          role: "SUPPLIER_OFFER",
          processed: true,
          scope: { status: "ALL" }
        }
      ],
      options: [
        option("pum", 0, {
          basisPositionIds: ["basis"],
          matchedOfferLineIds: [],
          matchLinkIds: [],
          comparableTotal: null,
          offerAvailability: "NOT_COVERED",
          status: "MATCHING_UNCLEAR"
        }),
        option("reisser", 100, { basisPositionIds: ["basis"] })
      ]
    });

    expect(positionCoverage.processedRelevantSuppliers).toEqual(["reisser"]);
    expect(positionCoverage.missingExpectedSuppliers).toEqual(["pum"]);
    expect(positionCoverage.coverageStatus).toBe("PARTIAL");
  });

  it("routes a confirmed technical deviation without complete options to no comparable offer", () => {
    const technicalOption = option("supplier", 100, {
      technicalCompatible: false,
      technicalDeviations: ["Nennweite weicht ab"],
      comparableTotal: null,
      status: "TECHNICAL_DEVIATION"
    });
    const positionCoverage = buildPositionSupplierCoverage({
      basisPositionId: "basis",
      documents: [
        {
          id: "supplier",
          role: "SUPPLIER_OFFER",
          processed: true,
          scope: { status: "ALL" }
        }
      ],
      options: [technicalOption]
    });
    const independent = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      options: [technicalOption],
      coverage
    });

    expect(
      deriveLiveProjectStatus({
        independent,
        coverage: positionCoverage,
        options: [technicalOption]
      })
    ).toBe("NO_COMPARABLE_OFFER");
  });

  it("keeps the live status invariant exhaustive and mutually exclusive", () => {
    const statuses = [
      "AUTO_SELECTED_LOWEST_PRICE",
      "MANUAL_DECISION_REQUIRED",
      "MANUAL_DECIDED",
      "DEFERRED",
      "NO_COMPARABLE_OFFER",
      "PROCESSING_PENDING",
      "PROCESSING_ERROR"
    ];
    const assigned = [
      "PROCESSING_PENDING",
      "AUTO_SELECTED_LOWEST_PRICE",
      "DEFERRED",
      "NO_COMPARABLE_OFFER"
    ];
    const counts = Object.fromEntries(
      statuses.map((status) => [
        status,
        assigned.filter((assignedStatus) => assignedStatus === status).length
      ])
    );
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(
      assigned.length
    );
  });
});

describe("required price regression fixtures", () => {
  const cases = [
    {
      position: "1.1.490",
      prices: { pum: 209.83, gienger: 221.47, reisser: 224.69 },
      historical: 209.83,
      expectedSupplier: "pum",
      expected: "AUTO_CONFIRMED_BY_HISTORY"
    },
    {
      position: "1.1.500",
      prices: { pum: 276.92, gienger: 292.58, reisser: 296.88 },
      historical: 276.92,
      expectedSupplier: "pum",
      expected: "AUTO_CONFIRMED_BY_HISTORY"
    },
    {
      position: "1.1.510",
      prices: { reisser: 40.44, pum: 55.74, gienger: 59.19 },
      historical: 55.74,
      expectedSupplier: "reisser",
      expected: "AUTO_LOWEST_BUT_HISTORY_DIFFERS"
    },
    {
      position: "1.1.520",
      prices: { reisser: 1891.5, pum: 1896.26, gienger: 1988.59 },
      historical: 1896.26,
      expectedSupplier: "pum",
      incompleteSupplier: "reisser" as string | undefined,
      expected: "AUTO_CONFIRMED_BY_HISTORY"
    },
    {
      position: "1.1.530",
      prices: { pum: 33.25, gienger: 36.16, reisser: 36.84 },
      historical: 33.25,
      expectedSupplier: "pum",
      expected: "AUTO_CONFIRMED_BY_HISTORY"
    },
    {
      position: "1.1.540",
      prices: { pum: 39.35, gienger: 43.42, reisser: 45.12 },
      historical: 39.35,
      expectedSupplier: "pum",
      expected: "AUTO_CONFIRMED_BY_HISTORY"
    },
    {
      position: "2.1.790",
      prices: { pum: 37.32, reisser: 37.48 },
      historical: 37.48,
      expectedSupplier: "pum",
      expected: "AUTO_LOWEST_BUT_HISTORY_DIFFERS"
    },
    {
      position: "2.1.800",
      prices: { pum: 62.77, reisser: 64.79 },
      historical: 64.8,
      expectedSupplier: "pum",
      expected: "AUTO_LOWEST_BUT_HISTORY_DIFFERS"
    }
  ].map((entry) => ({
    ...entry,
    incompleteSupplier:
      "incompleteSupplier" in entry ? entry.incompleteSupplier : undefined
  }));

  it.each(cases)(
    "$position independently selects $expectedSupplier and classifies $expected",
    ({ position, prices, historical, expectedSupplier, incompleteSupplier, expected }) => {
      const options = Object.entries(prices).map(([supplier, price]) =>
        option(supplier, price, {
          basisPositionIds: [position],
          quantityCompatible: supplier !== incompleteSupplier
        })
      );
      const independent = selectUniqueLowestComparableOption({
        basisPositionId: position,
        options,
        coverage
      });
      const evaluated = evaluateHistoricalMaterialEk({
        independent,
        options,
        historicalMaterialEk: historical,
        roundingTolerance: 0.011
      });
      expect(independent.selectedSupplierOptionId).toBe(expectedSupplier);
      expect(evaluated.classification).toBe(expected);
    }
  );

  it("2.1.730 remains a manager case when technical and scope compatibility are unproven", () => {
    const options = [
      option("pum", 100, {
        basisPositionIds: ["2.1.730"],
        technicalCompatible: false,
        technicalDeviations: ["Druckbereich nicht bestätigt"]
      }),
      option("reisser", 95, {
        basisPositionIds: ["2.1.730"],
        requiredScopeComplete: false,
        missingComponents: ["Absperrventil"]
      })
    ];
    const independent = selectUniqueLowestComparableOption({
      basisPositionId: "2.1.730",
      options,
      coverage
    });
    const evaluated = evaluateHistoricalMaterialEk({
      independent,
      options,
      historicalMaterialEk: 100
    });
    expect(independent.status).toBe("MANAGER_EXPLANATION_REQUIRED");
    expect(evaluated.classification).toBe("NOT_COMPARABLE");
  });

  it("routes an ambiguous present offer to system review instead of no comparable", () => {
    const unresolved = option("pum", 209.83, {
      comparableTotal: null,
      materialScopeStatus: "UNKNOWN",
      technicalCompatible: false,
      technicalComparisonStatus: "UNRESOLVED",
      unresolvedTechnicalAttributes: [
        "Technische Eigenschaft nicht ausreichend belegt"
      ],
      status: "MATCHING_UNCLEAR"
    });
    const independent = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      options: [unresolved],
      coverage
    });
    const positionCoverage = {
      basisPositionId: "basis",
      relevantSuppliers: ["pum"],
      processedRelevantSuppliers: ["pum"],
      irrelevantSpecializedSuppliers: [],
      explicitNoOfferSuppliers: [],
      missingExpectedSuppliers: [],
      missingSources: [],
      coverageStatus: "SUFFICIENT" as const
    };
    const liveStatus = deriveLiveProjectStatus({
      independent,
      coverage: positionCoverage,
      options: [unresolved]
    });
    expect(liveStatus).toBe("MANUAL_DECISION_REQUIRED");
    expect(
      classifyManualReview({
        liveStatus,
        independent,
        coverage: positionCoverage,
        options: [unresolved]
      })
    ).toMatchObject({
      reviewQueue: "SYSTEM_REVIEW",
      primaryReasonCategory: "TECHNICAL_EQUIVALENCE_UNCLEAR"
    });
  });

  it("keeps a true equal minimum in the manager decision queue", () => {
    const options = [option("pum", 100), option("gienger", 100)];
    const independent = selectUniqueLowestComparableOption({
      basisPositionId: "basis",
      options,
      coverage
    });
    const positionCoverage = {
      basisPositionId: "basis",
      relevantSuppliers: ["pum", "gienger"],
      processedRelevantSuppliers: ["pum", "gienger"],
      irrelevantSpecializedSuppliers: [],
      explicitNoOfferSuppliers: [],
      missingExpectedSuppliers: [],
      missingSources: [],
      coverageStatus: "SUFFICIENT" as const
    };
    expect(
      classifyManualReview({
        liveStatus: "MANUAL_DECISION_REQUIRED",
        independent,
        coverage: positionCoverage,
        options
      })
    ).toMatchObject({
      reviewQueue: "MANAGER_DECISION",
      primaryReasonCategory: "EQUAL_MINIMUM"
    });
  });
});
