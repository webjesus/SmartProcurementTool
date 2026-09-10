import type {
  BrowserDocumentRecord,
  BrowserProcessingCheckpoint,
  BrowserProcessingStage
} from "@/browser-projects/types";
import type { BrowserDocumentClassification } from "@/browser-projects/document-classification";

export type BrowserWorkerDocument = {
  metadata: BrowserDocumentRecord;
  bytes: ArrayBuffer;
};

export type BrowserLineReviewReason =
  | "PRIOR_REVIEW_REQUIRED"
  | "BARE_POSITION_SINGLETON"
  | "UNKNOWN_UNIT"
  | "QUANTITY_MISSING"
  | "QUANTITY_AMBIGUOUS"
  | "PRICE_BASIS_UNCLEAR"
  | "MULTI_PAGE_POSITION"
  | "DESCRIPTION_LIMIT_REACHED"
  | "OCR_SOURCE"
  | "SOURCE_REGION_MISSING";

export type BrowserProcessingIssue = {
  code: "PDF_PARSE_FAILED" | "OCR_FAILED";
  status: "REVIEW_REQUIRED";
  documentId: string;
  pageNumber?: number;
  recoverable: true;
  message: string;
};

export type ParsedBasisLine = {
  documentId: string;
  positionNumber: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  rawQuantity?: string | null;
  reviewReasons?: BrowserLineReviewReason[];
  continuationPageNumbers?: number[];
  continuationEvidence?: Array<{
    pageNumber: number;
    sourceText: string;
    region?: { x: number; y: number; width: number; height: number };
  }>;
  pageNumber: number;
  lineIndex: number;
  region?: { x: number; y: number; width: number; height: number };
};

export type ParsedSupplierLine = ParsedBasisLine & {
  priceBasis?: number | null;
  supplier: string;
  supplierPositionNumber?: string | null;
  articleNumber: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
};

export type BrowserDocumentDiagnostics = {
  documentId: string;
  pagesInspected: number;
  candidatePositions: number;
  extractedPositions: number;
  missingSourceRegions: number;
  ocrProcessedPages: number;
  ocrFailedPages: number;
  ocrRequiredPages: number;
  multiPagePositions: number;
};

export type BrowserWorkerResult = {
  documentClassifications?: Array<{ documentId: string; classification: BrowserDocumentClassification }>;
  basisLines: ParsedBasisLine[];
  supplierLines: ParsedSupplierLine[];
  warnings: string[];
  processingIssues?: BrowserProcessingIssue[];
  diagnostics: {
    pagesInspected: number;
    pagesParsed: number;
    ocrRequiredPages: number;
    ocrProcessedPages?: number;
    ocrFailedPages?: number;
    matchingCandidates: number;
    documents: BrowserDocumentDiagnostics[];
  };
};

export type BrowserProcessingCommand =
  | {
      type: "LOAD_DOCUMENTS";
      runId: string;
      documents: BrowserWorkerDocument[];
      incremental?: boolean;
    }
  | { type: "CANCEL" };

export type BrowserProcessingEvent =
  | {
      type: "PROGRESS";
      stage: BrowserProcessingStage;
      completed: number;
      total: number;
    }
  | {
      type: "DOCUMENT_PROGRESS";
      documentId: string;
      fileName: string;
    }
  | {
      type: "PAGE_PROGRESS";
      documentId: string;
      page: number;
      processedPages: number;
      totalPages: number;
    }
  | {
      type: "OCR_PROGRESS";
      documentId: string;
      page: number;
      status: string;
      progress: number;
    }
  | ({ type: "WARNING"; message: string } & Partial<
      Pick<BrowserProcessingIssue, "code" | "status" | "documentId" | "recoverable">
    >)
  | { type: "CHECKPOINT"; checkpoint: BrowserProcessingCheckpoint }
  | { type: "COMPLETE"; result: BrowserWorkerResult }
  | { type: "CANCELLED" }
  | { type: "ERROR"; message: string };
