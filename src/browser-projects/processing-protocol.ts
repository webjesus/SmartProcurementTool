import type {
  BrowserDocumentRecord,
  BrowserProcessingCheckpoint,
  BrowserProcessingStage
} from "@/browser-projects/types";

export type BrowserWorkerDocument = {
  metadata: BrowserDocumentRecord;
  bytes: ArrayBuffer;
};

export type ParsedBasisLine = {
  documentId: string;
  positionNumber: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  pageNumber: number;
  lineIndex: number;
};

export type ParsedSupplierLine = ParsedBasisLine & {
  supplier: string;
  articleNumber: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
};

export type BrowserWorkerResult = {
  basisLines: ParsedBasisLine[];
  supplierLines: ParsedSupplierLine[];
  warnings: string[];
  diagnostics: {
    pagesInspected: number;
    pagesParsed: number;
    ocrRequiredPages: number;
    matchingCandidates: number;
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
  | { type: "WARNING"; message: string }
  | { type: "CHECKPOINT"; checkpoint: BrowserProcessingCheckpoint }
  | { type: "COMPLETE"; result: BrowserWorkerResult }
  | { type: "CANCELLED" }
  | { type: "ERROR"; message: string };
