import { describe, expect, it } from "vitest";
import type { BasisPosition } from "@/domain/contracts";
import type { ParsedPage } from "@/domain/repositories";
import {
  estimateDeterministicFirstCoverage,
  extractSupplierPageDeterministically,
  linkBasisPositionContinuations,
  reconstructTextLines,
  routeExtractionPage
} from "@/pdf/deterministic-extraction";

type Item = ParsedPage["textItems"][number];

function textItem(
  id: string,
  text: string,
  x: number,
  y: number,
  width = Math.max(0.015, text.length * 0.006)
): Item {
  return {
    id,
    rawText: text,
    normalizedText: text,
    order: Number(id.replace(/\D/g, "")) || 0,
    region: { x, y, width, height: 0.012 }
  };
}

function supplierFixture(): ParsedPage {
  const items: Item[] = [];
  let id = 0;
  const add = (text: string, x: number, y: number, width?: number) => {
    items.push(textItem(`ti-${++id}`, text, x, y, width));
  };
  const header = (y: number) => {
    add("Pos.", 0.05, y);
    add("Artikel", 0.12, y);
    add("Menge", 0.6, y);
    add("E-Preis €", 0.78, y);
    add("Gesamt €", 0.9, y);
  };
  const anchor = (position: string, short: string, y: number) => {
    add(`( ${position} )`, 0.12, y);
    add("Angebotsposition", 0.3, y);
    add(position.split(".").at(-1)!, 0.46, y);
    add(short, 0.55, y, 0.25);
  };
  const row = (
    supplierPosition: string,
    article: string,
    quantity: string,
    unitPrice: string,
    totalPrice: string,
    description: string,
    y: number
  ) => {
    add(supplierPosition, 0.05, y);
    add(article, 0.12, y);
    add(quantity, 0.6, y);
    add("Stück", 0.65, y);
    add(unitPrice, 0.79, y);
    add(totalPrice, 0.9, y);
    add(description, 0.12, y + 0.018, 0.38);
  };

  header(0.04);
  anchor("2.1.800", "Strangabsperrventil DN 32", 0.09);
  row("1240", "NK3V32", "3", "47,20", "141,60", "Resideo Ventil DN 32", 0.13);
  row("1250", "VA251032", "3", "15,57", "46,71", "Resideo Dämmschale DN 32", 0.2);
  anchor("2.1.810", "Strangabsperrventil DN 40", 0.28);
  row("1260", "NK3V40", "8", "60,44", "483,52", "Resideo Ventil DN 40", 0.32);
  row("1270", "VA251040", "8", "23,10", "184,80", "Resideo Dämmschale DN 40", 0.39);
  anchor("2.1.820", "Strangabsperrventil DN 50", 0.47);
  row("1280", "NK3V50", "6", "84,46", "506,76", "Resideo Ventil DN 50", 0.51);
  row("1290", "VA251050", "6", "24,45", "146,70", "Resideo Dämmschale DN 50", 0.58);
  add("Optional bieten wir Ihnen an:", 0.12, 0.65, 0.24);
  row("1300", "EAAL", "1", "14,63", "14,63", "Resideo Entleerungsadapter", 0.69);
  add("Objektsumme", 0.12, 0.77);
  add("999,99", 0.9, 0.77);
  anchor("2.1.830", "Strangregulierventil DN 15", 0.83);

  return {
    pageNumber: 15,
    width: 595,
    height: 842,
    mode: "DIGITAL",
    textItems: items,
    imageCount: 0
  };
}

function extractFixture() {
  return extractSupplierPageDeterministically({
    documentId: "supplier-doc",
    documentRevisionId: "supplier-revision-2",
    documentType: "SUPPLIER_OFFER",
    discipline: "HEIZUNG",
    page: supplierFixture(),
    createdAt: "2026-07-24T12:00:00.000Z"
  });
}

