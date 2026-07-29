import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  AgentMemoryRecordSchema,
  AgentIssueSchema,
  ToolCostMetadataSchema,
  createExecutionPlan,
  createProjectRun,
  stableHash,
  type AgentIssue,
  type AgentMemoryRecord,
  type ExecutionPlan,
  type PlanDocument,
  type ProjectRun,
  type ToolCostMetadata
} from "@/domain/orchestrator";
import type { RecommendationStatus } from "@/domain/contracts";
import {
  advanceProjectRun,
  cancelProjectRun,
  pauseProjectRun,
  type RuntimeState
} from "@/orchestrator/runtime";
import {
  selfCheckComparison,
  selfCheckExtraction,
  selfCheckMatching
} from "@/orchestrator/self-check";
import {
  LocalOrchestratorPersistence,
  type OrchestratorState
} from "@/storage/orchestrator-storage";
import {
  LocalPilotPersistence,
  type PilotState
} from "@/storage/document-storage";

export const LOCAL_PROJECT_ID = "SPT-2026-014";
const PROCESSING_VERSION = "orchestrator-pipeline-v1";
const RULESET_VERSION = "matching-rules-v2";

export interface ProjectRunServiceView {
  projectRun: ProjectRun | null;
  plan: ExecutionPlan;
  checkpoints: OrchestratorState["checkpoints"];
  toolCalls: OrchestratorState["toolCalls"];
  issues: AgentIssue[];
  mode: "LOCAL_DURABLE";
}

function selectedRuns(state: PilotState) {
  if (!state.analysis) return state.runs;
  const pageKeys = new Set([
    ...state.analysis.basisPages.map(
      (page) => `${state.analysis!.basisDocumentId}:${page}`
    ),
    ...state.analysis.supplierDocuments.flatMap((document) =>
      document.pages.map((page) => `${document.id}:${page}`)
    )
  ]);
  return state.runs.filter((run) =>
    pageKeys.has(`${run.document.id}:${run.document.pageNumber}`)
  );
}

function planDocuments(state: PilotState): PlanDocument[] {
  const grouped = new Map<string, PlanDocument>();
  for (const run of selectedRuns(state)) {
    const existing = grouped.get(run.document.id);
    const role =
      run.document.documentType === "BASIS_LV"
        ? "BASIS_LV"
        : run.document.documentType === "SUPPLIER_OFFER"
          ? "SUPPLIER_OFFER"
          : "OTHER";
    const page = {
      pageNumber: run.document.pageNumber,
      mode: run.document.pageMode
    };
    if (existing) {
      if (!existing.pages.some((item) => item.pageNumber === page.pageNumber)) {
        existing.pages.push(page);
      }
    } else {
      grouped.set(run.document.id, {
        id: run.document.id,
        role,
        discipline: run.document.discipline,
        documentFamily: run.document.documentType,
        supplierId: role === "SUPPLIER_OFFER" ? run.document.id : null,
        pages: [page]
      });
    }
  }
  return [...grouped.values()].map((document) => ({
    ...document,
    pages: document.pages.sort((left, right) => left.pageNumber - right.pageNumber)
  }));
}

export function createPilotExecutionPlan(state: PilotState): ExecutionPlan {
  const runs = selectedRuns(state);
  const pageKeys = new Set(
    runs.map((run) => `${run.document.id}:${run.document.pageNumber}`)
  );
  const blockingIssues = Array.from(
    new Set(
      runs.flatMap((run) =>
        run.validationIssues
          .filter((issue) => issue.severity === "BLOCKING")
          .map((issue) => issue.id)
      )
    )
  );
  return createExecutionPlan({
    projectId: LOCAL_PROJECT_ID,
    processingVersion: PROCESSING_VERSION,
    promptVersion:
      runs.map((run) => run.result.envelope.promptVersion).find(Boolean) ?? "unknown",
    rulesetVersion: RULESET_VERSION,
    documents: planDocuments(state),
    cache: {
      discovered: true,
      preprocessedPages: pageKeys,
      extractedPages: pageKeys,
      validatedPages: pageKeys,
      recheckedIssueIds: new Set(
        runs.flatMap((run) =>
          run.recheck ? run.validationIssues.map((issue) => issue.id) : []
        )
      ),
      matchingAvailable: Boolean(state.analysis?.matchLinks.length),
      comparisonAvailable: Boolean(state.analysis?.supplierOptions.length)
    },
    validationIssueIds: blockingIssues,
    aiCostLimitUsd: 0
  });
}

