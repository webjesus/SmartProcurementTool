import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const ProjectRunStatusSchema = z.enum([
  "CREATED",
  "PLANNING",
  "RUNNING",
  "WAITING_FOR_OPERATOR",
  "PAUSED",
  "FAILED",
  "COMPLETED",
  "CANCELLED"
]);
export type ProjectRunStatus = z.infer<typeof ProjectRunStatusSchema>;

export const ProjectRunStageSchema = z.enum([
  "DISCOVER_DOCUMENTS",
  "PREPROCESS_DOCUMENTS",
  "EXTRACT_BASIS",
  "EXTRACT_SUPPLIERS",
  "VALIDATE_EXTRACTION",
  "RECHECK_ISSUES",
  "MATCH_TO_BASIS",
  "BUILD_COMPARISON",
  "WAIT_FOR_OPERATOR",
  "RECALCULATE",
  "READY_FOR_EXPORT",
  "COMPLETED"
]);
export type ProjectRunStage = z.infer<typeof ProjectRunStageSchema>;

export const AgentToolNameSchema = z.enum([
  "scanDocuments",
  "preprocessPages",
  "extractBasis",
  "extractSupplierOffer",
  "validateExtraction",
  "retrieveApprovedRules",
  "retrieveSimilarConfirmedCases",
  "targetedRecheck",
  "generateMatchCandidates",
  "validateMatches",
  "buildSupplierOptions",
  "calculateRecommendations",
  "createReviewIssues",
  "applyOperatorActions",
  "exportResult"
]);
export type AgentToolName = z.infer<typeof AgentToolNameSchema>;

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5),
  retryableErrors: z.array(
    z.enum(["TIMEOUT", "RATE_LIMIT", "TRANSIENT_PROVIDER", "STORAGE_CONFLICT"])
  ),
  backoffMs: z.number().int().nonnegative()
});

export const ToolCostMetadataSchema = z.object({
  aiTool: z.boolean(),
  modelId: z.string().nullable(),
  responseId: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable()
});
export type ToolCostMetadata = z.infer<typeof ToolCostMetadataSchema>;

export const ToolCallAuditSchema = z.object({
  id: z.string(),
  projectRunId: z.string(),
  toolName: AgentToolNameSchema,
  inputHash: z.string(),
  outputHash: z.string().nullable(),
  idempotencyKey: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  status: z.enum(["RUNNING", "SUCCEEDED", "CACHED", "FAILED"]),
  retryCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  checkpointId: z.string().nullable(),
  cost: ToolCostMetadataSchema,
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
});
export type ToolCallAudit = z.infer<typeof ToolCallAuditSchema>;

export const CheckpointSchema = z.object({
  id: z.string(),
  projectRunId: z.string(),
  sequence: z.number().int().nonnegative(),
  stage: ProjectRunStageSchema,
  toolName: AgentToolNameSchema,
  idempotencyKey: z.string(),
  inputHash: z.string(),
  outputHash: z.string(),
  completedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const AgentIssueSchema = z.object({
  id: z.string(),
  projectRunId: z.string(),
  stage: ProjectRunStageSchema,
  toolName: AgentToolNameSchema,
  code: z.enum([
    "BLOCKING_VALIDATION",
    "MATCHING_AMBIGUOUS",
    "TECHNICAL_DEVIATION",
    "DIFFERENT_SCOPE_OF_SUPPLY",
    "PRICE_UNCONFIRMED",
    "MANDATORY_COMPONENT_MISSING",
    "REPLACEMENT_APPROVAL_REQUIRED",
    "SUPPLIER_SELECTION_REQUIRED",
    "APPROVED_RULE_CONFLICT",
    "AI_COST_LIMIT",
    "SELF_CHECK_FAILED",
    "TOOL_FAILED"
  ]),
  basisPositionIds: z.array(z.string()),
  message: z.string(),
  blocking: z.boolean(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  requiredOperatorAction: z.string()
});
export type AgentIssue = z.infer<typeof AgentIssueSchema>;

export const PlanDocumentSchema = z.object({
  id: z.string(),
  role: z.enum(["BASIS_LV", "SUPPLIER_OFFER", "OTHER"]),
  discipline: z.string(),
  documentFamily: z.string().nullable(),
  supplierId: z.string().nullable(),
  pages: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      mode: z.enum(["DIGITAL", "SCAN", "HYBRID", "UNREADABLE"])
    })
  )
});
export type PlanDocument = z.infer<typeof PlanDocumentSchema>;

