import { describe, expect, it } from "vitest";
import {
  applyAutomaticBasisSelection,
  buildDocumentClusters,
  classifyBrowserDocumentContent,
  invalidManualBasisWarning,
  isStructurallyPlausibleBasis,
  reconcileDocumentRelations,
  type BrowserPdfInspection
} from "@/browser-projects/document-classification";
import type {
  BrowserDocumentRecord,
  BrowserDocumentType
} from "@/browser-projects/types";

function inspection(
  text: string,
  pageCount = 10,
  pagesWithText = 3
): BrowserPdfInspection {
  return {
    pageCount,
    metadata: {},
    text,
    textLayerCharacterCount: text.replace(/\s+/g, "").length,
    inspectedPageCount: 3,
    pagesWithText
  };
}

const basisPrefix =
  "Angebotsaufforderung LV-Daten LV-Bezeichnung LV-Nummer Inhaltsverzeichnis";
const positionStructure =
  "1.1.10. Wärmepumpe Menge 6 St 1.1.20. Zubehör Menge 1 St";

const corpus = [
  {
    name: "HE LV Heizung D8 250813.pdf",
    pages: 92,
    text: `${basisPrefix} 24-07 H Projektbezeichnung: Layher D8 Projektnummer: 24-07 Heizungsinstallation ${positionStructure}`,
    role: "BASIS_LV",
    discipline: "HEIZUNG",
    offerNumber: null,
    version: null
  },
  {
    name: "HE LV Sanitär 250918.pdf",
    pages: 209,
    text: `${basisPrefix} 24-07 S Projektbezeichnung: Layher D8 Projektnummer: 24-07 Sanitärinstallation Trinkwasserinstallation ${positionStructure}`,
    role: "BASIS_LV",
    discipline: "SANITAER",
    offerNumber: null,
    version: null
  },
  {
    name: "Gienger.PDF",
    pages: 65,
    text: "Gienger Angebot Nr. 15889095-001 E-Preis Gesamtpreis LV.Pos. Sanitärinstallation Trinkwasserinstallation",
    role: "SUPPLIER_OFFER",
    discipline: "SANITAER",
    offerNumber: "15889095-001",
    version: null
  },
  {
    name: "Gienger[1].PDF",
    pages: 32,
    text: "Gienger Angebot Nr. 15875507-001 Einzelpreis Gesamtpreis LV.Pos. Heizungsinstallation Wärmepumpe",
    role: "SUPPLIER_OFFER",
    discipline: "HEIZUNG",
    offerNumber: "15875507-001",
    version: null
  },
  {
    name: "Reisser.PDF",
    pages: 48,
    text: "REISSER Referenzangebot Angebotsnummer 2000424473 E-Preis Gesamtpreis LVNR Sanitärinstallation",
    role: "SUPPLIER_OFFER",
    discipline: "SANITAER",
    offerNumber: "2000424473",
    version: null
  },
  {
    name: "Reisser[1].PDF",
    pages: 23,
    text: "REISSER Referenzangebot Angebotsnummer 2000420257 E-Preis Gesamtpreis LVNR Heizungsinstallation",
    role: "SUPPLIER_OFFER",
    discipline: "HEIZUNG",
    offerNumber: "2000420257",
    version: null
  },
  {
    name: "PuM_10_591528-1_2_1.pdf",
    pages: 25,
    text: "Pfeiffer & May Angebot 591528-1 Version 2 E-Preis Gesamtpreis LV.Pos. Heizungsinstallation",
    role: "SUPPLIER_OFFER",
    discipline: "HEIZUNG",
    offerNumber: "591528-1",
    version: "2"
  },
  {
    name: "PuM_10_591528-2_2_1.pdf",
    pages: 56,
    text: "Pfeiffer & May Angebot 591528-2 Version 2 E-Preis Gesamtpreis LV.Pos. Sanitärinstallation",
    role: "SUPPLIER_OFFER",
    discipline: "SANITAER",
    offerNumber: "591528-2",
    version: "2"
  },
  {
    name: "Weishaupt.PDF",
    pages: 43,
    text: "Weishaupt Angebot Nr. 22505626 E-Preis Gesamtpreis LV.Pos. Heizungsinstallation Wärmepumpe",
    role: "SUPPLIER_OFFER",
    discipline: "HEIZUNG",
    offerNumber: "22505626",
    version: null
  },
  {
    name: "44281 GIS.pdf",
    pages: 166,
    text: "Geberit ProPlanner Kalkulation (Gesamt) GIS Tragsystem Installationssysteme Materialpreis",
    role: "TECHNICAL_CALCULATION",
    discipline: "INSTALLATIONSSYSTEME",
    offerNumber: null,
    version: null
  },
  {
    name: "Hawa.pdf",
    pages: 18,
    text: "",
    role: "SCAN_OCR_REQUIRED",
    discipline: "UNKNOWN",
    offerNumber: null,
    version: null
  },
  {
    name: "Hawa[1].pdf",
    pages: 12,
    text: "",
    role: "SCAN_OCR_REQUIRED",
    discipline: "UNKNOWN",
    offerNumber: null,
    version: null
  }
] as const;