describe("deterministic text-layer extraction", () => {
  it("reconstructs rows, components, optional markers and acceptance totals", () => {
    const result = extractFixture();
    const lines = result.envelope.extraction.offerGroups[0].lines;
    expect(lines).toHaveLength(7);
    expect(lines.map((line) => line.supplierPositionNumber)).toEqual([
      "1240",
      "1250",
      "1260",
      "1270",
      "1280",
      "1290",
      "1300"
    ]);
    expect(lines.map((line) => line.role)).toEqual([
      "PRIMARY",
      "MANDATORY_COMPONENT",
      "PRIMARY",
      "MANDATORY_COMPONENT",
      "PRIMARY",
      "MANDATORY_COMPONENT",
      "OPTIONAL"
    ]);

    const byPosition = (position: string) =>
      lines.filter((line) => line.sourcePositionNumber === position);
    expect(
      byPosition("2.1.800")
        .filter((line) => line.role !== "OPTIONAL")
        .reduce((sum, line) => sum + line.interpretedTotalPrice!, 0)
    ).toBeCloseTo(188.31, 2);
    expect(
      byPosition("2.1.810")
        .filter((line) => line.role !== "OPTIONAL")
        .reduce((sum, line) => sum + line.interpretedTotalPrice!, 0)
    ).toBeCloseTo(668.32, 2);
    expect(
      byPosition("2.1.820")
        .filter((line) => line.role !== "OPTIONAL")
        .reduce((sum, line) => sum + line.interpretedTotalPrice!, 0)
    ).toBeCloseTo(653.46, 2);
    expect(byPosition("2.1.820").at(-1)?.articleNumber).toBe("EAAL");
    expect(byPosition("2.1.820").at(-1)?.role).toBe("OPTIONAL");
  });

  it("validates arithmetic, evidence geometry and excludes totals", () => {
    const result = extractFixture();
    const lines = result.envelope.extraction.offerGroups[0].lines;
    expect(result.validationIssues).toEqual([]);
    expect(result.provenance.validationStatus).toBe("COMPLETED");
    expect(result.provenance.confidence).toBe(1);
    expect(lines.every((line) => line.verificationStatus === "MACHINE_VALIDATED")).toBe(true);
    expect(
      lines.every((line) =>
        line.evidence.every(
          (item) =>
            item.pageNumber === 15 &&
            item.textItemIds.length > 0 &&
            item.region.width > 0 &&
            item.region.height > 0
        )
      )
    ).toBe(true);
    expect(lines.some((line) => /Objektsumme/i.test(line.description))).toBe(false);
  });

  it("stores deterministic provenance without a fake OpenAI response", () => {
    const result = extractFixture();
    expect(result.provenance).toMatchObject({
      extractionMethod: "DETERMINISTIC_TEXT_LAYER",
      documentRevisionId: "supplier-revision-2",
      pageNumber: 15,
      parserVersion: "deterministic-supplier-text-v1",
      validationStatus: "COMPLETED",
      fallbackCandidateBlockIds: []
    });
    expect(result.provenance.rawTextItemsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.provenance).not.toHaveProperty("responseId");
  });

  it("marks only an ambiguous block as an AI fallback candidate without calling AI", () => {
    const page = supplierFixture();
    page.textItems = page.textItems.filter(
      (item) =>
        !["3", "Stück", "47,20", "141,60"].includes(item.normalizedText) ||
        item.region.y > 0.18
    );
    const result = extractSupplierPageDeterministically({
      documentId: "supplier-doc",
      documentRevisionId: "supplier-revision-2",
      page
    });
    expect(result.provenance.validationStatus).toBe("FAILED");
    expect(result.provenance.fallbackCandidateBlockIds).toHaveLength(1);
    expect(
      result.validationIssues.some(
        (issue) => issue.code === "AI_FALLBACK_CANDIDATE"
      )
    ).toBe(true);
  });

  it("routes digital and reliable hybrid pages deterministic-first", () => {
    const digital = supplierFixture();
    expect(routeExtractionPage(digital).primary).toBe(
      "DETERMINISTIC_TEXT_LAYER"
    );
    expect(
      routeExtractionPage({ ...digital, mode: "HYBRID", imageCount: 1 }).primary
    ).toBe("DETERMINISTIC_TEXT_LAYER");
    expect(
      routeExtractionPage({
        ...digital,
        mode: "SCAN",
        textItems: [],
        imageCount: 1
      }).primary
    ).toBe("OCR_VISUAL");
    expect(
      estimateDeterministicFirstCoverage([
        { mode: "DIGITAL", textItems: 100, characters: 900 },
        { mode: "HYBRID", textItems: 80, characters: 600 },
        { mode: "SCAN", textItems: 0, characters: 0 }
      ])
    ).toEqual({
      totalPages: 3,
      deterministicPages: 2,
      ambiguousOrVisualPages: 1,
      deterministicShare: 2 / 3
    });
  });

  it("reconstructs text items into geometry-aware lines", () => {
    const reconstructed = reconstructTextLines(supplierFixture());
    expect(reconstructed.some((line) => line.text.includes("Pos."))).toBe(true);
    expect(
      reconstructed.some((line) => line.text.includes("1240"))
    ).toBe(true);
  });
});

