import { describe, expect, it, vi } from "vitest";
import {
  createExecutionPlan,
  createProjectRun,
  type ExecutionPlanningInput
} from "@/domain/orchestrator";
import { advanceProjectRun, resolveAgentIssues } from "@/orchestrator/runtime";

function input(matchingAvailable = true): ExecutionPlanningInput {
  const key = "supplier:1";
  return {
    projectId: "integration-project",
    processingVersion: "v1",
    promptVersion: "v1",
    rulesetVersion: "v1",
    documents: [
      {
        id: "supplier",
        role: "SUPPLIER_OFFER",
        discipline: "HEIZUNG",
        documentFamily: "offer",
        supplierId: "supplier",
        pages: [{ pageNumber: 1, mode: "DIGITAL" }]
      }
    ],
    cache: {
      discovered: true,
      preprocessedPages: new Set([key]),
      extractedPages: new Set([key]),
      validatedPages: new Set([key]),
      recheckedIssueIds: new Set(),
      matchingAvailable,
      comparisonAvailable: matchingAvailable
    },
    validationIssueIds: [],
    aiCostLimitUsd: 0
  };
}

const ok = async () => ({
  output: {
    status: "SUCCEEDED" as const,
    artifactIds: [],
    issueIds: [],
    metadata: { adapter: "fake" }
  }
});

describe("ProjectRun integration", () => {
  it("runs to a human gate, applies an operator action and completes", async () => {
    const plan = createExecutionPlan(input());
    const run = createProjectRun(plan);
    const issue = {
      id: "scope-issue",
      projectRunId: run.id,
      stage: "BUILD_COMPARISON" as const,
      toolName: "calculateRecommendations" as const,
      code: "DIFFERENT_SCOPE_OF_SUPPLY" as const,
      basisPositionIds: ["basis-10"],
      message: "Pflichtkomponente fehlt",
      blocking: true,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
      requiredOperatorAction: "Lieferumfang entscheiden"
    };
    const waiting = await advanceProjectRun(
      { run, checkpoints: [], toolCalls: [], issues: [issue] },
      plan,
      { executor: ok }
    );
    expect(waiting.run.status).toBe("WAITING_FOR_OPERATOR");

    const afterAction = {
      ...waiting,
      issues: resolveAgentIssues(
        waiting.issues,
        ["basis-10"],
        new Date().toISOString()
      )
    };
    const completed = await advanceProjectRun(afterAction, plan, { executor: ok });
    expect(completed.run.status).toBe("COMPLETED");
    expect(completed.run.progress).toBe(100);
  });

  it("restarts after matching without repeating extraction checkpoints", async () => {
    const plan = createExecutionPlan(input(false));
    const run = createProjectRun(plan);
    let failMatching = true;
    const fakeAdapter = vi.fn(async (step) => {
      if (step.toolName === "generateMatchCandidates" && failMatching) {
        failMatching = false;
        throw new Error("worker restart after matching");
      }
      return ok();
    });
    const failed = await advanceProjectRun(
      { run, checkpoints: [], toolCalls: [], issues: [] },
      plan,
      { executor: fakeAdapter }
    );
    expect(failed.run.status).toBe("FAILED");
    const extractionCheckpointCount = failed.checkpoints.filter(
      (checkpoint) => checkpoint.toolName === "extractSupplierOffer"
    ).length;

    const resumed = await advanceProjectRun(failed, plan, { executor: fakeAdapter });
    expect(resumed.run.status).toBe("COMPLETED");
    expect(
      resumed.checkpoints.filter(
        (checkpoint) => checkpoint.toolName === "extractSupplierOffer"
      )
    ).toHaveLength(extractionCheckpointCount);
    expect(
      fakeAdapter.mock.calls.filter(
        ([step]) => step.toolName === "extractSupplierOffer"
      )
    ).toHaveLength(0);
  });
});

