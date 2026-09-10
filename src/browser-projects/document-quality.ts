import type {
  BrowserDocumentType,
  BrowserScanState,
  ClassificationConfidence
} from "@/browser-projects/types";
import type { EvidenceReference } from "@/domain/contracts";
import type { BrowserDocumentDiagnostics } from "@/browser-projects/processing-protocol";

export type DocumentQualityStatus = "SUPPORTED" | "REVIEW_REQUIRED" | "UNSUPPORTED";

export type DocumentQualityReason =
  | "OCR_REQUIRED"
  | "PARTIAL_TEXT_LAYER"
  | "CLASSIFICATION_REVIEW_REQUIRED"
  | "EXCLUDED_FROM_PROCESSING"
  | "NO_POSITIONS_EXTRACTED"
  | "POSITION_COUNT_MISMATCH"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_UNCONFIRMED"
  | "MULTI_PAGE_POSITION"
  | "OCR_SOURCE"
  | "OCR_FAILED"
  | "FULL_DOCUMENT_SCAN_INCOMPLETE"
  | "NOT_IN_COMPARISON_SCOPE";

export type QualityDocument = {
  documentId: string;
  label: string;
  documentType: BrowserDocumentType;
  pageCount: number;
  scanState: BrowserScanState;
  classificationConfidence: ClassificationConfidence;
  preliminaryPositionCount: number;
  activeBasis: boolean;
  excludedFromProcessing: boolean;
  inComparisonScope?: boolean;
  fullDocumentDiagnostics?: BrowserDocumentDiagnostics;
};

export type QualityLine = {
  documentId: string;
  positionNumber: string;
  evidenceStatus: EvidenceReference["status"];
};

export type DocumentQualityEntry = {
  documentId: string;
  label: string;
  status: DocumentQualityStatus;
  participatesInComparison: boolean;
  pages: number;
  candidatePositions: number;
  extractedPositions: number;
  verifiedPositions: number;
  missingEvidence: number;
  unconfirmedEvidence: number;
  pagesInspected: number;
  ocrProcessedPages: number;
  ocrFailedPages: number;
  ocrRequiredPages: number;
  multiPagePositions: number;
  reasonCodes: DocumentQualityReason[];
};

export type BrowserDocumentQualityReport = {
  projectStatus: "READY" | "REVIEW_REQUIRED" | "BLOCKED";
  documents: DocumentQualityEntry[];
  totals: {
    documents: number;
    supportedDocuments: number;
    reviewRequiredDocuments: number;
    unsupportedDocuments: number;
    candidatePositions: number;
    extractedPositions: number;
    verifiedPositions: number;
    missingEvidence: number;
    unconfirmedEvidence: number;
  };
};

const COMPARISON_TYPES = new Set<BrowserDocumentType>([
  "BASIS_LV",
  "SUPPLIER_OFFER",
  "MANUFACTURER_OFFER"
]);