describe("Basis continuation linking", () => {
  const basis: BasisPosition = {
    id: "basis-tail",
    documentId: "basis-doc",
    parentId: null,
    positionNumber: "9.1.20.",
    description: "Valve DN 50",
    quantity: null,
    unit: null,
    technicalAttributes: [{ name: "Nennweite", value: "DN 50" }],
    manufacturerRequirements: [],
    requiredScope: [],
    notes: [],
    optional: false,
    alternative: false,
    heading: false,
    evidence: [
      {
        id: "anchor-evidence",
        documentId: "basis-doc",
        pageNumber: 3,
        textItemIds: ["anchor"],
        sourceText: "9.1.20 Valve DN 50",
        region: { x: 0.1, y: 0.86, width: 0.4, height: 0.03 },
        cropPath: null,
        status: "VERIFIED_NATIVE"
      }
    ],
    verificationStatus: "NEEDS_REVIEW"
  };

  it("links quantity, unit and evidence from the following page generically", () => {
    const page: ParsedPage = {
      pageNumber: 4,
      width: 595,
      height: 842,
      mode: "DIGITAL",
      imageCount: 0,
      textItems: [
        textItem("continuation", "Komplett liefern und montieren", 0.1, 0.05),
        textItem("quantity", "6,000", 0.7, 0.1),
        textItem("unit", "St", 0.8, 0.1),
        textItem("next", "( 9.1.30 ) Angebotsposition 30", 0.1, 0.2)
      ]
    };
    const linked = linkBasisPositionContinuations({
      positions: [basis],
      continuationPages: [page]
    })[0];
    expect(linked.quantity).toBe(6);
    expect(linked.unit).toBe("St");
    expect(linked.evidence.map((item) => item.pageNumber)).toEqual([3, 4]);
    expect(linked.requiredScope).toContain("Komplett liefern und montieren");
  });

  it("does not take a quantity appearing after the next position anchor", () => {
    const page: ParsedPage = {
      pageNumber: 4,
      width: 595,
      height: 842,
      mode: "DIGITAL",
      imageCount: 0,
      textItems: [
        textItem("next", "( 9.1.30 ) Angebotsposition 30", 0.1, 0.05),
        textItem("quantity", "6,000", 0.7, 0.1),
        textItem("unit", "St", 0.8, 0.1)
      ]
    };
    const linked = linkBasisPositionContinuations({
      positions: [basis],
      continuationPages: [page]
    })[0];
    expect(linked.quantity).toBeNull();
    expect(linked.evidence).toHaveLength(1);
  });
});
