import { describe, expect, it } from "vitest";
import {
  buildDocumentQualityReport,
  type QualityDocument,
  type QualityLine
} from "@/browser-projects/document-quality";

function document(
  input: Partial<QualityDocument> & Pick<QualityDocument, "documentId">
): QualityDocument {
  return {
    documentId: input.documentId,
    label: input.label ?? `${input.documentId}.pdf`,
    documentType: input.documentType ?? "SUPPLIER_OFFER",
    pageCount: input.pageCount ?? 2,
    scanState: input.scanState ?? "TEXT_AVAILABLE",
    classificationConfidence: input.classificationConfidence ?? "HIGH",
    preliminaryPositionCount: input.preliminaryPositionCount ?? 2,
    activeBasis: input.activeBasis ?? false,
    excludedFromProcessing: input.excludedFromProcessing ?? false,
    inComparisonScope: input.inComparisonScope,
    fullDocumentDiagnostics: input.fullDocumentDiagnostics
  };
}

function line(documentId: string, positionNumber: string, verified = true): QualityLine {
  return {
    documentId,
    positionNumber,
    evidenceStatus: verified ? "VERIFIED_NATIVE" : "MISSING"
  };
}

function unconfirmedLine(documentId: string, positionNumber: string): QualityLine {
  return {
    documentId,
    positionNumber,
    evidenceStatus: "VISUAL_ONLY_UNCONFIRMED"
  };
}

