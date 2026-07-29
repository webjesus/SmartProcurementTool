import type {
  CentralSupplierDecision,
  DecisionDraftRecord,
  DecisionEventRecord,
  DecisionUser
} from "@/domain/central-decision";

export class RepositoryConflictError extends Error {
  constructor(
    message: string,
    readonly currentVersion: number,
    readonly currentRecord: DecisionDraftRecord | CentralSupplierDecision
  ) {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

export type DraftWrite = Omit<
  DecisionDraftRecord,
  "id" | "version" | "createdAt" | "updatedAt" | "updatedByDisplayName"
> & {
  expectedVersion: number | null;
};

export interface DecisionDraftRepository {
  get(projectId: string, positionId: string): Promise<DecisionDraftRecord | null>;
  list(projectId: string): Promise<DecisionDraftRecord[]>;
  save(input: DraftWrite): Promise<DecisionDraftRecord>;
  delete(
    projectId: string,
    positionId: string,
    expectedVersion?: number
  ): Promise<boolean>;
}

export type DecisionWrite = Omit<
  CentralSupplierDecision,
  | "id"
  | "decisionVersion"
  | "previousDecisionId"
  | "decidedAt"
  | "createdAt"
  | "decidedByDisplayName"
> & {
  expectedDecisionVersion: number;
};

export interface SupplierDecisionRepository {
  list(projectId: string, positionId: string): Promise<CentralSupplierDecision[]>;
  listProject(projectId: string): Promise<CentralSupplierDecision[]>;
  create(input: DecisionWrite): Promise<CentralSupplierDecision>;
}

export type EventWrite = Omit<DecisionEventRecord, "id" | "timestamp">;

export interface DecisionEventRepository {
  append(input: EventWrite): Promise<DecisionEventRecord>;
  list(projectId: string, positionId?: string): Promise<DecisionEventRecord[]>;
}

export interface UserRepository {
  create(displayName: string): Promise<DecisionUser>;
  findById(id: string): Promise<DecisionUser | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<{ id: string }>;
  findBySessionTokenHash(
    tokenHash: string
  ): Promise<(DecisionUser & { sessionId: string }) | null>;
  touch(userId: string, sessionId: string, at: string): Promise<void>;
}

export type DecisionRepositories = {
  drafts: DecisionDraftRepository;
  decisions: SupplierDecisionRepository;
  events: DecisionEventRepository;
  users: UserRepository;
};

export interface DecisionRepositoryUnitOfWork {
  repositories: DecisionRepositories;
  transaction<T>(
    operation: (repositories: DecisionRepositories) => Promise<T>
  ): Promise<T>;
}