export const ExecutionPlanStepSchema = z.object({
  id: z.string(),
  sequence: z.number().int().nonnegative(),
  stage: ProjectRunStageSchema,
  toolName: AgentToolNameSchema,
  documentId: z.string().nullable(),
  pageNumbers: z.array(z.number().int().positive()),
  idempotencyKey: z.string(),
  inputHash: z.string(),
  cacheHit: z.boolean(),
  skipReason: z.string().nullable(),
  mayCallAi: z.boolean(),
  expectedAiRequests: z.number().int().nonnegative(),
  dependsOn: z.array(z.string())
});
export type ExecutionPlanStep = z.infer<typeof ExecutionPlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  createdAt: z.string().datetime(),
  processingVersion: z.string(),
  promptVersion: z.string(),
  rulesetVersion: z.string(),
  documents: z.array(PlanDocumentSchema),
  steps: z.array(ExecutionPlanStepSchema),
  totalPages: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  expectedAiRequests: z.number().int().nonnegative(),
  aiCostLimitUsd: z.number().nonnegative(),
  fingerprint: z.string()
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const ProjectRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  planId: z.string(),
  status: ProjectRunStatusSchema,
  currentStage: ProjectRunStageSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  processingVersion: z.string(),
  promptVersion: z.string(),
  rulesetVersion: z.string(),
  error: z.string().nullable(),
  pauseReason: z.string().nullable(),
  resumeToken: z.string(),
  lastCheckpointId: z.string().nullable(),
  completedStepIds: z.array(z.string()),
  processedDocumentIds: z.array(z.string()),
  cacheHits: z.number().int().nonnegative(),
  aiRequests: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  progress: z.number().min(0).max(100),
  lastToolName: AgentToolNameSchema.nullable()
});
export type ProjectRun = z.infer<typeof ProjectRunSchema>;

export const MemoryScopeSchema = z.object({
  projectId: z.string(),
  discipline: z.string().nullable(),
  supplierId: z.string().nullable(),
  documentFamily: z.string().nullable(),
  manufacturer: z.string().nullable(),
  articleNumber: z.string().nullable(),
  technicalAttributes: z.record(z.string(), z.string()),
  bundleContext: z.array(z.string())
});
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const AgentMemoryRecordSchema = z.object({
  id: z.string(),
  layer: z.enum([
    "IMMUTABLE_FACT",
    "HUMAN_CONFIRMED",
    "APPROVED_RULE",
    "RULE_CANDIDATE"
  ]),
  scope: MemoryScopeSchema,
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  approved: z.boolean(),
  active: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime()
});
export type AgentMemoryRecord = z.infer<typeof AgentMemoryRecordSchema>;

export interface PlanningCache {
  discovered: boolean;
  preprocessedPages: ReadonlySet<string>;
  extractedPages: ReadonlySet<string>;
  validatedPages: ReadonlySet<string>;
  recheckedIssueIds: ReadonlySet<string>;
  matchingAvailable: boolean;
  comparisonAvailable: boolean;
}

export interface ExecutionPlanningInput {
  projectId: string;
  processingVersion: string;
  promptVersion: string;
  rulesetVersion: string;
  documents: PlanDocument[];
  cache: PlanningCache;
  validationIssueIds: string[];
  aiCostLimitUsd: number;
  createdAt?: string;
}

export const STAGE_ORDER: readonly ProjectRunStage[] = [
  "DISCOVER_DOCUMENTS",
  "PREPROCESS_DOCUMENTS",
  "EXTRACT_BASIS",
  "EXTRACT_SUPPLIERS",
  "VALIDATE_EXTRACTION",
  "RECHECK_ISSUES",
  "MATCH_TO_BASIS",
  "BUILD_COMPARISON",
  "WAIT_FOR_OPERATOR",
  "RECALCULATE",
  "READY_FOR_EXPORT",
  "COMPLETED"
];

const ALLOWED_STATUS_TRANSITIONS: Record<ProjectRunStatus, ProjectRunStatus[]> = {
  CREATED: ["PLANNING", "CANCELLED"],
  PLANNING: ["RUNNING", "PAUSED", "FAILED", "CANCELLED"],
  RUNNING: ["WAITING_FOR_OPERATOR", "PAUSED", "FAILED", "COMPLETED", "CANCELLED"],
  WAITING_FOR_OPERATOR: ["RUNNING", "PAUSED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  FAILED: ["RUNNING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: []
};

export function stableHash(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)])
      );
    }
    return input;
  };
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function planStep(
  input: Omit<ExecutionPlanStep, "id" | "sequence" | "idempotencyKey" | "inputHash">,
  sequence: number,
  projectId: string
): ExecutionPlanStep {
  const payload = {
    projectId,
    stage: input.stage,
    toolName: input.toolName,
    documentId: input.documentId,
    pageNumbers: input.pageNumbers
  };
  const inputHash = stableHash(payload);
  return ExecutionPlanStepSchema.parse({
    ...input,
    id: `step_${inputHash.slice(0, 16)}`,
    sequence,
    idempotencyKey: `${projectId}:${input.toolName}:${inputHash}`,
    inputHash
  });
}

