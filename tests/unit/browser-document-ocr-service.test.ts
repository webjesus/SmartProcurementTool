import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserProjectDatabase } from "@/browser-projects/indexeddb";
import { createBrowserProjectRepositories } from "@/browser-projects/repository-factory";

const pdfInspection = vi.hoisted(() => vi.fn());

vi.mock("@/browser-projects/pdf-inspection", () => ({
  inspectBrowserPdf: pdfInspection
}));

import { BrowserProjectService } from "@/browser-projects/project-service";
import { classifyBrowserDocumentContent } from "@/browser-projects/document-classification";

const databases: BrowserProjectDatabase[] = [];

function service() {
  const database = new BrowserProjectDatabase(
    new IDBFactory(),
    `spt-ocr-service-${crypto.randomUUID()}`
  );
  databases.push(database);
  return new BrowserProjectService(createBrowserProjectRepositories(database));
}

function minimalPdf(name = "scan.pdf"): File {
  return new File([`%PDF-1.4\n% ${name}\n%%EOF`], name, {
    type: "application/pdf"
  });
}

afterEach(() => {
  pdfInspection.mockReset();
  databases.splice(0).forEach((database) => database.close());
});

describe("browser-local document OCR service", () => {
  it("persists the full-run OCR role before subsequent comparison and reload", async () => {
    const emptyInspection = {
      pageCount: 2,
      metadata: {},
      text: "",
      textLayerCharacterCount: 0,
      inspectedPageCount: 2,
      pagesWithText: 0
    };
    pdfInspection.mockResolvedValueOnce(emptyInspection);
    const browserService = service();
    const project = await browserService.createProject("Später lesbarer Scan");
    const upload = await browserService.addFiles(project.projectId, [minimalPdf()]);
    const classification = classifyBrowserDocumentContent({
      fileName: "scan.pdf",
      inspection: {
        ...emptyInspection,
        ocrText:
          "Hawa Angebot Nr. 123456789 Einzelpreis Gesamtpreis Heizungsinstallation zu LV-Pos.: 1.1.10 Pumpe 6 St",
        ocrPageCount: 2
      }
    });
    const updated = await browserService.applyDocumentClassifications(project.projectId, [
      { documentId: upload.documents[0].documentId, classification }
    ]);
    expect(updated[0]).toMatchObject({
      documentType: "SUPPLIER_OFFER",
      scanState: "OCR_AVAILABLE",
      processingStatus: "PRÜFUNG_ERFORDERLICH"
    });
    expect((await browserService.listDocuments(project.projectId))[0].documentType).toBe(
      "SUPPLIER_OFFER"
    );
    await browserService.updateDocument(project.projectId, updated[0].documentId, {
      documentType: "TECHNICAL_DOCUMENT",
      manualRoleOverride: true
    });
    const preserved = await browserService.applyDocumentClassifications(project.projectId, [
      { documentId: updated[0].documentId, classification }
    ]);
    expect(preserved[0].documentType).toBe("TECHNICAL_DOCUMENT");
  });
  it("automatically OCR-samples and classifies a sparse upload without a second service action", async () => {
    pdfInspection.mockResolvedValueOnce({
      pageCount: 2,
      metadata: {},
      text: "",
      textLayerCharacterCount: 0,
      inspectedPageCount: 2,
      pagesWithText: 0,
      ocrText:
        "Weishaupt Angebot Nr. 22505626 E-Preis Gesamtpreis LV.Pos. Heizungsinstallation Wärmepumpe Angebotsposition 40",
      ocrPageCount: 2,
      ocrMeanConfidence: 93
    });
    const browserService = service();
    const project = await browserService.createProject("OCR-Projekt");
    const upload = await browserService.addFiles(project.projectId, [minimalPdf()]);
    expect(pdfInspection).toHaveBeenCalledTimes(1);
    expect(pdfInspection).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ enableOcr: true, maxOcrPages: 3 })
    );
    expect(upload.items[0]?.document).toMatchObject({
      detectedDocumentType: "SUPPLIER_OFFER",
      documentType: "SUPPLIER_OFFER",
      discipline: "HEIZUNG",
      supplierName: "Weishaupt",
      scanState: "OCR_AVAILABLE",
      processingStatus: "PRÜFUNG_ERFORDERLICH",
      excludedFromProcessing: false,
      ocrSampledPages: 2,
      ocrMeanConfidence: 93,
      ocrEngineVersion: "7.0.0",
      ocrModelVersion: "deu-fast-v1"
    });
    expect(upload.items[0]?.document?.classificationWarnings.join(" ")).toContain(
      "Fundstellen müssen geprüft werden"
    );
  });

  it("keeps a failed scan in review without blocking another valid Basis document", async () => {
    pdfInspection
      .mockResolvedValueOnce({
        pageCount: 1,
        metadata: {},
        text: "Angebotsaufforderung LV-Daten LV-Bezeichnung Heizungsinstallation Position 1.1.10 Pumpe 1 St",
        textLayerCharacterCount: 90,
        inspectedPageCount: 1,
        pagesWithText: 1
      })
      .mockResolvedValueOnce({
        pageCount: 1,
        metadata: {},
        text: "",
        textLayerCharacterCount: 0,
        inspectedPageCount: 1,
        pagesWithText: 0,
        ocrText: "",
        ocrPageCount: 0,
        ocrMeanConfidence: null
      });
    const browserService = service();
    const project = await browserService.createProject("Gemischtes Projekt");
    const upload = await browserService.addFiles(project.projectId, [
      minimalPdf("basis-lv.pdf"),
      minimalPdf("unlesbarer-scan.pdf")
    ]);

    expect(upload.documents).toHaveLength(2);
    expect(
      upload.documents.find((item) => item.documentType === "SCAN_OCR_REQUIRED")
    ).toBeDefined();
    const preflight = await browserService.processingPreflight(project.projectId, "HEIZUNG");
    expect(preflight.valid).toBe(true);
    expect(preflight.blockingReasons).toEqual([]);
    expect(preflight.warnings.join(" ")).toContain(
      "OCR wird im Verarbeitungslauf automatisch ausgeführt"
    );
    expect(preflight.warnings.join(" ")).not.toContain("ausgeschlossen");
  });

  it("lets an OCR-readable but unclassified attachment reach full processing beside a valid Basis", async () => {
    pdfInspection
      .mockResolvedValueOnce({
        pageCount: 1,
        metadata: {},
        text: "Angebotsaufforderung LV-Daten LV-Bezeichnung Heizungsinstallation Position 1.1.10 Pumpe 1 St",
        textLayerCharacterCount: 100,
        inspectedPageCount: 1,
        pagesWithText: 1
      })
      .mockResolvedValueOnce({
        pageCount: 8,
        metadata: {},
        text: "",
        textLayerCharacterCount: 0,
        inspectedPageCount: 3,
        pagesWithText: 0,
        ocrText: "Unvollständig lesbarer Briefkopf mit allgemeinen Kontaktinformationen",
        ocrPageCount: 3,
        ocrMeanConfidence: 86
      });
    const browserService = service();
    const project = await browserService.createProject("Vollprüfung nach OCR-Vorschau");
    const upload = await browserService.addFiles(project.projectId, [
      minimalPdf("basis.pdf"),
      minimalPdf("scan.pdf")
    ]);
    expect(
      upload.documents.find((document) => document.originalFileName === "scan.pdf")?.documentType
    ).toBe("UNKNOWN");
    const preflight = await browserService.processingPreflight(project.projectId, "HEIZUNG");
    expect(preflight.valid).toBe(true);
    expect(preflight.warnings.join(" ")).toContain("Vollprüfung");
  });
});