describe("browser document quality report", () => {
  it("marks a complete native-text document as supported", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          preliminaryPositionCount: 2
        })
      ],
      lines: [line("basis", "1.1.10"), line("basis", "1.1.20")]
    });

    expect(report.documents[0]).toMatchObject({
      status: "SUPPORTED",
      candidatePositions: 2,
      extractedPositions: 2,
      verifiedPositions: 2,
      missingEvidence: 0,
      reasonCodes: []
    });
    expect(report.projectStatus).toBe("READY");
  });

  it("does not hide a missing position behind an overall success state", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          preliminaryPositionCount: 3
        })
      ],
      lines: [line("basis", "1.1.10"), line("basis", "1.1.20")]
    });

    expect(report.documents[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      candidatePositions: 3,
      extractedPositions: 2,
      reasonCodes: ["POSITION_COUNT_MISMATCH"]
    });
    expect(report.projectStatus).toBe("REVIEW_REQUIRED");
    expect(report.totals.reviewRequiredDocuments).toBe(1);
  });

  it("uses full-run diagnostics and keeps OCR or missing geometry under review", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          preliminaryPositionCount: 1,
          fullDocumentDiagnostics: {
            documentId: "basis",
            pagesInspected: 12,
            candidatePositions: 4,
            extractedPositions: 4,
            missingSourceRegions: 1,
            ocrProcessedPages: 1,
            ocrFailedPages: 0,
            ocrRequiredPages: 0,
            multiPagePositions: 2
          }
        })
      ],
      lines: [
        line("basis", "1.1.10"),
        line("basis", "1.1.20"),
        line("basis", "1.1.30"),
        line("basis", "1.1.40")
      ]
    });

    expect(report.documents[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      pagesInspected: 12,
      candidatePositions: 4,
      extractedPositions: 4,
      missingEvidence: 1,
      ocrProcessedPages: 1,
      multiPagePositions: 2,
      reasonCodes: expect.arrayContaining(["OCR_SOURCE", "EVIDENCE_MISSING"])
    });
    expect(report.projectStatus).toBe("REVIEW_REQUIRED");
  });

  it("never reports OCR failure or pending OCR as supported", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          fullDocumentDiagnostics: {
            documentId: "basis",
            pagesInspected: 3,
            candidatePositions: 1,
            extractedPositions: 1,
            missingSourceRegions: 0,
            ocrProcessedPages: 0,
            ocrFailedPages: 1,
            ocrRequiredPages: 1,
            multiPagePositions: 0
          }
        })
      ],
      lines: [line("basis", "1.1.10")]
    });

    expect(report.documents[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasonCodes: expect.arrayContaining(["OCR_FAILED", "OCR_REQUIRED"])
    });
  });

  it("distinguishes a present OCR frame from missing evidence and still requires review", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          scanState: "OCR_AVAILABLE",
          classificationConfidence: "MEDIUM",
          fullDocumentDiagnostics: {
            documentId: "basis",
            pagesInspected: 2,
            candidatePositions: 1,
            extractedPositions: 1,
            missingSourceRegions: 0,
            ocrProcessedPages: 2,
            ocrFailedPages: 0,
            ocrRequiredPages: 0,
            multiPagePositions: 1
          }
        })
      ],
      lines: [unconfirmedLine("basis", "1.1.10")]
    });

    expect(report.documents[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      missingEvidence: 0,
      unconfirmedEvidence: 1,
      reasonCodes: expect.arrayContaining([
        "OCR_SOURCE",
        "MULTI_PAGE_POSITION",
        "EVIDENCE_UNCONFIRMED"
      ])
    });
    expect(report.documents[0].reasonCodes).not.toContain("EVIDENCE_MISSING");
  });

  it("accepts successful full-run OCR for an OCR-required document but keeps it under review", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          scanState: "OCR_REQUIRED",
          classificationConfidence: "MEDIUM",
          fullDocumentDiagnostics: {
            documentId: "basis",
            pagesInspected: 2,
            candidatePositions: 1,
            extractedPositions: 1,
            missingSourceRegions: 0,
            ocrProcessedPages: 2,
            ocrFailedPages: 0,
            ocrRequiredPages: 0,
            multiPagePositions: 0
          }
        })
      ],
      lines: [unconfirmedLine("basis", "1.1.10")]
    });

    expect(report.documents[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      extractedPositions: 1,
      missingEvidence: 0,
      unconfirmedEvidence: 1,
      reasonCodes: expect.arrayContaining(["OCR_SOURCE", "EVIDENCE_UNCONFIRMED"])
    });
    expect(report.documents[0].reasonCodes).not.toContain("EVIDENCE_MISSING");
    expect(report.projectStatus).toBe("REVIEW_REQUIRED");
  });

  it("counts a manually captured OCR-missed position and unblocks review of the active Basis", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          scanState: "OCR_REQUIRED",
          classificationConfidence: "MEDIUM",
          fullDocumentDiagnostics: {
            documentId: "basis",
            pagesInspected: 1,
            candidatePositions: 0,
            extractedPositions: 0,
            missingSourceRegions: 0,
            ocrProcessedPages: 0,
            ocrFailedPages: 1,
            ocrRequiredPages: 1,
            multiPagePositions: 0
          }
        })
      ],
      lines: [
        {
          documentId: "basis",
          positionNumber: "1.1.10",
          evidenceStatus: "MISSING"
        }
      ]
    });

    expect(report.documents[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      extractedPositions: 1,
      reasonCodes: expect.arrayContaining([
        "OCR_FAILED",
        "OCR_REQUIRED",
        "EVIDENCE_MISSING"
      ])
    });
    expect(report.projectStatus).toBe("REVIEW_REQUIRED");
  });

  it("treats the sampled preliminary inventory as a lower bound, not a full-document denominator", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          preliminaryPositionCount: 1
        })
      ],
      lines: [line("basis", "1.1.10"), line("basis", "1.1.20"), line("basis", "1.1.30")]
    });

    expect(report.documents[0]).toMatchObject({
      status: "SUPPORTED",
      candidatePositions: 1,
      extractedPositions: 3,
      reasonCodes: []
    });
    expect(report.projectStatus).toBe("READY");
  });

  it("blocks a project when its active Basis has no extracted positions", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          preliminaryPositionCount: 4,
          activeBasis: true
        })
      ],
      lines: []
    });

    expect(report.documents[0].reasonCodes).toEqual(
      expect.arrayContaining(["NO_POSITIONS_EXTRACTED", "POSITION_COUNT_MISMATCH"])
    );
    expect(report.projectStatus).toBe("BLOCKED");
  });

  it("isolates an image-only scan as OCR required", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "scan",
          scanState: "OCR_REQUIRED",
          excludedFromProcessing: true,
          preliminaryPositionCount: 0
        })
      ],
      lines: []
    });

    expect(report.documents[0]).toMatchObject({
      status: "UNSUPPORTED",
      reasonCodes: ["OCR_REQUIRED"]
    });
    expect(report.totals.unsupportedDocuments).toBe(1);
  });

  it("requires review when any extracted position lacks source geometry", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          preliminaryPositionCount: 2
        })
      ],
      lines: [line("basis", "1.1.10"), line("basis", "1.1.20", false)]
    });

    expect(report.documents[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      missingEvidence: 1,
      reasonCodes: ["EVIDENCE_MISSING"]
    });
  });

  it("keeps recognised non-comparison documents visible without blocking readiness", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          preliminaryPositionCount: 1
        }),
        document({
          documentId: "history",
          documentType: "TECHNICAL_CALCULATION",
          excludedFromProcessing: true,
          preliminaryPositionCount: 0
        })
      ],
      lines: [line("basis", "1.1.10")]
    });

    expect(report.documents.find((item) => item.documentId === "history")).toMatchObject({
      status: "SUPPORTED",
      participatesInComparison: false,
      reasonCodes: ["NOT_IN_COMPARISON_SCOPE"]
    });
    expect(report.projectStatus).toBe("READY");
  });

  it("does not report another discipline's LV documents as failed extraction", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis-active",
          documentType: "BASIS_LV",
          activeBasis: true,
          inComparisonScope: true,
          preliminaryPositionCount: 1
        }),
        document({
          documentId: "supplier-other-discipline",
          documentType: "SUPPLIER_OFFER",
          inComparisonScope: false,
          preliminaryPositionCount: 12
        })
      ],
      lines: [line("basis-active", "1.1.10")]
    });

    expect(
      report.documents.find((item) => item.documentId === "supplier-other-discipline")
    ).toMatchObject({
      status: "SUPPORTED",
      participatesInComparison: false,
      extractedPositions: 0,
      reasonCodes: ["NOT_IN_COMPARISON_SCOPE"]
    });
    expect(report.projectStatus).toBe("READY");
  });

  it("evaluates the active Basis from the selected comparison discipline", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis-other-discipline",
          documentType: "BASIS_LV",
          activeBasis: true,
          inComparisonScope: false,
          preliminaryPositionCount: 20
        }),
        document({
          documentId: "basis-active",
          documentType: "BASIS_LV",
          activeBasis: true,
          inComparisonScope: true,
          preliminaryPositionCount: 2
        })
      ],
      lines: [line("basis-active", "1.1.10"), line("basis-active", "1.1.20")]
    });

    expect(report.projectStatus).toBe("READY");
    expect(
      report.documents.find((item) => item.documentId === "basis-other-discipline")
    ).toMatchObject({
      participatesInComparison: false,
      reasonCodes: ["NOT_IN_COMPARISON_SCOPE"]
    });
  });

  it("routes an unclassified PDF to review instead of hiding it outside comparison scope", () => {
    const report = buildDocumentQualityReport({
      documents: [
        document({
          documentId: "basis",
          documentType: "BASIS_LV",
          activeBasis: true,
          preliminaryPositionCount: 1
        }),
        document({
          documentId: "unknown",
          documentType: "UNKNOWN",
          classificationConfidence: "LOW",
          preliminaryPositionCount: 0
        })
      ],
      lines: [line("basis", "1.1.10")]
    });

    expect(report.documents.find((item) => item.documentId === "unknown")).toMatchObject({
      status: "REVIEW_REQUIRED",
      participatesInComparison: false,
      reasonCodes: ["CLASSIFICATION_REVIEW_REQUIRED"]
    });
    expect(report.projectStatus).toBe("REVIEW_REQUIRED");
  });
});
