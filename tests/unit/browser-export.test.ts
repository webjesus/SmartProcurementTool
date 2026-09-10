import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBrowserAnalysis } from "@/browser-projects/browser-analysis";
import {
  exportBrowserProjectExcel,
  exportBrowserProjectPdf
} from "@/browser-projects/browser-export";
import type { BrowserWorkerResult } from "@/browser-projects/processing-protocol";
import type {
  BrowserAnalysisSnapshot,
  BrowserDocumentRecord,
  BrowserSelectionRecord
} from "@/browser-projects/types";

const projectId = "project-reviewed-export";
const measuredRegion = { x: 0.08, y: 0.12, width: 0.72, height: 0.04 };

function document(input: {
  documentId: string;
  documentType: "BASIS_LV" | "SUPPLIER_OFFER";
  supplierName?: string;
  pageCount?: number;
}): BrowserDocumentRecord {
  const basis = input.documentType === "BASIS_LV";
  return {
    projectId,
    documentId: input.documentId,
    originalFileName: basis ? "Basis-LV.pdf" : "Prüflieferant-München.pdf",
    mimeType: "application/pdf",
    size: 1_024,
    sha256: input.documentId.padEnd(64, "0").slice(0, 64),
    uploadedAt: "2026-09-07T08:00:00.000Z",
    pageCount: input.pageCount ?? 1,
    detectedDocumentType: input.documentType,
    documentType: input.documentType,
    discipline: "HEIZUNG",
    supplierName: input.supplierName ?? null,
    offerNumber: basis ? null : "ANG-Ü-100",
    documentVersion: null,
    revision: 1,
    revisionOfDocumentId: null,
    relationType: "SEPARATE_OFFER",
    scanState: "TEXT_AVAILABLE",
    projectName: "Überströmventile München",
    projectNumber: "P-100",
    lvNumber: basis ? "LV-Ü-1" : null,
    classificationDimensions: {
      documentRole: "HIGH",
      supplier: basis ? "LOW" : "HIGH",
      discipline: "HIGH",
      projectIdentity: "HIGH",
      offerNumber: basis ? "LOW" : "HIGH",
      relation: "HIGH",
      scanState: "HIGH"
    },
    classificationSignals: [],
    textLayerCharacterCount: 10_000,
    preliminaryPositionCount: 55,
    activeBasis: basis,
    excludedFromProcessing: false,
    manualRoleOverride: false,
    manualBasisOverrideConfirmed: false,
    classificationConfidence: "HIGH",
    classificationWarnings: [],
    processingStatus: "BEREIT"
  };
}

