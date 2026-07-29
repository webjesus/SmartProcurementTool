import { describe, expect, it } from "vitest";
import type { ParsedPage } from "@/domain/repositories";
import {
  extractBasisDocumentDeterministically,
  extractSupplierDocumentDeterministically
} from "@/pdf/deterministic-document-extraction";

function page(
  pageNumber: number,
  lines: readonly string[],
  mode: ParsedPage["mode"] = "DIGITAL"
): ParsedPage {
  return {
    pageNumber,
    width: 595,
    height: 842,
    mode,
    imageCount: mode === "HYBRID" ? 1 : 0,
    textItems: lines.map((text, index) => ({
      id: `p${pageNumber}-i${index}`,
      rawText: text,
      normalizedText: text,
      order: index,
      region: {
        x: 0.06,
        y: 0.05 + index * 0.035,
        width: Math.min(0.88, Math.max(0.08, text.length * 0.006)),
        height: 0.015
      }
    }))
  };
}

describe("deterministic Basis document extraction", () => {
  it("extracts unique leaf positions, hierarchy and cross-page continuations", () => {
    const result = extractBasisDocumentDeterministically({
      documentId: "basis",
      documentRevisionId: "basis-r1",
      pages: [
        page(1, [
          "2. 422 Wärmeverteilnetze",
          "2.1. 422.1 Rohrleitungen und Zubehör",
          "*** Ausführungsbeschreibung 1",
          "Kupferrohr mit Wärmedämmung",
          "2.1.10. Gemäß Ausführungsbeschreibung 1",
          "Kupferrohr DN 20"
        ]),
        page(2, [
          "6,000 St .........................",
          "2.1.20.",
          "Kugelhahn DN 20",
          "3,000 St .........................",
          "Summe 2. 422 Wärmeverteilnetze ........................."
        ])
      ],
      createdAt: "2026-07-24T12:00:00.000Z"
    });

    expect(result.metrics).toMatchObject({
      totalCandidateAnchors: 3,
      totalValidLeafPositions: 2,
      duplicatePositionNumbers: [],
      missingQuantityOrUnit: [],
      continuationPositions: ["2.1.10"],
      unresolvedBlocks: []
    });
    expect(result.leafPositions.map((position) => position.positionNumber)).toEqual([
      "2.1.10.",
      "2.1.20."
    ]);
    expect(result.leafPositions.every((position) => !position.heading)).toBe(true);
    expect(result.headingPositions).toHaveLength(1);
    expect(result.headingPositions[0].heading).toBe(true);
    expect(result.leafPositions[0].evidence.map((source) => source.pageNumber)).toEqual([
      1,
      2
    ]);
    expect(result.pages.every((entry) => entry.provenance.extractionMethod === "DETERMINISTIC_TEXT_LAYER")).toBe(true);
  });
});

describe("deterministic supplier layout extraction", () => {
  it("parses GC LVNR rows, price bases and explicit bauseits coverage", () => {
    const result = extractSupplierDocumentDeterministically({
      documentId: "gc",
      documentRevisionId: "gc-r1",
      documentType: "SUPPLIER_OFFER",
      pages: [
        page(1, [
          "Position Menge E-Preis Preis",
          "POS 1000 LVNR 2 1 10 L EUR",
          "ART100 Schraube verzinkt 4,000 ST 42,77 1,71",
          "per 100",
          "2 1 20 Bauseits"
        ])
      ]
    });
    expect(result.layout).toBe("GC_LVNR");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      sourcePositionNumber: "2.1.10",
      articleNumber: "ART100",
      quantity: 4,
      priceBasis: 100,
      interpretedTotalPrice: 1.71,
      role: "PRIMARY"
    });
    expect(result.lines[1].role).toBe("PROVIDED_BY_OTHERS");
    expect(result.metrics.fallbackCandidateIds).toEqual([]);
  });

  it("keeps P&M optional lines separate from mandatory bundles", () => {
    const result = extractSupplierDocumentDeterministically({
      documentId: "pm",
      documentRevisionId: "pm-r2",
      documentType: "SUPPLIER_OFFER",
      pages: [
        page(1, [
          "Pos. Artikel Menge E-Preis € Gesamt €",
          "( 2.1.10 ) Angebotsposition 10 Kugelhahn",
          "10 MAIN 2 Stück 10,00 20,00",
          "Kugelhahn DN 20",
          "Optional bieten wir Ihnen an:",
          "20 OPT 1 Stück 3,00 3,00",
          "Entleerungsadapter"
        ])
      ]
    });
    expect(result.layout).toBe("P_AND_M");
    expect(result.lines.map((line) => line.role)).toEqual([
      "PRIMARY",
      "OPTIONAL"
    ]);
  });

  it("marks Reisser Wahlweise rows as alternatives without inventing a total", () => {
    const result = extractSupplierDocumentDeterministically({
      documentId: "reisser",
      documentRevisionId: "reisser-r1",
      documentType: "SUPPLIER_OFFER",
      pages: [
        page(1, [
          "Pos. WG Materialnr. Bezeichnung Menge Einzelpreis in Wert in",
          "LV.Pos. Preism.-einheit",
          "1.100 TR 1000000001 Rohr DN20 10 ST 2,00 20,00",
          "2.1.10",
          "1.101 Wahlweise bieten wir an:",
          "TR 1000000002 Rohr DN25 10 ST 2,50"
        ])
      ]
    });
    expect(result.layout).toBe("REISSER_LV_POS");
    expect(result.lines.at(-1)).toMatchObject({
      sourcePositionNumber: "2.1.10",
      articleNumber: "1000000002",
      role: "ALTERNATIVE",
      interpretedTotalPrice: null
    });
    expect(result.metrics.fallbackCandidateIds).toHaveLength(1);
  });

  it("uses printed Positionsnetto for specialized LV-referenced offers", () => {
    const result = extractSupplierDocumentDeterministically({
      documentId: "specialized",
      documentRevisionId: "specialized-r1",
      documentType: "SPECIALIZED_SUPPLIER_OFFER",
      pages: [
        page(1, [
          "Pos. Bestell-Nr. Menge Einzelpreis (EUR) Gesamtpreis (EUR)",
          "10 zu LV-Pos.: 1.1.10.",
          "51000006030 2 ST 100,00 200,00",
          "Wärmepumpe Typ X",
          "Kundenrabatt -20,00 % -40,00",
          "Positionsnetto 80,00 160,00"
        ])
      ]
    });
    expect(result.layout).toBe("SPECIALIZED_LV_POS");
    expect(result.lines[0]).toMatchObject({
      sourcePositionNumber: "1.1.10",
      interpretedUnitPrice: 80,
      interpretedTotalPrice: 160
    });
  });
});
