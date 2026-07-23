import { randomUUID } from "node:crypto";
import {
  AgentIssueSchema,
  CheckpointSchema,
  ProjectRunSchema,
  ToolCallAuditSchema,
  ToolCostMetadataSchema,
  stableHash,
  transitionProjectRun,
  type AgentIssue,
  type Checkpoint,
  type ExecutionPlan,
  type ExecutionPlanStep,
  type ProjectRun,
  type ToolCallAudit,
  type ToolCostMetadata
} from "@/domain/orchestrator";
import { getAgentTool } from "@/orchestrator/tool-registry";
import type { AgentToolDefinition } from "@/orchestrator/tool-registry";

export interface ToolExecutionResult {
  output: {
    status: "SUCCEEDED" | "CACHED";
    artifactIds: string[];
    issueIds: string[];
    metadata: Record<string, string | number | boolean | null>;
  };
  cost?: Partial<ToolCostMetadata>;
}

export type ToolExecutor = (
  step: ExecutionPlanStep,
  input: Record<string, unknown>,
  signal: AbortSignal
) => Promise<ToolExecutionResult>;

export interface RuntimeState {
  run: ProjectRun;
  checkpoints: Checkpoint[];
  toolCalls: ToolCallAudit[];
  issues: AgentIssue[];
}

export interface AdvanceOptions {
  now?: () => string;
  executor: ToolExecutor;
  cachedCostByStepId?: Record<string, ToolCostMetadata>;
  estimatedAiCostUsdByStepId?: Record<string, number>;
  selfCheck?: (
    step: ExecutionPlanStep
  ) => { ok: boolean; errors: string[] } | Promise<{ ok: boolean; errors: string[] }>;
}

const EMPTY_COST = ToolCostMetadataSchema.parse({
  aiTool: false,
  modelId: null,
  responseId: null,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  estimatedCostUsd: null
});

class ClassifiedToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryCount: number
  ) {
    super(message);
  }
}

function classifyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "TIMEOUT";
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "TOOL_FAILED";
}