export function createExecutionPlan(input: ExecutionPlanningInput): ExecutionPlan {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const steps: ExecutionPlanStep[] = [];
  const add = (
    data: Omit<ExecutionPlanStep, "id" | "sequence" | "idempotencyKey" | "inputHash">
  ) => {
    steps.push(planStep(data, steps.length, input.projectId));
  };

  add({
    stage: "DISCOVER_DOCUMENTS",
    toolName: "scanDocuments",
    documentId: null,
    pageNumbers: [],
    cacheHit: input.cache.discovered,
    skipReason: input.cache.discovered ? "Dokumentmanifest bereits vorhanden" : null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: []
  });

  for (const document of input.documents) {
    for (const page of document.pages) {
      const key = `${document.id}:${page.pageNumber}`;
      const previousStepId = steps.at(-1)?.id;
      add({
        stage: "PREPROCESS_DOCUMENTS",
        toolName: "preprocessPages",
        documentId: document.id,
        pageNumbers: [page.pageNumber],
        cacheHit: input.cache.preprocessedPages.has(key),
        skipReason: input.cache.preprocessedPages.has(key)
          ? "Vorverarbeitete Seite vorhanden"
          : null,
        mayCallAi: false,
        expectedAiRequests: 0,
        dependsOn: previousStepId ? [previousStepId] : []
      });
      const extractionCached = input.cache.extractedPages.has(key);
      add({
        stage: document.role === "BASIS_LV" ? "EXTRACT_BASIS" : "EXTRACT_SUPPLIERS",
        toolName: document.role === "BASIS_LV" ? "extractBasis" : "extractSupplierOffer",
        documentId: document.id,
        pageNumbers: [page.pageNumber],
        cacheHit: extractionCached,
        skipReason: extractionCached ? "Immutable extraction response vorhanden" : null,
        mayCallAi: !extractionCached,
        expectedAiRequests: extractionCached ? 0 : 1,
        dependsOn: [steps.at(-1)!.id]
      });
      const validationCached = input.cache.validatedPages.has(key);
      add({
        stage: "VALIDATE_EXTRACTION",
        toolName: "validateExtraction",
        documentId: document.id,
        pageNumbers: [page.pageNumber],
        cacheHit: validationCached,
        skipReason: validationCached ? "Validierung bereits gespeichert" : null,
        mayCallAi: false,
        expectedAiRequests: 0,
        dependsOn: [steps.at(-1)!.id]
      });
    }
  }

  for (const issueId of input.validationIssueIds) {
    const cached = input.cache.recheckedIssueIds.has(issueId);
    add({
      stage: "RECHECK_ISSUES",
      toolName: "targetedRecheck",
      documentId: null,
      pageNumbers: [],
      cacheHit: cached,
      skipReason: cached ? "Targeted recheck response vorhanden" : null,
      mayCallAi: !cached,
      expectedAiRequests: cached ? 0 : 1,
      dependsOn: steps.at(-1) ? [steps.at(-1)!.id] : []
    });
  }

  add({
    stage: "MATCH_TO_BASIS",
    toolName: "retrieveApprovedRules",
    documentId: null,
    pageNumbers: [],
    cacheHit: false,
    skipReason: null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: steps.at(-1) ? [steps.at(-1)!.id] : []
  });
  add({
    stage: "MATCH_TO_BASIS",
    toolName: "retrieveSimilarConfirmedCases",
    documentId: null,
    pageNumbers: [],
    cacheHit: false,
    skipReason: null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });
  add({
    stage: "MATCH_TO_BASIS",
    toolName: "generateMatchCandidates",
    documentId: null,
    pageNumbers: [],
    cacheHit: input.cache.matchingAvailable,
    skipReason: input.cache.matchingAvailable ? "MatchLinks vorhanden" : null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });
  add({
    stage: "MATCH_TO_BASIS",
    toolName: "validateMatches",
    documentId: null,
    pageNumbers: [],
    cacheHit: input.cache.matchingAvailable,
    skipReason: input.cache.matchingAvailable ? "Match validation vorhanden" : null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });
  add({
    stage: "BUILD_COMPARISON",
    toolName: "buildSupplierOptions",
    documentId: null,
    pageNumbers: [],
    cacheHit: input.cache.comparisonAvailable,
    skipReason: input.cache.comparisonAvailable ? "Supplier options vorhanden" : null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });
  add({
    stage: "BUILD_COMPARISON",
    toolName: "calculateRecommendations",
    documentId: null,
    pageNumbers: [],
    cacheHit: input.cache.comparisonAvailable,
    skipReason: input.cache.comparisonAvailable ? "Recommendations vorhanden" : null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });
  add({
    stage: "WAIT_FOR_OPERATOR",
    toolName: "createReviewIssues",
    documentId: null,
    pageNumbers: [],
    cacheHit: false,
    skipReason: null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });
  add({
    stage: "RECALCULATE",
    toolName: "applyOperatorActions",
    documentId: null,
    pageNumbers: [],
    cacheHit: false,
    skipReason: null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });
  add({
    stage: "READY_FOR_EXPORT",
    toolName: "exportResult",
    documentId: null,
    pageNumbers: [],
    cacheHit: false,
    skipReason: null,
    mayCallAi: false,
    expectedAiRequests: 0,
    dependsOn: [steps.at(-1)!.id]
  });

  const fingerprint = stableHash({
    projectId: input.projectId,
    processingVersion: input.processingVersion,
    promptVersion: input.promptVersion,
    rulesetVersion: input.rulesetVersion,
    documents: input.documents,
    steps: steps.map(({ idempotencyKey, cacheHit }) => ({ idempotencyKey, cacheHit }))
  });
  return ExecutionPlanSchema.parse({
    id: `plan_${fingerprint.slice(0, 16)}`,
    projectId: input.projectId,
    createdAt,
    processingVersion: input.processingVersion,
    promptVersion: input.promptVersion,
    rulesetVersion: input.rulesetVersion,
    documents: input.documents,
    steps,
    totalPages: input.documents.reduce((sum, document) => sum + document.pages.length, 0),
    cacheHits: steps.filter((step) => step.cacheHit).length,
    expectedAiRequests: steps.reduce((sum, step) => sum + step.expectedAiRequests, 0),
    aiCostLimitUsd: input.aiCostLimitUsd,
    fingerprint
  });
}

