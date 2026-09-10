import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DocumentQualityPanel } from "@/components/browser-projects/document-quality-panel";
import type { BrowserDocumentQualityReport } from "@/browser-projects/document-quality";

describe("document quality panel", () => {
  it("shows document coverage and never hides review or OCR states", () => {
    const report: BrowserDocumentQualityReport = {
      projectStatus: "REVIEW_REQUIRED",
      documents: [
        {
          documentId: "basis",
          label: "Basis-LV.pdf",
          status: "SUPPORTED",
          participatesInComparison: true,
          pages: 10,
          candidatePositions: 20,
          extractedPositions: 20,
          verifiedPositions: 20,
          missingEvidence: 0,
          unconfirmedEvidence: 0,
          pagesInspected: 10,
          ocrProcessedPages: 0,
          ocrFailedPages: 0,
          ocrRequiredPages: 0,
          multiPagePositions: 0,
          reasonCodes: []
        },
        {
          documentId: "offer",
          label: "Angebot A.pdf",
          status: "REVIEW_REQUIRED",
          participatesInComparison: true,
          pages: 8,
          candidatePositions: 18,
          extractedPositions: 17,
          verifiedPositions: 16,
          missingEvidence: 1,
          unconfirmedEvidence: 1,
          pagesInspected: 8,
          ocrProcessedPages: 1,
          ocrFailedPages: 0,
          ocrRequiredPages: 0,
          multiPagePositions: 3,
          reasonCodes: ["POSITION_COUNT_MISMATCH", "EVIDENCE_MISSING", "OCR_SOURCE"]
        },
        {
          documentId: "scan",
          label: "Scan.pdf",
          status: "UNSUPPORTED",
          participatesInComparison: true,
          pages: 3,
          candidatePositions: 0,
          extractedPositions: 0,
          verifiedPositions: 0,
          missingEvidence: 0,
          unconfirmedEvidence: 0,
          pagesInspected: 0,
          ocrProcessedPages: 0,
          ocrFailedPages: 0,
          ocrRequiredPages: 3,
          multiPagePositions: 0,
          reasonCodes: ["OCR_REQUIRED"]
        }
      ],
      totals: {
        documents: 3,
        supportedDocuments: 1,
        reviewRequiredDocuments: 1,
        unsupportedDocuments: 1,
        candidatePositions: 38,
        extractedPositions: 37,
        verifiedPositions: 36,
        missingEvidence: 1,
        unconfirmedEvidence: 1
      }
    };

    const markup = renderToStaticMarkup(<DocumentQualityPanel report={report} />);
    expect(markup).toContain("Dokumentenqualität");
    expect(markup).toContain("Prüfung erforderlich");
    expect(markup).toContain("Nicht unterstützt");
    expect(markup).toContain("OCR erforderlich");
    expect(markup).toContain("17 extrahiert");
    expect(markup).toContain("18 im Vollscan erkannt");
    expect(markup).toContain("1 ohne sichere Fundstelle");
    expect(markup).toContain("1 Fundstelle noch unbestätigt");
    expect(markup).toContain("1 unbestätigt");
    expect(markup).toContain("8 von 8 Seiten im Vollscan verarbeitet");
    expect(markup).toContain("0 von 3 Seiten im Vollscan verarbeitet");
    expect(markup).not.toContain("vollständig geprüft");
    expect(markup).toContain("1 OCR-Seite");
    expect(markup).toContain("3 mehrseitige Positionen");
    expect(markup).toContain("OCR-Quelle manuell prüfen");
  });

  it("keeps preliminary and extracted counts separate when the preliminary scan undercounts", () => {
    const report: BrowserDocumentQualityReport = {
      projectStatus: "REVIEW_REQUIRED",
      documents: [
        {
          documentId: "offer",
          label: "Synthetic-Offer.pdf",
          status: "REVIEW_REQUIRED",
          participatesInComparison: true,
          pages: 1,
          candidatePositions: 0,
          extractedPositions: 2,
          verifiedPositions: 2,
          missingEvidence: 0,
          unconfirmedEvidence: 0,
          pagesInspected: 1,
          ocrProcessedPages: 0,
          ocrFailedPages: 0,
          ocrRequiredPages: 0,
          multiPagePositions: 0,
          reasonCodes: ["POSITION_COUNT_MISMATCH"]
        }
      ],
      totals: {
        documents: 1,
        supportedDocuments: 0,
        reviewRequiredDocuments: 1,
        unsupportedDocuments: 0,
        candidatePositions: 0,
        extractedPositions: 2,
        verifiedPositions: 2,
        missingEvidence: 0,
        unconfirmedEvidence: 0
      }
    };

    const markup = renderToStaticMarkup(<DocumentQualityPanel report={report} />);
    expect(markup).toContain("1 Seite");
    expect(markup).not.toContain("1 Seiten");
    expect(markup).toContain("2 extrahiert");
    expect(markup).toContain("0 im Vollscan erkannt");
    expect(markup).not.toContain("2 von 0");
  });

  it("offers manual capture for OCR failures and missed positions without hiding the audit state", () => {
    const report: BrowserDocumentQualityReport = {
      projectStatus: "REVIEW_REQUIRED",
      documents: [
        {
          documentId: "basis",
          label: "Basis.pdf",
          status: "SUPPORTED",
          participatesInComparison: true,
          pages: 1,
          candidatePositions: 1,
          extractedPositions: 1,
          verifiedPositions: 1,
          missingEvidence: 0,
          unconfirmedEvidence: 0,
          pagesInspected: 1,
          ocrProcessedPages: 0,
          ocrFailedPages: 0,
          ocrRequiredPages: 0,
          multiPagePositions: 0,
          reasonCodes: []
        },
        {
          documentId: "scan",
          label: "Scan-Angebot.pdf",
          status: "REVIEW_REQUIRED",
          participatesInComparison: true,
          pages: 2,
          candidatePositions: 3,
          extractedPositions: 2,
          verifiedPositions: 0,
          missingEvidence: 0,
          unconfirmedEvidence: 2,
          pagesInspected: 2,
          ocrProcessedPages: 1,
          ocrFailedPages: 1,
          ocrRequiredPages: 1,
          multiPagePositions: 0,
          reasonCodes: ["OCR_FAILED", "POSITION_COUNT_MISMATCH"]
        }
      ],
      totals: {
        documents: 2,
        supportedDocuments: 1,
        reviewRequiredDocuments: 1,
        unsupportedDocuments: 0,
        candidatePositions: 4,
        extractedPositions: 3,
        verifiedPositions: 1,
        missingEvidence: 0,
        unconfirmedEvidence: 2
      }
    };

    const markup = renderToStaticMarkup(
      <DocumentQualityPanel report={report} onManualAdd={vi.fn()} />
    );

    expect(markup).toContain('data-manual-add-document="scan"');
    expect(markup).toContain("Fehlende Position manuell erfassen");
    expect(markup).not.toContain('data-manual-add-document="basis"');
    expect(markup).toContain("OCR-Verarbeitung fehlgeschlagen");
  });
});