function issueCode(
  state: PilotState,
  basisPositionId: string,
  status: RecommendationStatus
): AgentIssue["code"] | null {
  const options =
    state.analysis?.supplierOptions.filter((option) =>
      option.basisPositionIds.includes(basisPositionId)
    ) ?? [];
  if (
    options.some((option) =>
      option.missingComponents.some((component) => component !== "NOT_OFFERED")
    )
  ) {
    return "MANDATORY_COMPONENT_MISSING";
  }
  switch (status) {
    case "CLEAR_RECOMMENDATION":
      return "SUPPLIER_SELECTION_REQUIRED";
    case "TECHNICAL_DEVIATION":
      return "TECHNICAL_DEVIATION";
    case "DIFFERENT_SCOPE_OF_SUPPLY":
      return "DIFFERENT_SCOPE_OF_SUPPLY";
    case "PRICE_UNCLEAR":
      return "PRICE_UNCONFIRMED";
    case "MATCHING_UNCLEAR":
    case "DECISION_REQUIRED":
    case "NOT_COMPARABLE":
      return "MATCHING_AMBIGUOUS";
    default:
      return null;
  }
}

function issuesFromPilot(state: PilotState, runId: string, createdAt: string): AgentIssue[] {
  const blockingValidation = Array.from(
    new Map(
      selectedRuns(state)
        .flatMap((run) => run.validationIssues)
        .filter((issue) => issue.severity === "BLOCKING")
        .map((issue) => [issue.id, issue] as const)
    ).values()
  ).map((issue) =>
    AgentIssueSchema.parse({
      id: `agent_issue_${issue.id}`,
      projectRunId: runId,
      stage: "VALIDATE_EXTRACTION",
      toolName: "validateExtraction",
      code: "BLOCKING_VALIDATION",
      basisPositionIds: [],
      message: issue.message.slice(0, 360),
      blocking: true,
      resolvedAt: null,
      createdAt,
      requiredOperatorAction: "Blocking validation issue prüfen"
    })
  );
  const replacements =
    state.analysis?.matchLinks
      .filter((link) => link.status === "REPLACEMENT" && !link.confirmedByOperator)
      .map((link) =>
        AgentIssueSchema.parse({
          id: `agent_issue_${randomUUID()}`,
          projectRunId: runId,
          stage: "MATCH_TO_BASIS",
          toolName: "validateMatches",
          code: "REPLACEMENT_APPROVAL_REQUIRED",
          basisPositionIds: link.basisPositionIds,
          message: link.reasons.join(" · ").slice(0, 360),
          blocking: true,
          resolvedAt: null,
          createdAt,
          requiredOperatorAction: "Replacement prüfen und bestätigen"
        })
      ) ?? [];
  const comparisonIssues =
    state.analysis?.recommendations.flatMap((recommendation) => {
      const code = issueCode(
        state,
        recommendation.basisPositionId,
        recommendation.status
      );
      if (!code || !recommendation.requiresOperatorConfirmation) return [];
      return [
        AgentIssueSchema.parse({
          id: `agent_issue_${randomUUID()}`,
          projectRunId: runId,
          stage:
            recommendation.status === "MATCHING_UNCLEAR"
              ? "MATCH_TO_BASIS"
              : "BUILD_COMPARISON",
          toolName:
            recommendation.status === "MATCHING_UNCLEAR"
              ? "validateMatches"
              : "calculateRecommendations",
          code,
          basisPositionIds: [recommendation.basisPositionId],
          message: recommendation.reasons.slice(0, 3).join(" · ").slice(0, 360),
          blocking: true,
          resolvedAt: null,
          createdAt,
          requiredOperatorAction:
            recommendation.status === "CLEAR_RECOMMENDATION"
              ? "Supplier auswählen oder Entscheidung zurückstellen"
              : recommendation.status === "MATCHING_UNCLEAR"
              ? "Zuordnung prüfen und bestätigen"
              : "Lieferumfang oder technische Abweichung entscheiden"
        })
      ];
    }) ?? [];
  return [...blockingValidation, ...replacements, ...comparisonIssues];
}

