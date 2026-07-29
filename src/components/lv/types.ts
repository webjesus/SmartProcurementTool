import type {
  BasisPosition,
  EvidenceReference,
  MatchReviewAction,
  OfferLine,
  PilotAnalysis,
  SupplierDecision
} from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import type { ValidationIssue } from "@/domain/validation";
import type { SupplierDisplayRole } from "@/domain/supplier-option-read-model";

export type PilotReviewActionView = {
  id: string;
  runId: string;
  issueId: string;
  lineId: string;
  field: string;
  action: string;
  newValue: unknown;
  verificationStatus: OfferLine["verificationStatus"];
};

export type PilotRunView = {
  id: string;
  document: {
    id: string;
    relativePath: string;
    pageNumber: number;
    pageCount: number;
    documentType: string;
  };
  result: {
    envelope: {
      extraction: {
        offerGroups: Array<{ lines: OfferLine[] }>;
        basisPositions: BasisPosition[];
      };
    };
  };
  validationIssues: ValidationIssue[];
  pageImageAsset: string;
};

export type SupplierDocumentView = {
  id: string;
  label: string;
  supplier: string;
  offerNumber?: string;
  revision?: number;
  date?: string;
};

export type PilotStateView = {
  version: 2;
  runs: PilotRunView[];
  reviewActions: PilotReviewActionView[];
  matchReviewActions: MatchReviewAction[];
  supplierDecisions: SupplierDecision[];
  supplierDecisionReviewActions: Array<{
    id: string;
    supplierDecisionId: string;
    basisPositionId: string;
    action: string;
    previousDecisionId: string | null;
    operator: string;
    comment: string;
    timestamp: string;
  }>;
  analysis: PilotAnalysis | null;
  documentRevisions: Record<string, string>;
  projectReview: {
    projectId?: string;
    analysisVersionId?: string;
    positions: ProjectReviewPosition[];
    invariant: {
      valid: boolean;
      totalBasisLeafPositions: number;
      lvRows: number;
      statusCount: number;
      duplicatePositionIds: string[];
      duplicatePositionNumbers: string[];
      missingPositionIds: string[];
      orphanDecisionIds: string[];
      orphanSupplierOptionIds: string[];
      unknownStatusPositionIds: string[];
      problemPositionIds: string[];
    };
    coverage: {
      relevantSupplierDocumentIds: string[];
      relevantSupplierDocuments: SupplierDocumentView[];
      processedSupplierDocumentIds: string[];
      missingSupplierDocuments: Array<{ id: string; label: string }>;
      allRelevantOffersProcessed: boolean;
      projectContextConfirmed: boolean;
      historicalCalculationAvailable: boolean;
    };
  };
};

export type SourceKind = "basis" | "supplier";
export type SourceOpenContext =
  | "TABLE_BASIS_SOURCE"
  | "TABLE_SUPPLIER_SOURCE"
  | "INSPECTOR_BASIS_SOURCE"
  | "INSPECTOR_SUPPLIER_SOURCE"
  | "WARNING_CENTER_SOURCE";

export type SourceRecord = {
  key: string;
  kind: SourceKind;
  tabLabel: string;
  documentId: string;
  documentRevisionId: string;
  documentLabel: string;
  pageNumber: number;
  pageCount: number;
  evidence: EvidenceReference[];
  positionNumber: string;
  title: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  supplier?: string;
  offerNumber?: string;
  revision?: number;
  date?: string;
  lineId?: string;
  supplierOptionId?: string;
  lineRole?: OfferLine["role"];
  displayRole?: SupplierDisplayRole;
  supplierPositionNumber?: string | null;
  articleNumber?: string | null;
  manufacturer?: string | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  includedInBundle?: boolean;
  context: Array<{
    key: string;
    label: string;
    active: boolean;
  }>;
};
