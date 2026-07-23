import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionResult, RecheckResult } from "@/ai/openai-extraction-adapter";
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
  version: 1;
  runs: PersistedPilotRun[];
  reviewActions: PersistedPilotReviewAction[];
  auditEvents: AuditRecord[];
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
        version: 1,
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        reviewActions: Array.isArray(parsed.reviewActions) ? parsed.reviewActions : [],
        auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, runs: [], reviewActions: [], auditEvents: [] };
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

  async appendReview(
    action: PersistedPilotReviewAction,
    auditEvent: AuditRecord
  ): Promise<void> {
    const state = await this.read();
    state.reviewActions.push(action);
    state.auditEvents.push(auditEvent);
    await this.write(state);
  }

  private async write(state: PilotState): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2), "utf8");
  }
}