function cachedCostByStepId(
  state: PilotState,
  plan: ExecutionPlan
): Record<string, ToolCostMetadata> {
  const result: Record<string, ToolCostMetadata> = {};
  for (const step of plan.steps) {
    if (!step.cacheHit || !["extractBasis", "extractSupplierOffer"].includes(step.toolName)) {
      continue;
    }
    const run = selectedRuns(state).find(
      (item) =>
        item.document.id === step.documentId &&
        step.pageNumbers.includes(item.document.pageNumber)
    );
    if (!run) continue;
    result[step.id] = ToolCostMetadataSchema.parse({
      aiTool: true,
      modelId: run.result.metadata.modelId,
      responseId: run.result.metadata.responseId,
      inputTokens: run.result.metadata.inputTokens,
      outputTokens: run.result.metadata.outputTokens,
      cachedTokens: run.result.metadata.cachedTokens,
      estimatedCostUsd: run.result.metadata.estimatedCostUsd
    });
  }
  return result;
}

function syncResolvedIssues(issues: AgentIssue[], state: PilotState): AgentIssue[] {
  const selectedDecisions = new Set(
    state.supplierDecisions
    .filter((decision) => decision.status === "SELECTED")
      .map((decision) => decision.basisPositionId)
  );
  const confirmedMatches = new Set(
    state.matchReviewActions
      .filter((action) =>
        ["CONFIRM_MATCH", "CHOOSE_BASIS", "CONFIRM_REPLACEMENT"].includes(action.action)
      )
      .flatMap((action) => action.basisPositionIds)
  );
  const reviewedValidationIssues = new Set(
    state.reviewActions
      .filter((action) => action.action !== "DEFER")
      .map((action) => `agent_issue_${action.issueId}`)
  );
  const resolvedAt = new Date().toISOString();
  return issues.map((issue) => {
    const resolved =
      (issue.code === "BLOCKING_VALIDATION" &&
        reviewedValidationIssues.has(issue.id)) ||
      issue.basisPositionIds.some((positionId) =>
        ["MATCHING_AMBIGUOUS", "REPLACEMENT_APPROVAL_REQUIRED"].includes(issue.code)
          ? confirmedMatches.has(positionId) || selectedDecisions.has(positionId)
          : selectedDecisions.has(positionId)
      );
    return resolved && issue.resolvedAt === null
      ? AgentIssueSchema.parse({ ...issue, resolvedAt })
      : issue;
  });
}

function memoryScope(input: {
  supplierId?: string | null;
  documentFamily?: string | null;
  bundleContext?: string[];
}) {
  return {
    projectId: LOCAL_PROJECT_ID,
    discipline: "HEIZUNG",
    supplierId: input.supplierId ?? null,
    documentFamily: input.documentFamily ?? null,
    manufacturer: null,
    articleNumber: null,
    technicalAttributes: {},
    bundleContext: input.bundleContext ?? []
  };
}

