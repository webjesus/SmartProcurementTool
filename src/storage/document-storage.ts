import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionResult, RecheckResult } from "@/ai/openai-extraction-adapter";
import type {
  ExtractionRunProvenance,
  MatchReviewAction,
  PilotAnalysis,
  SupplierDecision,
  SupplierDecisionReviewAction
} from "@/domain/contracts";
import type { AuditRecord, DocumentStorage, ReviewActionRecord } from "@/domain/repositories";
import type { ValidationIssue } from "@/domain/validation";

const LOCAL_STORAGE_DISABLED =
  "Local document storage is disabled. Set LOCAL_CORPUS_ENABLED=true only on a trusted workstation.";
const PRODUCTION_STORAGE_UNCONFIGURED =
  "Production document storage is not configured. Provide an object-storage adapter before accepting documents.";

function resolveStorageKey(root: string, key: string): string {
  if (!key || path.isAbsolute(key)) {
    throw new Error("Document storage keys must be non-empty relative paths.");
  }

  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, key);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Document storage key escapes the configured root.");
  }
  return resolvedFile;
}

export class LocalDocumentStorage implements DocumentStorage {
  constructor(
    private readonly root: string,
    enabled = process.env.LOCAL_CORPUS_ENABLED === "true"
  ) {
    if (!enabled) throw new Error(LOCAL_STORAGE_DISABLED);
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    if (!contentType) throw new Error("A content type is required.");
    const destination = resolveStorageKey(this.root, key);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: "wx" });
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(resolveStorageKey(this.root, key)));
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(resolveStorageKey(this.root, key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}

export class UnconfiguredProductionStorage implements DocumentStorage {
  private unavailable(): never {
    throw new Error(PRODUCTION_STORAGE_UNCONFIGURED);
  }

  async put(_key: string, _data: Uint8Array, _contentType: string): Promise<void> {
    void [_key, _data, _contentType];
    this.unavailable();
  }

  async get(_key: string): Promise<Uint8Array> {
    void _key;
    return this.unavailable();
  }

  async exists(_key: string): Promise<boolean> {
    void _key;
    return this.unavailable();
  }
}

export interface PersistedPilotRun {
  id: string;
  document: {
    id: string;
    relativePath: string;
    pageNumber: number;
    pageCount: number;
    pageMode: "DIGITAL" | "SCAN" | "HYBRID" | "UNREADABLE";
    documentType: string;
    discipline: string;
  };
  result: ExtractionResult;
  validationIssues: ValidationIssue[];
  pageImageAsset: string;
  cropAssets: Record<string, string>;
  recheck: RecheckResult | null;
  provenance?: ExtractionRunProvenance;
  createdAt: string;
}

export interface PersistedPilotReviewAction extends ReviewActionRecord {
  runId: string;
  lineId: string;
  field: string;
  verificationStatus:
    | "MACHINE_VALIDATED"
    | "NEEDS_REVIEW"
    | "REVIEW_REQUIRED"
    | "HUMAN_CONFIRMED"
    | "HUMAN_CORRECTED";
}

export interface PilotState {
  version: 2;
  runs: PersistedPilotRun[];
  reviewActions: PersistedPilotReviewAction[];
  matchReviewActions: MatchReviewAction[];
  supplierDecisions: SupplierDecision[];
  supplierDecisionReviewActions: SupplierDecisionReviewAction[];
  auditEvents: AuditRecord[];
  analysis: PilotAnalysis | null;
  analysisVersions?: PilotAnalysis[];
}

export class LocalPilotPersistence {
  private readonly statePath: string;

  constructor(
    root = path.resolve(process.cwd(), ".data"),
    enabled = process.env.LOCAL_CORPUS_ENABLED === "true"
  ) {
    if (!enabled) throw new Error(LOCAL_STORAGE_DISABLED);
    this.statePath = path.resolve(root, "pilot-state.local.json");
  }

  async read(): Promise<PilotState> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<PilotState>;
      return {
        version: 2,
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        reviewActions: Array.isArray(parsed.reviewActions) ? parsed.reviewActions : [],
        matchReviewActions: Array.isArray(parsed.matchReviewActions)
          ? parsed.matchReviewActions
          : [],
        supplierDecisions: Array.isArray(parsed.supplierDecisions)
          ? parsed.supplierDecisions
          : [],
        supplierDecisionReviewActions: Array.isArray(
          parsed.supplierDecisionReviewActions
        )
          ? parsed.supplierDecisionReviewActions
          : [],
        auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
        analysis: parsed.analysis ?? null,
        analysisVersions: Array.isArray(parsed.analysisVersions)
          ? parsed.analysisVersions
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          version: 2,
          runs: [],
          reviewActions: [],
          matchReviewActions: [],
          supplierDecisions: [],
          supplierDecisionReviewActions: [],
          auditEvents: [],
          analysis: null,
          analysisVersions: []
        };
      }
      throw error;
    }
  }

  async saveRun(run: PersistedPilotRun): Promise<void> {
    const state = await this.read();
    const existing = state.runs.findIndex((item) => item.id === run.id);
    if (existing >= 0) state.runs[existing] = run;
    else state.runs.push(run);
    await this.write(state);
  }

  async appendImmutableRuns(
    runs: readonly PersistedPilotRun[]
  ): Promise<{ appended: number; cached: number }> {
    const state = await this.read();
    let appended = 0;
    let cached = 0;
    for (const run of runs) {
      const samePage = state.runs.find(
        (item) =>
          item.document.id === run.document.id &&
          item.document.pageNumber === run.document.pageNumber
      );
      if (samePage) {
        if (samePage.id !== run.id) {
          throw new Error(
            `Immutable extraction page already exists: ${run.document.id} page ${run.document.pageNumber} (${samePage.id}).`
          );
        }
        if (JSON.stringify(samePage) !== JSON.stringify(run)) {
          throw new Error(`Immutable extraction run ${run.id} conflicts with persisted data.`);
        }
        cached += 1;
        continue;
      }
      if (state.runs.some((item) => item.id === run.id)) {
        throw new Error(`Extraction run ID ${run.id} already belongs to another page.`);
      }
      state.runs.push(run);
      appended += 1;
    }
    if (appended > 0) await this.write(state);
    return { appended, cached };
  }

  async appendReview(
    action: PersistedPilotReviewAction,
    auditEvent: AuditRecord
  ): Promise<void> {
    const state = await this.read();
    state.reviewActions.push(action);
    state.auditEvents.push(auditEvent);
    await this.write(state);
  }

  async saveAnalysis(analysis: PilotAnalysis): Promise<void> {
    const state = await this.read();
    state.analysisVersions ??= [];
    if (
      state.analysis &&
      state.analysis.id !== analysis.id &&
      !state.analysisVersions.some(
        (candidate) => candidate.id === state.analysis!.id
      )
    ) {
      state.analysisVersions.push(state.analysis);
    }
    state.analysis = analysis;
    await this.write(state);
  }

  async appendMatchReview(
    action: MatchReviewAction,
    auditEvent: AuditRecord,
    analysis?: PilotAnalysis
  ): Promise<void> {
    const state = await this.read();
    state.matchReviewActions.push(action);
    state.auditEvents.push(auditEvent);
    if (analysis) state.analysis = analysis;
    await this.write(state);
  }

  async appendSupplierDecision(
    decision: SupplierDecision,
    auditEvent: AuditRecord,
    reviewAction?: SupplierDecisionReviewAction
  ): Promise<void> {
    const state = await this.read();
    if (state.supplierDecisions.some((item) => item.id === decision.id)) {
      throw new Error(`SupplierDecision ${decision.id} already exists.`);
    }
    state.supplierDecisions.push(decision);
    if (reviewAction) state.supplierDecisionReviewActions.push(reviewAction);
    state.auditEvents.push(auditEvent);
    await this.write(state);
  }

  async importSupplierDecisionHistory(input: {
    decisions: readonly SupplierDecision[];
    reviewActions: readonly SupplierDecisionReviewAction[];
    importedBy: string;
    importedAt: string;
  }): Promise<{ imported: number; skipped: number }> {
    const state = await this.read();
    let imported = 0;
    let skipped = 0;
    for (const decision of input.decisions) {
      const existing = state.supplierDecisions.find(
        (item) => item.id === decision.id
      );
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(decision)) {
          throw new Error(
            `SupplierDecision ${decision.id} conflicts with local history.`
          );
        }
        skipped += 1;
        continue;
      }
      state.supplierDecisions.push(decision);
      state.auditEvents.push({
        id: `import:${decision.id}`,
        issueId: `decision:${decision.basisPositionId}`,
        action: "IMPORT_REVIEW_PACKAGE",
        previousValue: null,
        newValue: decision,
        operator: input.importedBy,
        timestamp: input.importedAt,
        reason: "Portable review package import",
        comment: decision.comment,
        entityType: "SupplierDecision",
        entityId: decision.basisPositionId
      });
      imported += 1;
    }
    for (const action of input.reviewActions) {
      const existing = state.supplierDecisionReviewActions.find(
        (item) => item.id === action.id
      );
      if (existing && JSON.stringify(existing) !== JSON.stringify(action)) {
        throw new Error(
          `SupplierDecisionReviewAction ${action.id} conflicts with local history.`
        );
      }
      if (!existing) state.supplierDecisionReviewActions.push(action);
    }
    await this.write(state);
    return { imported, skipped };
  }

  private async write(state: PilotState): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2), "utf8");
  }
}
