import { describe, expect, it, vi } from "vitest";
import {
  AgentMemoryRecordSchema,
  MemoryScopeSchema,
  createExecutionPlan,
  createProjectRun,
  assertHumanLock,
  resolveEvidenceFirst,
  retrieveRelevantMemory,
  transitionProjectRun,
  type ExecutionPlanStep,
  type ExecutionPlanningInput
} from "@/domain/orchestrator";
import {
  advanceProjectRun,
  dependentPositionsForRecalculation,
  resolveAgentIssues
} from "@/orchestrator/runtime";
import { AGENT_TOOL_REGISTRY } from "@/orchestrator/tool-registry";
import {
  selfCheckComparison,
  selfCheckExtraction,
  selfCheckMatching
} from "@/orchestrator/self-check";
import { evidence, offerLine } from "../fixtures";

const pageKey = "basis:1";

function planningInput(
  overrides: Partial<ExecutionPlanningInput["cache"]> = {}
): ExecutionPlanningInput {
  return {
    projectId: "project-1",
    processingVersion: "processing-v1",
    promptVersion: "prompt-v1",
    rulesetVersion: "rules-v1",
    documents: [
      {
        id: "basis",
        role: "BASIS_LV",
        discipline: "HEIZUNG",
        documentFamily: "LV",
        supplierId: null,
        pages: [{ pageNumber: 1, mode: "DIGITAL" }]
      }
    ],
    cache: {
      discovered: true,
      preprocessedPages: new Set([pageKey]),
      extractedPages: new Set([pageKey]),
      validatedPages: new Set([pageKey]),
      recheckedIssueIds: new Set(),
      matchingAvailable: true,
      comparisonAvailable: true,
      ...overrides
    },
    validationIssueIds: [],
    aiCostLimitUsd: 0,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

const executor = vi.fn(async (step: ExecutionPlanStep) => {
  void step;
  return {
    output: {
      status: "SUCCEEDED" as const,
      artifactIds: [],
      issueIds: [],
      metadata: { fake: true }
    }
  };
});

describe("agent orchestrator", () => {
  it("builds a deterministic plan with explicit cache and AI expectations", () => {
    const first = createExecutionPlan(planningInput());
    const second = createExecutionPlan(planningInput());

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.id).toBe(second.id);
    expect(first.totalPages).toBe(1);
    expect(first.expectedAiRequests).toBe(0);
    expect(first.steps.find((step) => step.toolName === "extractBasis")).toMatchObject({
      cacheHit: true,
      mayCallAi: false,
      skipReason: "Immutable extraction response vorhanden"
    });
  });

  it("registers every tool with strict schemas, timeout and retry policy", () => {
    expect(Object.keys(AGENT_TOOL_REGISTRY)).toHaveLength(15);
    for (const definition of Object.values(AGENT_TOOL_REGISTRY)) {
      expect(definition.timeoutMs).toBeGreaterThan(0);
      expect(definition.retryPolicy.maxAttempts).toBeGreaterThan(0);
      expect(definition.inputSchema.safeParse({}).success).toBe(false);
      expect(definition.outputSchema.safeParse({}).success).toBe(false);
    }
  });

  it("enforces valid stage status transitions", () => {
    const run = createProjectRun(createExecutionPlan(planningInput()));
    const planning = transitionProjectRun(run, "PLANNING");
    const running = transitionProjectRun(planning, "RUNNING");
    expect(running.status).toBe("RUNNING");
    expect(() => transitionProjectRun(running, "CREATED")).toThrow(
      "Invalid ProjectRun transition"
    );
  });

  it("reuses cached AI results and records a checkpoint without calling AI", async () => {
    executor.mockClear();
    const plan = createExecutionPlan(planningInput());
    const run = createProjectRun(plan);
    const result = await advanceProjectRun(
      { run, checkpoints: [], toolCalls: [], issues: [] },
      plan,
      {
        executor,
        cachedCostByStepId: Object.fromEntries(
          plan.steps
            .filter((step) => step.toolName === "extractBasis")
            .map((step) => [
              step.id,
              {
                aiTool: true,
                modelId: "fake-model",
                responseId: "saved-response",
                inputTokens: 100,
                outputTokens: 20,
                cachedTokens: 100,
                estimatedCostUsd: null
              }
            ])
        )
      }
    );

    expect(result.run.status).toBe("COMPLETED");
    expect(
      executor.mock.calls.some(([step]) =>
        ["extractBasis", "extractSupplierOffer"].includes(step.toolName)
      )
    ).toBe(false);
    expect(
      result.toolCalls.find((call) => call.toolName === "extractBasis")?.cost.responseId
    ).toBe("saved-response");
  });

  it("stops before a new AI call when the cost limit is reached", async () => {
    executor.mockClear();
    const plan = createExecutionPlan(
      planningInput({ extractedPages: new Set() })
    );
    const run = createProjectRun(plan);
    const result = await advanceProjectRun(
      { run, checkpoints: [], toolCalls: [], issues: [] },
      plan,
      { executor }
    );

    expect(result.run.status).toBe("WAITING_FOR_OPERATOR");
    expect(result.issues.at(-1)?.code).toBe("AI_COST_LIMIT");
    expect(executor.mock.calls.some(([step]) => step.toolName === "extractBasis")).toBe(
      false
    );
  });

  it("resumes idempotently from the first unfinished checkpoint", async () => {
    let failed = false;
    const plan = createExecutionPlan(
      planningInput({ preprocessedPages: new Set() })
    );
    const run = createProjectRun(plan);
    const crashExecutor = vi.fn(async (step) => {
      if (step.toolName === "preprocessPages" && !failed) {
        failed = true;
        throw new Error("simulated restart");
      }
      return executor(step);
    });
    const failedState = await advanceProjectRun(
      { run, checkpoints: [], toolCalls: [], issues: [] },
      plan,
      { executor: crashExecutor }
    );
    expect(failedState.run.status).toBe("FAILED");
    const completed = await advanceProjectRun(failedState, plan, {
      executor: crashExecutor
    });
    expect(completed.run.status).toBe("COMPLETED");
    expect(
      completed.checkpoints.map((checkpoint) => checkpoint.idempotencyKey)
    ).toEqual(
      Array.from(
        new Set(completed.checkpoints.map((checkpoint) => checkpoint.idempotencyKey))
      )
    );
  });

  it("retries only classified transient tool failures", async () => {
    const plan = createExecutionPlan(
      planningInput({ preprocessedPages: new Set() })
    );
    const run = createProjectRun(plan);
    let firstAttempt = true;
    const transientExecutor = vi.fn(async (step: ExecutionPlanStep) => {
      if (step.toolName === "preprocessPages" && firstAttempt) {
        firstAttempt = false;
        throw Object.assign(new Error("temporary storage conflict"), {
          code: "STORAGE_CONFLICT"
        });
      }
      return executor(step);
    });
    const completed = await advanceProjectRun(
      { run, checkpoints: [], toolCalls: [], issues: [] },
      plan,
      { executor: transientExecutor }
    );
    expect(completed.run.status).toBe("COMPLETED");
    expect(
      completed.toolCalls.find((call) => call.toolName === "preprocessPages")
        ?.retryCount
    ).toBe(1);
  });

  it("protects human-confirmed fields", () => {
    expect(() => assertHumanLock(["quantity"], "quantity", "ORCHESTRATOR")).toThrow(
      "cannot be overwritten"
    );
    expect(() => assertHumanLock(["quantity"], "quantity", "OPERATOR")).not.toThrow();
  });

  it("retrieves only relevant active memory and never activates rule candidates", () => {
    const scope = MemoryScopeSchema.parse({
      projectId: "project-1",
      discipline: "HEIZUNG",
      supplierId: "supplier-1",
      documentFamily: "offer-v1",
      manufacturer: "Maker",
      articleNumber: "A-1",
      technicalAttributes: { dn: "32" },
      bundleContext: ["valve"]
    });
    const base = {
      scope,
      kind: "article-map",
      payload: { value: "mapped" },
      active: true,
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z"
    };
    const approved = AgentMemoryRecordSchema.parse({
      ...base,
      id: "approved",
      layer: "APPROVED_RULE",
      approved: true
    });
    const candidate = AgentMemoryRecordSchema.parse({
      ...base,
      id: "candidate",
      layer: "RULE_CANDIDATE",
      approved: false
    });
    const wrongSupplier = AgentMemoryRecordSchema.parse({
      ...base,
      id: "wrong",
      layer: "HUMAN_CONFIRMED",
      approved: true,
      scope: { ...scope, supplierId: "other" }
    });

    expect(retrieveRelevantMemory([approved, candidate, wrongSupplier], scope)).toEqual([
      approved
    ]);
    expect(resolveEvidenceFirst("current evidence", "memory")).toBe("current evidence");
  });

  it("recalculates only changed positions and their dependants", () => {
    const dependencies = new Map<string, readonly string[]>([
      ["basis-1", ["basis-2"]],
      ["basis-2", ["basis-3"]],
      ["unrelated", ["basis-4"]]
    ]);
    expect(
      dependentPositionsForRecalculation(["basis-1"], dependencies).sort()
    ).toEqual(["basis-1", "basis-2", "basis-3"]);
  });

  it("waits for operator and resumes after the blocking issue is resolved", async () => {
    const plan = createExecutionPlan(planningInput());
    const run = createProjectRun(plan);
    const issue = {
      id: "issue-1",
      projectRunId: run.id,
      stage: "MATCH_TO_BASIS" as const,
      toolName: "validateMatches" as const,
      code: "MATCHING_AMBIGUOUS" as const,
      basisPositionIds: ["basis-1"],
      message: "Zuordnung unklar",
      blocking: true,
      resolvedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      requiredOperatorAction: "Zuordnung bestätigen"
    };
    const waiting = await advanceProjectRun(
      { run, checkpoints: [], toolCalls: [], issues: [issue] },
      plan,
      { executor }
    );
    expect(waiting.run.status).toBe("WAITING_FOR_OPERATOR");
    const resumed = await advanceProjectRun(
      {
        ...waiting,
        issues: resolveAgentIssues(
          waiting.issues,
          ["basis-1"],
          "2026-01-01T01:00:00.000Z"
        )
      },
      plan,
      { executor }
    );
    expect(resumed.run.status).toBe("COMPLETED");
  });

  it("detects extraction, matching and comparison self-check violations", () => {
    const line = {
      ...offerLine,
      id: "line-1",
      quantity: 2,
      interpretedUnitPrice: 10,
      interpretedTotalPrice: 25,
      evidence: [{ ...evidence, documentId: "" }]
    };
    expect(selfCheckExtraction([line]).ok).toBe(false);
    expect(
      selfCheckMatching(
        [
          {
            id: "link-1",
            basisPositionIds: ["basis-1"],
            offerLineIds: ["line-1"],
            kind: "ONE_TO_ONE",
            status: "REQUIRED_COMPONENT",
            score: 1,
            reasons: [],
            confirmedByOperator: false
          }
        ],
        new Map([["line-1", "OPTIONAL"]])
      ).errors
    ).toContain("Optional line line-1 classified as mandatory");
    expect(
      selfCheckComparison(
        [],
        [
          {
            basisPositionId: "basis-1",
            status: "CLEAR_RECOMMENDATION",
            recommendedSupplierDocumentId: "supplier-1",
            reasons: [],
            requiresOperatorConfirmation: false
          }
        ],
        [],
        []
      ).errors
    ).toContain("Supplier auto-selection is forbidden for basis-1");
  });
});
