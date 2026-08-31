import type { PilotStateView } from "@/components/lv/types";

export const BROWSER_PROJECT_SCHEMA_VERSION = 2;

export type BrowserProjectStatus =
  | "ENTWURF"
  | "DOKUMENTE_GELADEN"
  | "PRÜFUNG_ERFORDERLICH"
  | "IN_VERARBEITUNG"
  | "BEREIT"
  | "FEHLER";

export type BrowserProjectRoute =
  | "PROJECT_DOCUMENTS"
  | "DOCUMENT_REVIEW"
  | "PROCESSING"
  | "PROCESSING_RESULT"
  | "LV_COMPARISON";

export type BrowserProjectRecord = {
  projectId: string;
  name: string;
  address: string;
  engineeringOffice: string;
  architectureOffice: string;
  objectDescription: string;
  illustrationId: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  lastRoute: BrowserProjectRoute | null;
  lastPositionId: string | null;
  status: BrowserProjectStatus;
  schemaVersion: number;
  activeAnalysisVersionId: string | null;
  processingCheckpoint: BrowserProcessingCheckpoint | null;
  documentCount: number;
  basisPositionCount: number;
  supplierOfferCount: number;
  processingFailureCode: "FAILED_NO_BASIS_POSITIONS" | "PROCESSING_ERROR" | null;
  activeDiscipline: BrowserDiscipline | null;
};

export function normalizeBrowserProjectRecord(
  project: BrowserProjectRecord | (Omit<BrowserProjectRecord, "address" | "engineeringOffice" | "architectureOffice"> & {
    address?: string;
    engineeringOffice?: string;
    architectureOffice?: string;
  })
): BrowserProjectRecord {
  return {
    ...project,
    address: project.address?.trim() ?? "",
    engineeringOffice: project.engineeringOffice?.trim() ?? "",
    architectureOffice: project.architectureOffice?.trim() ?? "",
    schemaVersion: BROWSER_PROJECT_SCHEMA_VERSION
  };
}

export type BrowserDocumentType =
  | "BASIS_LV"
  | "SUPPLIER_OFFER"
  | "MANUFACTURER_OFFER"
  | "TECHNICAL_CALCULATION"
  | "TECHNICAL_DOCUMENT"
  | "COVER_LETTER"
  | "OFFER_ATTACHMENT"
  | "EXPLICIT_NO_BID"
  | "SCAN_OCR_REQUIRED"
  | "OTHER"
  | "UNKNOWN";

export type BrowserDiscipline =
  | "HEIZUNG"
  | "SANITAER"
  | "INSTALLATIONSSYSTEME"
  | "MULTI"
  | "UNKNOWN";

export type BrowserRelationType =
  | "SEPARATE_OFFER"
  | "NEW_REVISION"
  | "ATTACHMENT"
  | "CONTINUATION"
  | "DUPLICATE"
  | "UNRELATED"
  | "UNKNOWN_RELATION";

export type BrowserScanState =
  | "TEXT_AVAILABLE"
  | "PARTIAL_TEXT"
  | "OCR_REQUIRED";

export type BrowserDocumentStatus =
  | "BEREIT"
  | "WIRD_GEPRÜFT"
  | "PRÜFUNG_ERFORDERLICH"
  | "NICHT_UNTERSTÜTZT"
  | "VERSCHLÜSSELT"
  | "FEHLER";

export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW";

export type BrowserClassificationDimensions = {
  documentRole: ClassificationConfidence;
  supplier: ClassificationConfidence;
  discipline: ClassificationConfidence;
  projectIdentity: ClassificationConfidence;
  offerNumber: ClassificationConfidence;
  relation: ClassificationConfidence;
  scanState: ClassificationConfidence;
};

export type BrowserDocumentRecord = {
  projectId: string;
  documentId: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  pageCount: number;
  detectedDocumentType: BrowserDocumentType;
  documentType: BrowserDocumentType;
  discipline: BrowserDiscipline;
  supplierName: string | null;
  offerNumber: string | null;
  documentVersion: string | null;
  revision: number | null;
  revisionOfDocumentId: string | null;
  relationType: BrowserRelationType;
  scanState: BrowserScanState;
  projectName: string | null;
  projectNumber: string | null;
  lvNumber: string | null;
  classificationDimensions: BrowserClassificationDimensions;
  classificationSignals: string[];
  textLayerCharacterCount: number;
  preliminaryPositionCount: number;
  activeBasis: boolean;
  excludedFromProcessing: boolean;
  manualRoleOverride: boolean;
  manualBasisOverrideConfirmed: boolean;
  classificationConfidence: ClassificationConfidence;
  classificationWarnings: string[];
  processingStatus: BrowserDocumentStatus;
};

export type BrowserDocumentBlobRecord = {
  projectId: string;
  documentId: string;
  blob: Blob;
};

export type BrowserProcessingStage =
  | "CLASSIFY_DOCUMENTS"
  | "EXTRACT_BASIS"
  | "EXTRACT_SUPPLIERS"
  | "NORMALIZE"
  | "MATCH"
  | "BUILD_OPTIONS"
  | "VALIDATE"
  | "FINALIZE";

export type BrowserProcessingCheckpoint = {
  runId: string;
  stage: BrowserProcessingStage;
  completedStages: BrowserProcessingStage[];
  processedPages: number;
  totalPages: number;
  currentDocumentId: string | null;
  currentPage: number | null;
  interrupted: boolean;
  updatedAt: string;
};

export type BrowserProcessingRun = {
  projectId: string;
  runId: string;
  status: "RUNNING" | "COMPLETED" | "CANCELLED" | "ERROR";
  checkpoint: BrowserProcessingCheckpoint;
  warnings: string[];
  failureCode: "FAILED_NO_BASIS_POSITIONS" | "PROCESSING_ERROR" | null;
  startedAt: string;
  updatedAt: string;
};

export type BrowserAnalysisSnapshot = {
  projectId: string;
  analysisVersionId: string;
  createdAt: string;
  pilot: PilotStateView;
  summary: {
    basisPositions: number;
    supplierOffers: number;
    positionsWithOffers: number;
    positionsWithoutOffers: number;
    warnings: number;
    pagesInspected: number;
    pagesParsed: number;
    ocrRequiredPages: number;
  };
};

export type BrowserSelectionRecord = {
  projectId: string;
  positionId: string;
  selectedSupplierOptionId: string;
  selectedLineIds: string[];
  comment: string;
  updatedAt: string;
};

export type BrowserWorkspaceRecord = {
  projectId: string;
  state: Record<string, unknown>;
  updatedAt: string;
};

export type BrowserProjectBundle = {
  projectId: string;
  analysisVersionId: string;
  bundleId: string;
  value: unknown;
};

export type BrowserProjectBackup = {
  format: "spt-project";
  schemaVersion: number;
  exportedAt: string;
  manifest: {
    projectId: string;
    name: string;
    documentCount: number;
    basisPositionCount: number;
    offerCount: number;
    totalSize: number;
    checksums: Record<string, string>;
  };
  project: BrowserProjectRecord;
  documents: BrowserDocumentRecord[];
  documentBlobs: Array<{
    documentId: string;
    mimeType: string;
    base64: string;
  }>;
  analysisSnapshots: BrowserAnalysisSnapshot[];
  selections: BrowserSelectionRecord[];
  workspace: BrowserWorkspaceRecord | null;
};