export function createProjectRun(
  plan: ExecutionPlan,
  now = new Date().toISOString()
): ProjectRun {
  return ProjectRunSchema.parse({
    id: `run_${randomUUID()}`,
    projectId: plan.projectId,
    planId: plan.id,
    status: "CREATED",
    currentStage: "DISCOVER_DOCUMENTS",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    processingVersion: plan.processingVersion,
    promptVersion: plan.promptVersion,
    rulesetVersion: plan.rulesetVersion,
    error: null,
    pauseReason: null,
    resumeToken: randomUUID(),
    lastCheckpointId: null,
    completedStepIds: [],
    processedDocumentIds: [],
    cacheHits: 0,
    aiRequests: 0,
    reviewCount: 0,
    progress: 0,
    lastToolName: null
  });
}

export function transitionProjectRun(
  run: ProjectRun,
  status: ProjectRunStatus,
  updates: Partial<ProjectRun> = {},
  now = new Date().toISOString()
): ProjectRun {
  if (run.status !== status && !ALLOWED_STATUS_TRANSITIONS[run.status].includes(status)) {
    throw new Error(`Invalid ProjectRun transition ${run.status} -> ${status}.`);
  }
  return ProjectRunSchema.parse({
    ...run,
    ...updates,
    status,
    updatedAt: now,
    completedAt: status === "COMPLETED" ? now : updates.completedAt ?? run.completedAt
  });
}

function scopeMatches(value: string | null, requested: string | null): boolean {
  return value === null || requested === null || value === requested;
}

export function retrieveRelevantMemory(
  records: AgentMemoryRecord[],
  scope: MemoryScope
): AgentMemoryRecord[] {
  return records.filter((record) => {
    if (!record.active || record.scope.projectId !== scope.projectId) return false;
    if (record.layer === "RULE_CANDIDATE") return false;
    if (!scopeMatches(record.scope.discipline, scope.discipline)) return false;
    if (!scopeMatches(record.scope.supplierId, scope.supplierId)) return false;
    if (!scopeMatches(record.scope.documentFamily, scope.documentFamily)) return false;
    if (!scopeMatches(record.scope.manufacturer, scope.manufacturer)) return false;
    if (!scopeMatches(record.scope.articleNumber, scope.articleNumber)) return false;
    if (
      Object.entries(record.scope.technicalAttributes).some(
        ([name, value]) => scope.technicalAttributes[name] !== value
      )
    ) {
      return false;
    }
    if (
      record.scope.bundleContext.length > 0 &&
      !record.scope.bundleContext.some((item) => scope.bundleContext.includes(item))
    ) {
      return false;
    }
    return true;
  });
}

export function resolveEvidenceFirst<T>(
  currentEvidenceValue: T | null | undefined,
  memoryValue: T | null | undefined
): T | null {
  return currentEvidenceValue ?? memoryValue ?? null;
}

export function assertHumanLock(
  lockedFields: readonly string[],
  field: string,
  source: "OPERATOR" | "ORCHESTRATOR"
): void {
  if (source === "ORCHESTRATOR" && lockedFields.includes(field)) {
    throw new Error(`Human-confirmed field ${field} cannot be overwritten.`);
  }
}
