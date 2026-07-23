import type {
  CompanyRuleSchema,
  EvidenceReference,
  ExtractionEnvelope,
  MatchLink,
  TargetedRecheck
} from "@/domain/contracts";
import type { z } from "zod";

export interface DocumentStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

export interface DocumentParser {
  inspect(input: Uint8Array): Promise<{ pageCount: number }>;
  extractPage(documentId: string, input: Uint8Array, pageNumber: number): Promise<ParsedPage>;
  renderPage(input: Uint8Array, pageNumber: number, scale: number): Promise<Uint8Array>;
}

export interface ParsedPage {
  pageNumber: number;
  width: number;
  height: number;
  mode: "DIGITAL" | "SCAN" | "HYBRID" | "UNREADABLE";
  textItems: Array<{
    id: string;
    rawText: string;
    normalizedText: string;
    order: number;
    region: { x: number; y: number; width: number; height: number };
  }>;
  imageCount: number;
}

export interface OpenAiExtractionAdapter {
  extractPage(input: {
    documentId: string;
    page: ParsedPage;
    pageImageDataUrl?: string;
  }): Promise<ExtractionEnvelope>;
  recheckIssue(input: {
    issueCodes: string[];
    allowedFields: string[];
    lockedFields: string[];
    fragmentText: string;
    headerText: string;
    neighboringRows: string[];
    cropDataUrl?: string;
  }): Promise<TargetedRecheck>;
}

export interface ProjectRepository {
  get(id: string): Promise<unknown | null>;
  save(project: unknown): Promise<void>;
}

export interface ExtractionRepository {
  saveImmutable(run: ExtractionEnvelope): Promise<void>;
  findByDocumentPage(documentId: string, pageNumber: number): Promise<ExtractionEnvelope | null>;
}

export interface MatchingRepository {
  save(links: MatchLink[]): Promise<void>;
  byBasisPosition(basisPositionId: string): Promise<MatchLink[]>;
}

export interface ReviewRepository {
  appendAction(action: ReviewActionRecord): Promise<void>;
  unresolved(projectId: string): Promise<unknown[]>;
}

export interface ProcessingJobRepository {
  enqueue(job: ProcessingJobRecord): Promise<void>;
  claimNext(workerId: string): Promise<ProcessingJobRecord | null>;
  complete(jobId: string): Promise<void>;
}

export interface AuditRepository {
  append(event: AuditRecord): Promise<void>;
}

export interface RuleRepository {
  activeFor(scope: string, scopeId?: string): Promise<Array<z.infer<typeof CompanyRuleSchema>>>;
  saveCandidate(candidate: unknown): Promise<void>;
}

export interface ReviewActionRecord {
  id: string;
  issueId: string;
  action: string;
  previousValue: unknown;
  newValue: unknown;
  operator: string;
  timestamp: string;
  reason: string;
  comment?: string;
}

export interface AuditRecord extends ReviewActionRecord {
  entityType: string;
  entityId: string;
}

export interface ProcessingJobRecord {
  id: string;
  projectId: string;
  documentId: string;
  pageNumber: number;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  attempt: number;
}

export function assertEvidenceOwnership(
  evidence: EvidenceReference,
  documentId: string,
  pageNumber: number,
  validTextItemIds: Set<string>
): boolean {
  return (
    evidence.documentId === documentId &&
    evidence.pageNumber === pageNumber &&
    evidence.textItemIds.every((id) => validTextItemIds.has(id))
  );
}