function memoryFromPilot(state: PilotState): AgentMemoryRecord[] {
  const immutableFacts = planDocuments(state).map((document) =>
    AgentMemoryRecordSchema.parse({
      id: `memory_document_${document.id}`,
      layer: "IMMUTABLE_FACT",
      scope: memoryScope({
        supplierId: document.supplierId,
        documentFamily: document.documentFamily
      }),
      kind: "DOCUMENT_EXTRACTION",
      payload: {
        documentId: document.id,
        pages: document.pages.map((page) => page.pageNumber)
      },
      approved: true,
      active: true,
      version: 1,
      createdAt: selectedRuns(state).find((run) => run.document.id === document.id)?.createdAt ??
        new Date(0).toISOString()
    })
  );
  const fieldActions = state.reviewActions.map((action) =>
    AgentMemoryRecordSchema.parse({
      id: `memory_review_${action.id}`,
      layer: "HUMAN_CONFIRMED",
      scope: memoryScope({ bundleContext: [action.lineId] }),
      kind: "FIELD_CORRECTION",
      payload: {
        actionId: action.id,
        lineId: action.lineId,
        field: action.field,
        valueHash: stableHash(action.newValue)
      },
      approved: true,
      active: true,
      version: 1,
      createdAt: action.timestamp
    })
  );
  const matchActions = state.matchReviewActions.map((action) =>
    AgentMemoryRecordSchema.parse({
      id: `memory_match_${action.id}`,
      layer: "HUMAN_CONFIRMED",
      scope: memoryScope({
        supplierId: action.supplierDocumentId,
        bundleContext: action.offerLineIds
      }),
      kind: "CONFIRMED_MATCH",
      payload: {
        actionId: action.id,
        action: action.action,
        basisPositionIds: action.basisPositionIds,
        offerLineIds: action.offerLineIds
      },
      approved: true,
      active: true,
      version: 1,
      createdAt: action.timestamp
    })
  );
  const decisions = state.supplierDecisions.map((decision) =>
    AgentMemoryRecordSchema.parse({
      id: `memory_decision_${decision.id}`,
      layer: "HUMAN_CONFIRMED",
      scope: memoryScope({ supplierId: decision.supplierDocumentId }),
      kind: "SUPPLIER_DECISION",
      payload: {
        decisionId: decision.id,
        basisPositionId: decision.basisPositionId,
        supplierDocumentId: decision.supplierDocumentId,
        status: decision.status
      },
      approved: true,
      active: true,
      version: 1,
      createdAt: "decidedAt" in decision ? decision.decidedAt : decision.timestamp
    })
  );
  const candidates = state.matchReviewActions.map((action) =>
    AgentMemoryRecordSchema.parse({
      id: `memory_candidate_${action.id}`,
      layer: "RULE_CANDIDATE",
      scope: memoryScope({
        supplierId: action.supplierDocumentId,
        bundleContext: action.offerLineIds
      }),
      kind: "SUPPLIER_MATCH_HINT",
      payload: {
        sourceActionId: action.id,
        basisPositionIds: action.basisPositionIds,
        offerLineIds: action.offerLineIds
      },
      approved: false,
      active: false,
      version: 1,
      createdAt: action.timestamp
    })
  );
  return [...immutableFacts, ...fieldActions, ...matchActions, ...decisions, ...candidates];
}

async function deterministicExecutor() {
  return {
    output: {
      status: "SUCCEEDED" as const,
      artifactIds: [],
      issueIds: [],
      metadata: { deterministic: true }
    }
  };
}

function pilotSelfCheck(state: PilotState) {
  return (step: ExecutionPlan["steps"][number]) => {
    if (step.toolName === "validateExtraction") {
      const lines = selectedRuns(state)
        .filter(
          (run) =>
            run.document.id === step.documentId &&
            step.pageNumbers.includes(run.document.pageNumber)
        )
        .flatMap((run) =>
          run.result.envelope.extraction.offerGroups.flatMap((group) => group.lines)
        );
      return selfCheckExtraction(lines);
    }
    if (step.toolName === "validateMatches" && state.analysis) {
      const roles = new Map(
        selectedRuns(state).flatMap((run) =>
          run.result.envelope.extraction.offerGroups.flatMap((group) =>
            group.lines.map((line) => [line.id, line.role] as const)
          )
        )
      );
      return selfCheckMatching(state.analysis.matchLinks, roles);
    }
    if (step.toolName === "calculateRecommendations" && state.analysis) {
      return selfCheckComparison(
        state.analysis.supplierOptions,
        state.analysis.recommendations,
        state.supplierDecisions,
        state.supplierDecisions
      );
    }
    return { ok: true, errors: [] };
  };
}