function makeAnalysis(count = 55): BrowserAnalysisSnapshot {
  const basisLines: BrowserWorkerResult["basisLines"] = Array.from(
    { length: count },
    (_, index) => {
      const ordinal = index + 1;
      const basisOnly = count >= 4 && ordinal === count;
      return {
        documentId: "basis-doc",
        positionNumber: `1.1.${String(ordinal * 10)}`,
        description: basisOnly
          ? "Schalldämpfer Zirkoniumkapsel Sonderausführung"
          : `Überströmventil Größe ${ordinal} für Rücklauf München`,
        quantity: ordinal,
        unit: "St",
        pageNumber: Math.floor(index / 10) + 1,
        lineIndex: index,
        region: measuredRegion
      };
    }
  );
  const supplierLines: BrowserWorkerResult["supplierLines"] = Array.from(
    { length: Math.max(0, count - 1) },
    (_, index) => {
      const ordinal = index + 1;
      const reviewOnly = count >= 4 && (ordinal === count - 2 || ordinal === count - 1);
      return {
        documentId: "supplier-doc",
        positionNumber: reviewOnly ? `FREMD-${ordinal}` : `1.1.${String(ordinal * 10)}`,
        description: `Überströmventil Größe ${ordinal} für Rücklauf München`,
        quantity: ordinal,
        unit: "St",
        pageNumber: Math.floor(index / 10) + 1,
        lineIndex: index,
        region: measuredRegion,
        supplier: "Prüflieferant München",
        articleNumber: `Ä-${ordinal}`,
        unitPrice: 10 + ordinal,
        totalPrice: ordinal * (10 + ordinal)
      };
    }
  );
  const result: BrowserWorkerResult = {
    basisLines,
    supplierLines,
    warnings: [],
    diagnostics: {
      pagesInspected: 12,
      pagesParsed: 12,
      ocrRequiredPages: 0,
      matchingCandidates: supplierLines.length,
      documents: ["basis-doc", "supplier-doc"].map(documentId => ({ documentId, pagesInspected: Math.ceil(count / 10), candidatePositions: documentId === "basis-doc" ? count : supplierLines.length, extractedPositions: documentId === "basis-doc" ? count : supplierLines.length, missingSourceRegions: 0, ocrProcessedPages: 0, ocrFailedPages: 0, ocrRequiredPages: 0, multiPagePositions: 0 }))
    }
  };
  return buildBrowserAnalysis({
    projectId,
    documents: [
      document({
        documentId: "basis-doc",
        documentType: "BASIS_LV",
        pageCount: Math.ceil(count / 10)
      }),
      document({
        documentId: "supplier-doc",
        documentType: "SUPPLIER_OFFER",
        supplierName: "Prüflieferant München",
        pageCount: Math.ceil(count / 10)
      })
    ],
    result
  });
}

function selectionsFor(analysis: BrowserAnalysisSnapshot, count: number): BrowserSelectionRecord[] {
  return analysis.pilot.projectReview.positions.slice(0, count).map((position) => {
    const option = position.options.find((candidate) => candidate.offerAvailability === "PRESENT");
    if (!option) {
      throw new Error(`Fixture has no selectable option for ${position.basis.positionNumber}`);
    }
    return {
      projectId,
      positionId: position.basis.id,
      selectedSupplierOptionId: option.id,
      selectedLineIds: option.matchedOfferLineIds,
      comment: "Vom Menschen geprüft",
      updatedAt: "2026-09-07T08:30:00.000Z"
    };
  });
}

function markRejected(analysis: BrowserAnalysisSnapshot, positionNumber: string) {
  const position = analysis.pilot.projectReview.positions.find(
    (candidate) => candidate.basis.positionNumber === positionNumber
  );
  const link = analysis.pilot.analysis?.matchLinks.find((candidate) =>
    candidate.basisPositionIds.includes(position?.basis.id ?? "")
  );
  if (!position || !link) throw new Error("Fixture has no rejectable match");
  analysis.matchReviews.push({
    projectId,
    analysisVersionId: analysis.analysisVersionId,
    matchLinkId: link.id,
    positionId: position.basis.id,
    decision: "REJECTED",
    operator: "Test",
    comment: "Falsche Zuordnung",
    updatedAt: "2026-09-07T08:20:00.000Z"
  });
}

let downloadedBlob: Blob | null;

beforeEach(() => {
  downloadedBlob = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (!(blob instanceof Blob)) throw new Error("Expected a Blob download");
    downloadedBlob = blob;
    return "blob:reviewed-export";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal("document", {
    createElement: () => ({ href: "", download: "", click: () => undefined })
  });
  vi.stubGlobal("window", { setTimeout });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function takeDownloadedBlob(): Blob {
  if (!downloadedBlob) throw new Error("No file was downloaded");
  return downloadedBlob;
}

async function readWorkbook(blob: Blob) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet = workbook.getWorksheet("LV-Vergleich");
  if (!sheet) throw new Error("LV-Vergleich worksheet is missing");
  return sheet;
}

function valuesByHeader(sheet: ExcelJS.Worksheet, rowNumber: number) {
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => {
    headers.set(String(cell.value), column);
  });
  return Object.fromEntries(
    [...headers.entries()].map(([header, column]) => [
      header,
      sheet.getRow(rowNumber).getCell(column).value
    ])
  );
}

