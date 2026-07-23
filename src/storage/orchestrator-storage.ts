import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AgentIssueSchema,
  AgentMemoryRecordSchema,
  CheckpointSchema,
  ExecutionPlanSchema,
  ProjectRunSchema,
  ToolCallAuditSchema,
  type AgentIssue,
  type AgentMemoryRecord,
  type ExecutionPlan,
  type ProjectRun
} from "@/domain/orchestrator";

const OrchestratorStateSchema = z.object({
  version: z.literal(1),
  plans: z.array(ExecutionPlanSchema),
  runs: z.array(ProjectRunSchema),
  checkpoints: z.array(CheckpointSchema),
  toolCalls: z.array(ToolCallAuditSchema),
  issues: z.array(AgentIssueSchema),
  memory: z.array(AgentMemoryRecordSchema),
  updatedAt: z.string().datetime()
});
export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;

function emptyState(): OrchestratorState {
  return {
    version: 1,
    plans: [],
    runs: [],
    checkpoints: [],
    toolCalls: [],
    issues: [],
    memory: [],
    updatedAt: new Date(0).toISOString()
  };
}

export class LocalOrchestratorPersistence {
  private readonly statePath: string;

  constructor(
    root = path.resolve(process.cwd(), ".data"),
    enabled = process.env.LOCAL_CORPUS_ENABLED === "true"
  ) {
    if (!enabled) {
      throw new Error("Local orchestrator storage requires LOCAL_CORPUS_ENABLED=true.");
    }
    this.statePath = path.resolve(root, "orchestrator-state.local.json");
  }

  async read(): Promise<OrchestratorState> {
    try {
      return OrchestratorStateSchema.parse(
        JSON.parse(await readFile(this.statePath, "utf8"))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
  }

  async currentRun(projectId: string): Promise<ProjectRun | null> {
    const state = await this.read();
    return (
      state.runs
        .filter((run) => run.projectId === projectId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
    );
  }

  async saveRunState(input: {
    plan: ExecutionPlan;
    run: ProjectRun;
    checkpoints: OrchestratorState["checkpoints"];
    toolCalls: OrchestratorState["toolCalls"];
    issues: AgentIssue[];
  }): Promise<void> {
    const state = await this.read();
    state.plans = [
      ...state.plans.filter((plan) => plan.id !== input.plan.id),
      input.plan
    ];
    state.runs = [...state.runs.filter((run) => run.id !== input.run.id), input.run];
    state.checkpoints = [
      ...state.checkpoints.filter((checkpoint) => checkpoint.projectRunId !== input.run.id),
      ...input.checkpoints
    ];
    state.toolCalls = [
      ...state.toolCalls.filter((call) => call.projectRunId !== input.run.id),
      ...input.toolCalls
    ];
    state.issues = [
      ...state.issues.filter((issue) => issue.projectRunId !== input.run.id),
      ...input.issues
    ];
    state.updatedAt = new Date().toISOString();
    await this.write(state);
  }

  async readRunBundle(projectId: string): Promise<{
    plan: ExecutionPlan;
    run: ProjectRun;
    checkpoints: OrchestratorState["checkpoints"];
    toolCalls: OrchestratorState["toolCalls"];
    issues: AgentIssue[];
  } | null> {
    const state = await this.read();
    const run =
      state.runs
        .filter((item) => item.projectId === projectId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
    if (!run) return null;
    const plan = state.plans.find((item) => item.id === run.planId);
    if (!plan) throw new Error(`ExecutionPlan ${run.planId} is missing.`);
    return {
      plan,
      run,
      checkpoints: state.checkpoints.filter(
        (checkpoint) => checkpoint.projectRunId === run.id
      ),
      toolCalls: state.toolCalls.filter((call) => call.projectRunId === run.id),
      issues: state.issues.filter((issue) => issue.projectRunId === run.id)
    };
  }

  async replaceProjectMemory(
    projectId: string,
    records: AgentMemoryRecord[]
  ): Promise<void> {
    const state = await this.read();
    state.memory = [
      ...state.memory.filter((record) => record.scope.projectId !== projectId),
      ...records.map((record) => AgentMemoryRecordSchema.parse(record))
    ];
    state.updatedAt = new Date().toISOString();
    await this.write(state);
  }

  private async write(state: OrchestratorState): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(OrchestratorStateSchema.parse(state), null, 2));
    await rename(temporaryPath, this.statePath);
  }
}
