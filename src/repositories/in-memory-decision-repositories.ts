import crypto from "node:crypto";
import type {
  CentralSupplierDecision,
  DecisionDraftRecord,
  DecisionEventRecord,
  DecisionUser
} from "@/domain/central-decision";
import type {
  DecisionDraftRepository,
  DecisionEventRepository,
  DecisionRepositories,
  DecisionRepositoryUnitOfWork,
  DecisionWrite,
  DraftWrite,
  EventWrite,
  SupplierDecisionRepository,
  UserRepository
} from "@/repositories/decision-repositories";
import { RepositoryConflictError } from "@/repositories/decision-repositories";

function now(): string {
  return new Date().toISOString();
}

export class InMemoryDecisionDraftRepository
  implements DecisionDraftRepository
{
  readonly records = new Map<string, DecisionDraftRecord>();
  private readonly users: InMemoryUserRepository;

  constructor(users: InMemoryUserRepository) {
    this.users = users;
  }

  private key(projectId: string, positionId: string): string {
    return `${projectId}\u0000${positionId}`;
  }

  async get(
    projectId: string,
    positionId: string
  ): Promise<DecisionDraftRecord | null> {
    return structuredClone(this.records.get(this.key(projectId, positionId)) ?? null);
  }

  async list(projectId: string): Promise<DecisionDraftRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => record.projectId === projectId)
      .map((record) => structuredClone(record));
  }

  async save(input: DraftWrite): Promise<DecisionDraftRecord> {
    const key = this.key(input.projectId, input.positionId);
    const current = this.records.get(key);
    const expected = input.expectedVersion;
    if (
      (current && expected !== current.version) ||
      (!current && expected !== null && expected !== 0)
    ) {
      throw new RepositoryConflictError(
        "Decision draft was changed by another session.",
        current?.version ?? 0,
        structuredClone(current ?? ({
          ...input,
          id: crypto.randomUUID(),
          version: 0,
          createdAt: now(),
          updatedAt: now(),
          updatedByDisplayName: "Unbekannt"
        } as DecisionDraftRecord))
      );
    }
    const timestamp = now();
    const actor = await this.users.findById(input.updatedBy);
    if (!actor) throw new Error("USER_NOT_FOUND");
    const record: DecisionDraftRecord = {
      ...input,
      id: current?.id ?? crypto.randomUUID(),
      version: (current?.version ?? 0) + 1,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      updatedByDisplayName: actor.displayName
    };
    const { expectedVersion: _expectedVersion, ...stored } = record as
      DecisionDraftRecord & { expectedVersion?: number | null };
    void _expectedVersion;
    this.records.set(key, stored);
    return structuredClone(stored);
  }

  async delete(
    projectId: string,
    positionId: string,
    expectedVersion?: number
  ): Promise<boolean> {
    const key = this.key(projectId, positionId);
    const current = this.records.get(key);
    if (!current) return false;
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new RepositoryConflictError(
        "Decision draft was changed by another session.",
        current.version,
        structuredClone(current)
      );
    }
    return this.records.delete(key);
  }
}

export class InMemorySupplierDecisionRepository
  implements SupplierDecisionRepository
{
  readonly records: CentralSupplierDecision[] = [];
  private readonly users: InMemoryUserRepository;

  constructor(users: InMemoryUserRepository) {
    this.users = users;
  }

  async list(
    projectId: string,
    positionId: string
  ): Promise<CentralSupplierDecision[]> {
    return this.records
      .filter(
        (record) =>
          record.projectId === projectId && record.positionId === positionId
      )
      .map((record) => structuredClone(record));
  }

  async listProject(projectId: string): Promise<CentralSupplierDecision[]> {
    return this.records
      .filter((record) => record.projectId === projectId)
      .map((record) => structuredClone(record));
  }

  async create(input: DecisionWrite): Promise<CentralSupplierDecision> {
    const prior = await this.list(input.projectId, input.positionId);
    const currentVersion = prior.at(-1)?.decisionVersion ?? 0;
    if (input.expectedDecisionVersion !== currentVersion) {
      const current = prior.at(-1);
      if (!current) throw new Error("DECISION_VERSION_INVALID");
      throw new RepositoryConflictError(
        "Final decision was changed by another session.",
        currentVersion,
        current
      );
    }
    const actor = await this.users.findById(input.decidedBy);
    if (!actor) throw new Error("USER_NOT_FOUND");
    const timestamp = now();
    const record: CentralSupplierDecision = {
      ...input,
      id: crypto.randomUUID(),
      previousDecisionId: prior.at(-1)?.id ?? null,
      decisionVersion: currentVersion + 1,
      decidedAt: timestamp,
      createdAt: timestamp,
      decidedByDisplayName: actor.displayName
    };
    const {
      expectedDecisionVersion: _expectedDecisionVersion,
      ...stored
    } = record as CentralSupplierDecision & {
      expectedDecisionVersion?: number;
    };
    void _expectedDecisionVersion;
    this.records.push(stored);
    return structuredClone(stored);
  }
}

export class InMemoryDecisionEventRepository
  implements DecisionEventRepository
{
  readonly records: DecisionEventRecord[] = [];

  async append(input: EventWrite): Promise<DecisionEventRecord> {
    const record = {
      ...input,
      id: crypto.randomUUID(),
      timestamp: now()
    };
    this.records.push(record);
    return structuredClone(record);
  }

  async list(
    projectId: string,
    positionId?: string
  ): Promise<DecisionEventRecord[]> {
    return this.records
      .filter(
        (record) =>
          record.projectId === projectId &&
          (!positionId || record.positionId === positionId)
      )
      .map((record) => structuredClone(record));
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, DecisionUser>();
  readonly sessions = new Map<
    string,
    { id: string; userId: string; expiresAt: string }
  >();

  async create(displayName: string): Promise<DecisionUser> {
    const timestamp = now();
    const user = {
      id: crypto.randomUUID(),
      displayName: displayName.trim(),
      createdAt: timestamp,
      lastSeenAt: timestamp
    };
    this.users.set(user.id, user);
    return structuredClone(user);
  }

  async findById(id: string): Promise<DecisionUser | null> {
    return structuredClone(this.users.get(id) ?? null);
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<{ id: string }> {
    const session = {
      id: crypto.randomUUID(),
      userId: input.userId,
      expiresAt: input.expiresAt
    };
    this.sessions.set(input.tokenHash, session);
    return { id: session.id };
  }

  async findBySessionTokenHash(
    tokenHash: string
  ): Promise<(DecisionUser & { sessionId: string }) | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = this.users.get(session.userId);
    return user ? { ...structuredClone(user), sessionId: session.id } : null;
  }

  async touch(userId: string, _sessionId: string, at: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, lastSeenAt: at });
  }
}

export function createInMemoryDecisionUnitOfWork(): DecisionRepositoryUnitOfWork {
  const users = new InMemoryUserRepository();
  const repositories: DecisionRepositories = {
    users,
    drafts: new InMemoryDecisionDraftRepository(users),
    decisions: new InMemorySupplierDecisionRepository(users),
    events: new InMemoryDecisionEventRepository()
  };
  return {
    repositories,
    transaction: async (operation) => operation(repositories)
  };
}