async function readPdf(blob: Blob) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(await blob.arrayBuffer())
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await loadingTask.destroy();
  return { pageCount: pdf.numPages, text: pageTexts.join("\n") };
}

describe("reviewed browser export", () => {
  it("does not turn an advisory recommendation into a human selection", async () => {
    const analysis = makeAnalysis(2);

    await exportBrowserProjectExcel({
      projectName: "Projekt Überprüfung",
      analysis,
      selections: []
    });

    const sheet = await readWorkbook(takeDownloadedBlob());
    const row = valuesByHeader(sheet, 2);
    expect(row["Basis-Position"]).toBe("1.1.10");
    expect(row["Lieferant"]).toBe("");
    expect(row["GP"]).toBeNull();
    expect(row["Prüfstatus"]).toBe("Nicht ausgewählt");
    expect(row["Basis-Quelle"]).toBe("basis-doc, Seite 1");
    expect(sheet.rowCount).toBe(3);
  });

  it("keeps all 55 basis positions and makes every review state explicit in XLSX", async () => {
    const analysis = makeAnalysis();
    markRejected(analysis, "1.1.540");
    const selections = selectionsFor(analysis, 51);

    await exportBrowserProjectExcel({
      projectName: "Projekt Überprüfung",
      analysis,
      selections
    });

    const sheet = await readWorkbook(takeDownloadedBlob());
    expect(sheet.rowCount).toBe(56);
    const rows = new Map(
      Array.from({ length: 55 }, (_, index) => {
        const row = valuesByHeader(sheet, index + 2);
        return [String(row["Basis-Position"]), row] as const;
      })
    );
    expect(rows.get("1.1.510")).toMatchObject({
      Prüfstatus: "Ausgewählt",
      Lieferant: "Prüflieferant München",
      "Artikel / Typ": "Ä-51",
      "Basis-Quelle": "basis-doc, Seite 6",
      Angebotsquelle: "supplier-doc, Seite 6"
    });
    expect(rows.get("1.1.520")).toMatchObject({
      Prüfstatus: "Zuordnung ungeklärt",
      Lieferant: "",
      GP: null
    });
    expect(rows.get("1.1.530")?.["Prüfstatus"]).toBe("Zuordnung ungeklärt");
    expect(rows.get("1.1.540")?.["Prüfstatus"]).toBe("Zuordnung abgelehnt");
    expect(rows.get("1.1.550")).toMatchObject({
      Beschreibung: "Schalldämpfer Zirkoniumkapsel Sonderausführung",
      Prüfstatus: "Nicht ausgewählt",
      Lieferant: ""
    });
  });

  it("creates a parseable multipage PDF containing all positions, states, umlauts and source references", async () => {
    const analysis = makeAnalysis();
    markRejected(analysis, "1.1.540");

    exportBrowserProjectPdf({
      projectName: "Projekt Überprüfung",
      analysis,
      selections: selectionsFor(analysis, 51)
    });

    const pdf = await readPdf(takeDownloadedBlob());
    expect(pdf.pageCount).toBeGreaterThan(1);
    expect(pdf.text).toContain("1.1.10");
    expect(pdf.text).toContain("1.1.550");
    expect(pdf.text.match(/\b1\.1\.\d+\b/g)).toHaveLength(55);
    expect(pdf.text).toContain("Überströmventil Größe 51 für Rücklauf München");
    expect(pdf.text).toContain("Prüflieferant München");
    expect(pdf.text).toContain("Ä-51");
    expect(pdf.text).toContain("Status: Zuordnung ungeklärt");
    expect(pdf.text).toContain("Status: Zuordnung abgelehnt");
    expect(pdf.text).toContain("Status: Nicht ausgewählt");
    expect(pdf.text).toContain("Basis-Quelle: basis-doc, Seite 6");
    expect(pdf.text).toContain("Angebotsquelle: supplier-doc, Seite 6");
  });
});