async function executeWithRetry(
  definition: AgentToolDefinition,
  step: ExecutionPlanStep,
  input: Record<string, unknown>,
  executor: ToolExecutor
): Promise<{ execution: ToolExecutionResult; retryCount: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < definition.retryPolicy.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), definition.timeoutMs);
    try {
      return {
        execution: await executor(step, input, controller.signal),
        retryCount: attempt
      };
    } catch (error) {
      lastError = error;
      const code = classifyError(error);
      const retryable = definition.retryPolicy.retryableErrors.includes(
        code as "TIMEOUT" | "RATE_LIMIT" | "TRANSIENT_PROVIDER" | "STORAGE_CONFLICT"
      );
      if (!retryable || attempt + 1 >= definition.retryPolicy.maxAttempts) {
        throw new ClassifiedToolError(
          error instanceof Error ? error.message : "Tool execution failed",
          code,
          attempt
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, definition.retryPolicy.backoffMs)
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ClassifiedToolError(
    lastError instanceof Error ? lastError.message : "Tool execution failed",
    classifyError(lastError),
    definition.retryPolicy.maxAttempts - 1
  );
}

function toolInput(run: ProjectRun, step: ExecutionPlanStep): Record<string, unknown> {
  const base = {
    projectRunId: run.id,
    projectId: run.projectId,
    idempotencyKey: step.idempotencyKey
  };
  if (["preprocessPages", "extractBasis", "extractSupplierOffer", "validateExtraction"].includes(step.toolName)) {
    return {
      ...base,
      documentId: step.documentId,
      pageNumbers: step.pageNumbers
    };
  }
  if (
    [
      "generateMatchCandidates",
      "validateMatches",
      "buildSupplierOptions",
      "calculateRecommendations",
      "createReviewIssues",
      "retrieveSimilarConfirmedCases"
    ].includes(step.toolName)
  ) {
    return { ...base, basisPositionIds: [] };
  }
  if (step.toolName === "applyOperatorActions") {
    return { ...base, basisPositionIds: [], reviewActionIds: [] };
  }
  if (step.toolName === "targetedRecheck") {
    return { ...base, issueIds: [], allowedFields: [], lockedFields: [] };
  }
  return base;
}

function checkpointFor(
  run: ProjectRun,
  step: ExecutionPlanStep,
  output: ToolExecutionResult["output"],
  sequence: number,
  completedAt: string
): Checkpoint {
  const outputHash = stableHash(output);
  return CheckpointSchema.parse({
    id: `checkpoint_${randomUUID()}`,
    projectRunId: run.id,
    sequence,
    stage: step.stage,
    toolName: step.toolName,
    idempotencyKey: step.idempotencyKey,
    inputHash: step.inputHash,
    outputHash,
    completedAt,
    metadata: {
      cacheHit: output.status === "CACHED",
      artifactCount: output.artifactIds.length,
      issueCount: output.issueIds.length
    }
  });
}

function pendingBlockingIssues(issues: AgentIssue[]): AgentIssue[] {
  return issues.filter((issue) => issue.blocking && issue.resolvedAt === null);
}

export async function advanceProjectRun(
  state: RuntimeState,
  plan: ExecutionPlan,
  options: AdvanceOptions
): Promise<RuntimeState> {
  const now = options.now ?? (() => new Date().toISOString());
  let run = state.run;
  const checkpoints = [...state.checkpoints];
  const toolCalls = [...state.toolCalls];
  const issues = [...state.issues];

  if (["COMPLETED", "CANCELLED"].includes(run.status)) return state;
  if (run.status === "PAUSED") {
    run = transitionProjectRun(run, "RUNNING", { pauseReason: null }, now());
  } else if (run.status === "FAILED" || run.status === "WAITING_FOR_OPERATOR") {
    if (pendingBlockingIssues(issues).length > 0) return { ...state, run, issues };
    run = transitionProjectRun(run, "RUNNING", { error: null, pauseReason: null }, now());
  } else if (run.status === "CREATED") {
    run = transitionProjectRun(run, "PLANNING", {}, now());
    run = transitionProjectRun(run, "RUNNING", {}, now());
  } else if (run.status === "PLANNING") {
    run = transitionProjectRun(run, "RUNNING", {}, now());
  }

  const completedKeys = new Set(checkpoints.map((checkpoint) => checkpoint.idempotencyKey));
  for (const step of plan.steps) {
    if (completedKeys.has(step.idempotencyKey)) continue;
    if (step.toolName === "applyOperatorActions" && pendingBlockingIssues(issues).length > 0) {
      return {
        ...state,
        run: transitionProjectRun(
          run,
          "WAITING_FOR_OPERATOR",
          {
            currentStage: "WAIT_FOR_OPERATOR",
            reviewCount: pendingBlockingIssues(issues).length,
            pauseReason: "Offene Operatorentscheidungen"
          },
          now()
        ),
        checkpoints,
        toolCalls,
        issues
      };
    }

    const definition = getAgentTool(step.toolName);
    if (definition.aiTool && !step.cacheHit) {
      const spent = toolCalls.reduce(
        (sum, call) => sum + (call.cost.estimatedCostUsd ?? 0),
        0
      );
      const estimated = options.estimatedAiCostUsdByStepId?.[step.id] ?? 0;
      if (plan.aiCostLimitUsd <= 0 || spent + estimated > plan.aiCostLimitUsd) {
        const createdAt = now();
        issues.push(
          AgentIssueSchema.parse({
            id: `agent_issue_${randomUUID()}`,
            projectRunId: run.id,
            stage: step.stage,
            toolName: step.toolName,
            code: "AI_COST_LIMIT",
            basisPositionIds: [],
            message: `AI cost limit ${plan.aiCostLimitUsd.toFixed(2)} USD erreicht.`,
            blocking: true,
            resolvedAt: null,
            createdAt,
            requiredOperatorAction: "AI-Kostenlimit prüfen und freigeben"
          })
        );
        return {
          run: transitionProjectRun(
            run,
            "WAITING_FOR_OPERATOR",
            {
              currentStage: step.stage,
              reviewCount: pendingBlockingIssues(issues).length,
              pauseReason: "AI-Kostenlimit erreicht",
              lastToolName: step.toolName
            },
            createdAt
          ),
          checkpoints,
          toolCalls,
          issues
        };
      }
    }
    const input = definition.inputSchema.parse(
      toolInput(run, step)
    ) as Record<string, unknown>;
    const startedAt = now();
    const callId = `toolcall_${randomUUID()}`;
    const existingSuccess = toolCalls.find(
      (call) =>
        call.idempotencyKey === step.idempotencyKey &&
        ["SUCCEEDED", "CACHED"].includes(call.status)
    );
    if (existingSuccess) {
      const syntheticOutput: ToolExecutionResult["output"] = {
        status: "CACHED",
        artifactIds: [],
        issueIds: [],
        metadata: { reusedToolCallId: existingSuccess.id }
      };
      const checkpoint = checkpointFor(run, step, syntheticOutput, checkpoints.length, now());
      checkpoints.push(checkpoint);
      completedKeys.add(step.idempotencyKey);
      run = ProjectRunSchema.parse({
        ...run,
        currentStage: step.stage,
        lastCheckpointId: checkpoint.id,
        completedStepIds: Array.from(new Set([...run.completedStepIds, step.id])),
        cacheHits: run.cacheHits + 1,
        progress: Math.round((checkpoints.length / plan.steps.length) * 100),
        lastToolName: step.toolName,
        updatedAt: checkpoint.completedAt
      });
      continue;
    }

    try {
      const attempt = step.cacheHit
        ? {
            execution: {
              output: {
                status: "CACHED" as const,
                artifactIds: [`cache:${step.id}`],
                issueIds: [],
                metadata: { skipReason: step.skipReason }
              },
              cost: options.cachedCostByStepId?.[step.id]
            },
            retryCount: 0
          }
        : await executeWithRetry(definition, step, input, options.executor);
      const execution = attempt.execution;
      const output = definition.outputSchema.parse(execution.output) as ToolExecutionResult["output"];
      const completedAt = now();
      const checkpoint = checkpointFor(run, step, output, checkpoints.length, completedAt);
      const cost = ToolCostMetadataSchema.parse({
        ...EMPTY_COST,
        aiTool: definition.aiTool,
        ...execution.cost
      });
      const audit = ToolCallAuditSchema.parse({
        id: callId,
        projectRunId: run.id,
        toolName: step.toolName,
        inputHash: step.inputHash,
        outputHash: checkpoint.outputHash,
        idempotencyKey: step.idempotencyKey,
        startedAt,
        completedAt,
        status: output.status,
        retryCount: attempt.retryCount,
        errorCode: null,
        checkpointId: checkpoint.id,
        cost,
        metadata: {
          documentId: step.documentId,
          pageCount: step.pageNumbers.length,
          cacheHit: output.status === "CACHED"
        }
      });
      checkpoints.push(checkpoint);
      toolCalls.push(audit);
      completedKeys.add(step.idempotencyKey);
      const processedDocumentIds = step.documentId
        ? Array.from(new Set([...run.processedDocumentIds, step.documentId]))
        : run.processedDocumentIds;
      run = ProjectRunSchema.parse({
        ...run,
        currentStage: step.stage,
        lastCheckpointId: checkpoint.id,
        completedStepIds: Array.from(new Set([...run.completedStepIds, step.id])),
        processedDocumentIds,
        cacheHits: run.cacheHits + (output.status === "CACHED" ? 1 : 0),
        aiRequests: run.aiRequests + (definition.aiTool && output.status !== "CACHED" ? 1 : 0),
        progress: Math.round((checkpoints.length / plan.steps.length) * 100),
        lastToolName: step.toolName,
        updatedAt: completedAt
      });
      if (
        options.selfCheck &&
        ["validateExtraction", "validateMatches", "calculateRecommendations"].includes(
          step.toolName
        )
      ) {
        const check = await options.selfCheck(step);
        if (!check.ok) {
          const issue = AgentIssueSchema.parse({
            id: `agent_issue_${randomUUID()}`,
            projectRunId: run.id,
            stage: step.stage,
            toolName: step.toolName,
            code: "SELF_CHECK_FAILED",
            basisPositionIds: [],
            message: check.errors.join(" · ").slice(0, 500),
            blocking: true,
            resolvedAt: null,
            createdAt: completedAt,
            requiredOperatorAction: "Deterministischen Self-check prüfen"
          });
          issues.push(issue);
          return {
            run: transitionProjectRun(
              run,
              "FAILED",
              {
                currentStage: step.stage,
                error: issue.message,
                pauseReason: "Self-check fehlgeschlagen",
                lastToolName: step.toolName
              },
              completedAt
            ),
            checkpoints,
            toolCalls,
            issues
          };
        }
      }
    } catch (error) {
      const completedAt = now();
      toolCalls.push(
        ToolCallAuditSchema.parse({
          id: callId,
          projectRunId: run.id,
          toolName: step.toolName,
          inputHash: step.inputHash,
          outputHash: null,
          idempotencyKey: step.idempotencyKey,
          startedAt,
          completedAt,
          status: "FAILED",
          retryCount:
            error instanceof ClassifiedToolError ? error.retryCount : 0,
          errorCode:
            error instanceof ClassifiedToolError
              ? error.code
              : classifyError(error),
          checkpointId: null,
          cost: { ...EMPTY_COST, aiTool: definition.aiTool },
          metadata: { documentId: step.documentId, pageCount: step.pageNumbers.length }
        })
      );
      return {
        ...state,
        run: transitionProjectRun(
          run,
          "FAILED",
          {
            currentStage: step.stage,
            error: error instanceof Error ? error.message : "Tool execution failed",
            lastToolName: step.toolName
          },
          completedAt
        ),
        checkpoints,
        toolCalls,
        issues
      };
    }

    if (step.stage === "WAIT_FOR_OPERATOR" && pendingBlockingIssues(issues).length > 0) {
      run = transitionProjectRun(
        run,
        "WAITING_FOR_OPERATOR",
        {
          currentStage: "WAIT_FOR_OPERATOR",
          reviewCount: pendingBlockingIssues(issues).length,
          pauseReason: "Offene Operatorentscheidungen"
        },
        now()
      );
      return { run, checkpoints, toolCalls, issues };
    }
  }

  run = transitionProjectRun(
    run,
    "COMPLETED",
    {
      currentStage: "COMPLETED",
      progress: 100,
      pauseReason: null,
      error: null
    },
    now()
  );
  return { run, checkpoints, toolCalls, issues };
}

export function pauseProjectRun(
  run: ProjectRun,
  reason: string,
  now?: string
): ProjectRun {
  if (!["RUNNING", "WAITING_FOR_OPERATOR", "PLANNING"].includes(run.status)) {
    throw new Error(`ProjectRun in ${run.status} cannot be paused.`);
  }
  return transitionProjectRun(run, "PAUSED", { pauseReason: reason }, now);
}

export function cancelProjectRun(run: ProjectRun, now?: string): ProjectRun {
  return transitionProjectRun(
    run,
    "CANCELLED",
    { pauseReason: "Vom Operator abgebrochen" },
    now
  );
}

export function resolveAgentIssues(
  issues: AgentIssue[],
  basisPositionIds: readonly string[],
  resolvedAt: string
): AgentIssue[] {
  const selected = new Set(basisPositionIds);
  return issues.map((issue) =>
    issue.basisPositionIds.some((id) => selected.has(id))
      ? AgentIssueSchema.parse({ ...issue, resolvedAt })
      : issue
  );
}

export function dependentPositionsForRecalculation(
  changedBasisPositionIds: readonly string[],
  dependencyMap: ReadonlyMap<string, readonly string[]>
): string[] {
  const pending = [...changedBasisPositionIds];
  const affected = new Set(pending);
  while (pending.length > 0) {
    const current = pending.shift()!;
    for (const dependent of dependencyMap.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        pending.push(dependent);
      }
    }
  }
  return [...affected];
}