function entryFor(document: QualityDocument, lines: readonly QualityLine[]): DocumentQualityEntry {
  const participatesInComparison =
    COMPARISON_TYPES.has(document.documentType) && (document.inComparisonScope ?? true);
  const documentLines = lines.filter((line) => line.documentId === document.documentId);
  const verifiedPositions = documentLines.filter((line) =>
    ["VERIFIED_NATIVE", "VERIFIED_VISUAL"].includes(line.evidenceStatus)
  ).length;
  const unconfirmedEvidence = documentLines.filter((line) =>
    ["VISUAL_ONLY_UNCONFIRMED", "CONFLICTING"].includes(line.evidenceStatus)
  ).length;
  const diagnostic = document.fullDocumentDiagnostics;
  // Manual OCR fallbacks live in the effective analysis, while the immutable
  // worker diagnostic intentionally keeps the machine-only count.
  const extractedPositions = Math.max(
    diagnostic?.extractedPositions ?? 0,
    documentLines.length
  );
  const hasSuccessfulFullRunOcr = Boolean(
    diagnostic && diagnostic.ocrProcessedPages > 0 && diagnostic.extractedPositions > 0
  );
  const missingEvidence = Math.max(
    diagnostic?.missingSourceRegions ?? 0,
    documentLines.filter((line) => line.evidenceStatus === "MISSING").length
  );
  const common = {
    documentId: document.documentId,
    label: document.label,
    participatesInComparison,
    pages: document.pageCount,
    candidatePositions: diagnostic?.candidatePositions ?? document.preliminaryPositionCount,
    extractedPositions,
    verifiedPositions,
    missingEvidence,
    unconfirmedEvidence,
    pagesInspected: diagnostic?.pagesInspected ?? 0,
    ocrProcessedPages: diagnostic?.ocrProcessedPages ?? 0,
    ocrFailedPages: diagnostic?.ocrFailedPages ?? 0,
    ocrRequiredPages: diagnostic?.ocrRequiredPages ?? 0,
    multiPagePositions: diagnostic?.multiPagePositions ?? 0
  };

  if (
    document.scanState === "OCR_REQUIRED" &&
    !hasSuccessfulFullRunOcr &&
    extractedPositions === 0
  ) {
    return {
      ...common,
      status: "UNSUPPORTED",
      reasonCodes: ["OCR_REQUIRED"]
    };
  }

  const classificationNeedsReview =
    document.classificationConfidence !== "HIGH" || document.documentType === "UNKNOWN";

  if (!participatesInComparison && classificationNeedsReview) {
    return {
      ...common,
      status: "REVIEW_REQUIRED",
      reasonCodes: ["CLASSIFICATION_REVIEW_REQUIRED"]
    };
  }

  if (!participatesInComparison) {
    return {
      ...common,
      status: "SUPPORTED",
      reasonCodes: ["NOT_IN_COMPARISON_SCOPE"]
    };
  }

  const reasonCodes: DocumentQualityReason[] = [];
  if (document.scanState === "PARTIAL_TEXT") {
    reasonCodes.push("PARTIAL_TEXT_LAYER");
  }
  if (classificationNeedsReview) {
    reasonCodes.push("CLASSIFICATION_REVIEW_REQUIRED");
  }
  if (document.excludedFromProcessing) {
    reasonCodes.push("EXCLUDED_FROM_PROCESSING");
  }
  if (diagnostic && diagnostic.pagesInspected !== document.pageCount) {
    reasonCodes.push("FULL_DOCUMENT_SCAN_INCOMPLETE");
  }
  if (extractedPositions === 0) {
    reasonCodes.push("NO_POSITIONS_EXTRACTED");
  }
  if (extractedPositions < common.candidatePositions) {
    reasonCodes.push("POSITION_COUNT_MISMATCH");
  }
  if ((diagnostic?.ocrProcessedPages ?? 0) > 0) {
    reasonCodes.push("OCR_SOURCE");
  }
  if ((diagnostic?.multiPagePositions ?? 0) > 0) {
    reasonCodes.push("MULTI_PAGE_POSITION");
  }
  if ((diagnostic?.ocrFailedPages ?? 0) > 0) {
    reasonCodes.push("OCR_FAILED");
  }
  if ((diagnostic?.ocrRequiredPages ?? 0) > 0) {
    reasonCodes.push("OCR_REQUIRED");
  }
  if (missingEvidence > 0) {
    reasonCodes.push("EVIDENCE_MISSING");
  }
  if (unconfirmedEvidence > 0) {
    reasonCodes.push("EVIDENCE_UNCONFIRMED");
  }
  return {
    ...common,
    status: reasonCodes.length ? "REVIEW_REQUIRED" : "SUPPORTED",
    reasonCodes
  };
}

export function buildDocumentQualityReport(input: {
  documents: readonly QualityDocument[];
  lines: readonly QualityLine[];
}): BrowserDocumentQualityReport {
  const documents = input.documents.map((document) => entryFor(document, input.lines));
  const activeBasis = input.documents.find(
    (document) => document.activeBasis && (document.inComparisonScope ?? true)
  );
  const activeBasisQuality = activeBasis
    ? documents.find((document) => document.documentId === activeBasis.documentId)
    : undefined;
  const projectStatus =
    !activeBasis ||
    !activeBasisQuality ||
    activeBasisQuality.status === "UNSUPPORTED" ||
    activeBasisQuality.extractedPositions === 0
      ? "BLOCKED"
      : documents.some(
            (document) =>
              (document.participatesInComparison && document.status !== "SUPPORTED") ||
              document.reasonCodes.includes("CLASSIFICATION_REVIEW_REQUIRED")
          )
        ? "REVIEW_REQUIRED"
        : "READY";
  const comparisonDocuments = documents.filter((document) => document.participatesInComparison);

  return {
    projectStatus,
    documents,
    totals: {
      documents: documents.length,
      supportedDocuments: documents.filter((document) => document.status === "SUPPORTED").length,
      reviewRequiredDocuments: documents.filter((document) => document.status === "REVIEW_REQUIRED")
        .length,
      unsupportedDocuments: documents.filter((document) => document.status === "UNSUPPORTED")
        .length,
      candidatePositions: comparisonDocuments.reduce(
        (sum, document) => sum + document.candidatePositions,
        0
      ),
      extractedPositions: comparisonDocuments.reduce(
        (sum, document) => sum + document.extractedPositions,
        0
      ),
      verifiedPositions: comparisonDocuments.reduce(
        (sum, document) => sum + document.verifiedPositions,
        0
      ),
      missingEvidence: comparisonDocuments.reduce(
        (sum, document) => sum + document.missingEvidence,
        0
      ),
      unconfirmedEvidence: comparisonDocuments.reduce(
        (sum, document) => sum + document.unconfirmedEvidence,
        0
      )
    }
  };
}