function record(
  index: number,
  input: (typeof corpus)[number]
): BrowserDocumentRecord {
  const classified = classifyBrowserDocumentContent({
    fileName: input.name,
    inspection: inspection(
      input.text,
      input.pages,
      input.text ? 3 : 0
    )
  });
  return {
    projectId: "project",
    documentId: `document-${index}`,
    originalFileName: input.name,
    mimeType: "application/pdf",
    size: 100,
    sha256: `sha-${index}`,
    uploadedAt: new Date(2026, 0, index + 1).toISOString(),
    pageCount: input.pages,
    detectedDocumentType: classified.detectedDocumentType,
    documentType: classified.documentType,
    discipline: classified.discipline,
    supplierName: classified.supplierName,
    offerNumber: classified.offerNumber,
    documentVersion: classified.documentVersion,
    revision: classified.revision,
    revisionOfDocumentId: classified.revisionOfDocumentId,
    relationType: classified.relationType,
    scanState: classified.scanState,
    projectName: classified.projectName,
    projectNumber: classified.projectNumber,
    lvNumber: classified.lvNumber,
    classificationDimensions: classified.dimensions,
    classificationSignals: classified.signals,
    textLayerCharacterCount: input.text.length,
    preliminaryPositionCount: classified.preliminaryPositionCount,
    activeBasis: false,
    excludedFromProcessing: classified.scanState === "OCR_REQUIRED",
    manualRoleOverride: false,
    manualBasisOverrideConfirmed: false,
    classificationConfidence: classified.confidence,
    classificationWarnings: classified.warnings,
    processingStatus:
      classified.scanState === "OCR_REQUIRED"
        ? "PRÜFUNG_ERFORDERLICH"
        : "BEREIT"
  };
}

describe("content-first browser document classification", () => {
  it.each(corpus)(
    "classifies $name from corpus-derived content",
    (fixture) => {
      const result = classifyBrowserDocumentContent({
        fileName: fixture.name,
        inspection: inspection(
          fixture.text,
          fixture.pages,
          fixture.text ? 3 : 0
        )
      });
      expect(result.documentType).toBe(fixture.role);
      expect(result.discipline).toBe(fixture.discipline);
      expect(result.offerNumber).toBe(fixture.offerNumber);
      expect(result.documentVersion).toBe(fixture.version);
    }
  );

  it("does not confuse P&M Version 2 or offer suffixes with revisions", () => {
    const documents = reconcileDocumentRelations(
      corpus.slice(6, 8).map((fixture, index) => record(index, fixture))
    );
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offerNumber: "591528-1",
          documentVersion: "2",
          revision: null,
          revisionOfDocumentId: null,
          relationType: "SEPARATE_OFFER"
        }),
        expect.objectContaining({
          offerNumber: "591528-2",
          documentVersion: "2",
          revision: null,
          revisionOfDocumentId: null,
          relationType: "SEPARATE_OFFER"
        })
      ])
    );
  });

  it("selects one Basis per discipline and keeps supplier offers out", () => {
    const selected = applyAutomaticBasisSelection(
      corpus.map((fixture, index) => record(index, fixture))
    );
    expect(
      selected.filter((document) => document.activeBasis).map((document) => [
        document.documentType,
        document.discipline
      ])
    ).toEqual([
      ["BASIS_LV", "HEIZUNG"],
      ["BASIS_LV", "SANITAER"]
    ]);
    expect(
      selected
        .filter((document) => document.supplierName === "P&M")
        .every((document) => !document.activeBasis)
    ).toBe(true);
  });

  it("clusters heating and sanitary sets without mixing offers", () => {
    const classifiedDocuments = applyAutomaticBasisSelection(
      corpus.map((fixture, index) => record(index, fixture))
    );
    const documents = classifiedDocuments.map((document) =>
      document.documentId === "document-2" ||
      document.documentId === "document-3"
        ? {
            ...document,
            projectName: "28465 Layher D8 Grabenstraße Markgröningen",
            projectNumber: "28465"
          }
        : document.documentId === "document-9"
          ? {
              ...document,
              projectNumber: "A2510470"
            }
          : document
    );
    const clusters = buildDocumentClusters(documents);
    expect(
      clusters.filter((cluster) => cluster.discipline === "HEIZUNG")
    ).toHaveLength(1);
    expect(
      clusters.filter((cluster) => cluster.discipline === "SANITAER")
    ).toHaveLength(1);
    const heating = clusters.find((cluster) => cluster.discipline === "HEIZUNG");
    const sanitary = clusters.find(
      (cluster) => cluster.discipline === "SANITAER"
    );
    expect(heating?.basisDocumentIds).toEqual(["document-0"]);
    expect(heating?.supplierDocumentIds).toHaveLength(4);
    expect(sanitary?.basisDocumentIds).toEqual(["document-1"]);
    expect(sanitary?.supplierDocumentIds).toHaveLength(3);
    expect(sanitary?.auxiliaryDocumentIds).toContain("document-9");
  });

  it("warns about an implausible manual supplier-as-Basis assignment", () => {
    const supplier = record(6, corpus[6]);
    const assigned = {
      ...supplier,
      documentType: "BASIS_LV" as BrowserDocumentType,
      manualRoleOverride: true
    };
    expect(invalidManualBasisWarning(assigned)).toContain("P&M");
    expect(isStructurallyPlausibleBasis(assigned)).toBe(false);
  });

  it("recognizes an explicit no-bid only from explicit source language", () => {
    const result = classifyBrowserDocumentContent({
      fileName: "Absage.pdf",
      inspection: inspection(
        "Gienger Angebotsnummer 15889095-001 Wir sehen von einem Angebot ab."
      )
    });
    expect(result.documentType).toBe("EXPLICIT_NO_BID");
  });
});