export class LocalProjectRunService {
  private readonly pilot: LocalPilotPersistence;
  private readonly orchestrator: LocalOrchestratorPersistence;

  constructor(root = path.resolve(process.cwd(), ".data")) {
    this.pilot = new LocalPilotPersistence(root, true);
    this.orchestrator = new LocalOrchestratorPersistence(root, true);
  }

  async get(): Promise<ProjectRunServiceView> {
    const bundle = await this.orchestrator.readRunBundle(LOCAL_PROJECT_ID);
    if (!bundle) {
      const pilotState = await this.pilot.read();
      const plan = createPilotExecutionPlan(pilotState);
      return {
        projectRun: null,
        plan,
        checkpoints: [],
        toolCalls: [],
        issues: [],
        mode: "LOCAL_DURABLE" as const
      };
    }
    return {
      projectRun: bundle.run,
      plan: bundle.plan,
      checkpoints: bundle.checkpoints,
      toolCalls: bundle.toolCalls,
      issues: bundle.issues.map((issue) => ({
        ...issue,
        message: issue.message.slice(0, 360)
      })),
      mode: "LOCAL_DURABLE" as const
    };
  }

  async start(): Promise<ProjectRunServiceView> {
    const existing = await this.orchestrator.readRunBundle(LOCAL_PROJECT_ID);
    if (existing && !["COMPLETED", "CANCELLED"].includes(existing.run.status)) {
      return this.resume();
    }
    const pilotState = await this.pilot.read();
    await this.orchestrator.replaceProjectMemory(
      LOCAL_PROJECT_ID,
      memoryFromPilot(pilotState)
    );
    const plan = createPilotExecutionPlan(pilotState);
    const run = createProjectRun(plan);
    const state: RuntimeState = {
      run,
      checkpoints: [],
      toolCalls: [],
      issues: issuesFromPilot(pilotState, run.id, run.startedAt)
    };
    const advanced = await advanceProjectRun(state, plan, {
      executor: deterministicExecutor,
      cachedCostByStepId: cachedCostByStepId(pilotState, plan),
      selfCheck: pilotSelfCheck(pilotState)
    });
    await this.orchestrator.saveRunState({ plan, ...advanced });
    return this.get();
  }

  async resume(): Promise<ProjectRunServiceView> {
    const bundle = await this.orchestrator.readRunBundle(LOCAL_PROJECT_ID);
    if (!bundle) return this.start();
    const pilotState = await this.pilot.read();
    await this.orchestrator.replaceProjectMemory(
      LOCAL_PROJECT_ID,
      memoryFromPilot(pilotState)
    );
    const issues = syncResolvedIssues(bundle.issues, pilotState);
    const advanced = await advanceProjectRun(
      { ...bundle, issues },
      bundle.plan,
      {
        executor: deterministicExecutor,
        cachedCostByStepId: cachedCostByStepId(pilotState, bundle.plan),
        selfCheck: pilotSelfCheck(pilotState)
      }
    );
    await this.orchestrator.saveRunState({ plan: bundle.plan, ...advanced });
    return this.get();
  }

  async pause(reason = "Vom Operator pausiert"): Promise<ProjectRunServiceView> {
    const bundle = await this.requiredBundle();
    const run = pauseProjectRun(bundle.run, reason);
    await this.orchestrator.saveRunState({ ...bundle, run });
    return this.get();
  }

  async cancel(): Promise<ProjectRunServiceView> {
    const bundle = await this.requiredBundle();
    const run = cancelProjectRun(bundle.run);
    await this.orchestrator.saveRunState({ ...bundle, run });
    return this.get();
  }

  private async requiredBundle(): Promise<NonNullable<Awaited<ReturnType<LocalOrchestratorPersistence["readRunBundle"]>>>> {
    const bundle = await this.orchestrator.readRunBundle(LOCAL_PROJECT_ID);
    if (!bundle) throw new Error("PROJECT_RUN_NOT_FOUND");
    return bundle;
  }
}
