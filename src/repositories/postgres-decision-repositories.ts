import crypto from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DecisionDatabase } from "@/db/client";
import {
  decisionDrafts,
  decisionEvents,
  supplierDecisions,
  userSessions,
  users
} from "@/db/schema";
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

function iso(value: Date): string {
  return value.toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function mapUser(row: typeof users.$inferSelect): DecisionUser {
  return {
    id: row.id,
    displayName: row.displayName,
    createdAt: iso(row.createdAt),
    lastSeenAt: iso(row.lastSeenAt)
  };
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly database: DecisionDatabase) {}

  async create(displayName: string): Promise<DecisionUser> {
    const [row] = await this.database
      .insert(users)
      .values({ displayName: displayName.trim() })
      .returning();
    if (!row) throw new Error("USER_CREATE_FAILED");
    return mapUser(row);
  }

  async findById(id: string): Promise<DecisionUser | null> {
    const [row] = await this.database
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ? mapUser(row) : null;
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<{ id: string }> {
    const [row] = await this.database
      .insert(userSessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: new Date(input.expiresAt)
      })
      .returning({ id: userSessions.id });
    if (!row) throw new Error("SESSION_CREATE_FAILED");
    return row;
  }

  async findBySessionTokenHash(
    tokenHash: string
  ): Promise<(DecisionUser & { sessionId: string }) | null> {
    const [row] = await this.database
      .select({ session: userSessions, user: users })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1);
    if (!row || row.session.expiresAt.getTime() <= Date.now()) return null;
    return { ...mapUser(row.user), sessionId: row.session.id };
  }

  async touch(userId: string, sessionId: string, at: string): Promise<void> {
    const timestamp = new Date(at);
    await Promise.all([
      this.database
        .update(users)
        .set({ lastSeenAt: timestamp })
        .where(eq(users.id, userId)),
      this.database
        .update(userSessions)
        .set({ lastSeenAt: timestamp })
        .where(eq(userSessions.id, sessionId))
    ]);
  }
}

export class PostgresDecisionDraftRepository
  implements DecisionDraftRepository
{
  constructor(
    private readonly database: DecisionDatabase,
    private readonly userRepository: UserRepository
  ) {}

  private async map(
    row: typeof decisionDrafts.$inferSelect
  ): Promise<DecisionDraftRecord> {
    const actor = await this.userRepository.findById(row.updatedBy);
    return {
      id: row.id,
      projectId: row.projectId,
      positionId: row.positionId,
      userId: row.userId,
      selectedSupplierOptionId: row.selectedSupplierOptionId,
      selectedBundleLineIds: stringArray(row.selectedBundleLineIds),
      rejectedOptionIds: stringArray(row.rejectedOptionIds),
      reasonCodes: stringArray(row.reasonCodes),
      outcome: row.outcome as DecisionDraftRecord["outcome"],
      comment: row.comment,
      analysisVersionId: row.analysisVersionId,
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      updatedBy: row.updatedBy,
      updatedByDisplayName: actor?.displayName ?? "Unbekannt",
      deviceSessionId: row.deviceSessionId
    };
  }

  async get(
    projectId: string,
    positionId: string
  ): Promise<DecisionDraftRecord | null> {
    const [row] = await this.database
      .select()
      .from(decisionDrafts)
      .where(
        and(
          eq(decisionDrafts.projectId, projectId),
          eq(decisionDrafts.positionId, positionId)
        )
      )
      .limit(1);
    return row ? this.map(row) : null;
  }

  async list(projectId: string): Promise<DecisionDraftRecord[]> {
    const rows = await this.database
      .select()
      .from(decisionDrafts)
      .where(eq(decisionDrafts.projectId, projectId))
      .orderBy(desc(decisionDrafts.updatedAt));
    return Promise.all(rows.map((row) => this.map(row)));
  }

  async save(input: DraftWrite): Promise<DecisionDraftRecord> {
    const current = await this.get(input.projectId, input.positionId);
    if (
      (current && input.expectedVersion !== current.version) ||
      (!current &&
        input.expectedVersion !== null &&
        input.expectedVersion !== 0)
    ) {
      throw new RepositoryConflictError(
        "Decision draft was changed by another session.",
        current?.version ?? 0,
        current ?? ({
          ...input,
          id: crypto.randomUUID(),
          version: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedByDisplayName: "Unbekannt"
        } as DecisionDraftRecord)
      );
    }

    const values = {
      projectId: input.projectId,
      positionId: input.positionId,
      userId: input.userId,
      selectedSupplierOptionId: input.selectedSupplierOptionId,
      selectedBundleLineIds: input.selectedBundleLineIds,
      rejectedOptionIds: input.rejectedOptionIds,
      reasonCodes: input.reasonCodes,
      outcome: input.outcome,
      comment: input.comment,
      analysisVersionId: input.analysisVersionId,
      updatedBy: input.updatedBy,
      deviceSessionId: input.deviceSessionId,
      updatedAt: new Date()
    };

    if (!current) {
      try {
        const [created] = await this.database
          .insert(decisionDrafts)
          .values(values)
          .returning();
        if (!created) throw new Error("DRAFT_CREATE_FAILED");
        return this.map(created);
      } catch (error) {
        const concurrent = await this.get(input.projectId, input.positionId);
        if (concurrent) {
          throw new RepositoryConflictError(
            "Decision draft was created by another session.",
            concurrent.version,
            concurrent
          );
        }
        throw error;
      }
    }

    const [updated] = await this.database
      .update(decisionDrafts)
      .set({
        ...values,
        version: sql`${decisionDrafts.version} + 1`
      })
      .where(
        and(
          eq(decisionDrafts.id, current.id),
          eq(decisionDrafts.version, current.version)
        )
      )
      .returning();
    if (!updated) {
      const concurrent = await this.get(input.projectId, input.positionId);
      if (!concurrent) throw new Error("DRAFT_UPDATE_FAILED");
      throw new RepositoryConflictError(
        "Decision draft was changed by another session.",
        concurrent.version,
        concurrent
      );
    }
    return this.map(updated);
  }

  async delete(
    projectId: string,
    positionId: string,
    expectedVersion?: number
  ): Promise<boolean> {
    const filters = [
      eq(decisionDrafts.projectId, projectId),
      eq(decisionDrafts.positionId, positionId)
    ];
    if (expectedVersion !== undefined) {
      filters.push(eq(decisionDrafts.version, expectedVersion));
    }
    const rows = await this.database
      .delete(decisionDrafts)
      .where(and(...filters))
      .returning({ id: decisionDrafts.id });
    if (rows.length) return true;
    const current = await this.get(projectId, positionId);
    if (current && expectedVersion !== undefined) {
      throw new RepositoryConflictError(
        "Decision draft was changed by another session.",
        current.version,
        current
      );
    }
    return false;
  }
}

export class PostgresSupplierDecisionRepository
  implements SupplierDecisionRepository
{
  constructor(
    private readonly database: DecisionDatabase,
    private readonly userRepository: UserRepository
  ) {}

  private async map(
    row: typeof supplierDecisions.$inferSelect
  ): Promise<CentralSupplierDecision> {
    const actor = await this.userRepository.findById(row.decidedBy);
    return {
      id: row.id,
      projectId: row.projectId,
      positionId: row.positionId,
      selectedSupplierOptionId: row.selectedSupplierOptionId,
      selectedBundleLineIds: stringArray(row.selectedBundleLineIds),
      rejectedOptionIds: stringArray(row.rejectedOptionIds),
      outcome: row.outcome as CentralSupplierDecision["outcome"],
      reasonCodes: stringArray(row.reasonCodes),
      comment: row.comment,
      decidedBy: row.decidedBy,
      decidedByDisplayName: actor?.displayName ?? "Unbekannt",
      decidedAt: iso(row.decidedAt),
      previousDecisionId: row.previousDecisionId,
      analysisVersionId: row.analysisVersionId,
      decisionVersion: row.decisionVersion,
      decisionType:
        row.decisionType as CentralSupplierDecision["decisionType"],
      contextSnapshot: row.contextSnapshot,
      evidenceSnapshot: row.evidenceSnapshot,
      documentRevisionIds: stringArray(row.documentRevisionIds),
      createdAt: iso(row.createdAt)
    };
  }

  async list(
    projectId: string,
    positionId: string
  ): Promise<CentralSupplierDecision[]> {
    const rows = await this.database
      .select()
      .from(supplierDecisions)
      .where(
        and(
          eq(supplierDecisions.projectId, projectId),
          eq(supplierDecisions.positionId, positionId)
        )
      )
      .orderBy(asc(supplierDecisions.decisionVersion));
    return Promise.all(rows.map((row) => this.map(row)));
  }

  async listProject(projectId: string): Promise<CentralSupplierDecision[]> {
    const rows = await this.database
      .select()
      .from(supplierDecisions)
      .where(eq(supplierDecisions.projectId, projectId))
      .orderBy(desc(supplierDecisions.decidedAt));
    return Promise.all(rows.map((row) => this.map(row)));
  }

  async create(input: DecisionWrite): Promise<CentralSupplierDecision> {
    const prior = await this.list(input.projectId, input.positionId);
    const current = prior.at(-1);
    const currentVersion = current?.decisionVersion ?? 0;
    if (input.expectedDecisionVersion !== currentVersion) {
      if (!current) throw new Error("DECISION_VERSION_INVALID");
      throw new RepositoryConflictError(
        "Final decision was changed by another session.",
        currentVersion,
        current
      );
    }
    try {
      const [created] = await this.database
        .insert(supplierDecisions)
        .values({
          projectId: input.projectId,
          positionId: input.positionId,
          selectedSupplierOptionId: input.selectedSupplierOptionId,
          selectedSupplierLineIds: input.selectedBundleLineIds,
          selectedBundleLineIds: input.selectedBundleLineIds,
          rejectedOptionIds: input.rejectedOptionIds,
          status: input.outcome,
          outcome: input.outcome,
          operator: input.decidedBy,
          reason: input.reasonCodes.join(",") || input.outcome,
          reasonCodes: input.reasonCodes,
          comment: input.comment,
          evidenceSnapshot: input.evidenceSnapshot,
          contextSnapshot: input.contextSnapshot,
          documentRevisionIds: input.documentRevisionIds,
          decidedBy: input.decidedBy,
          previousDecisionId: current?.id ?? null,
          analysisVersionId: input.analysisVersionId,
          decisionVersion: currentVersion + 1,
          decisionType: input.decisionType
        })
        .returning();
      if (!created) throw new Error("DECISION_CREATE_FAILED");
      return this.map(created);
    } catch (error) {
      const concurrent = (await this.list(input.projectId, input.positionId)).at(
        -1
      );
      if (concurrent && concurrent.decisionVersion > currentVersion) {
        throw new RepositoryConflictError(
          "Final decision was changed by another session.",
          concurrent.decisionVersion,
          concurrent
        );
      }
      throw error;
    }
  }
}

export class PostgresDecisionEventRepository
  implements DecisionEventRepository
{
  constructor(private readonly database: DecisionDatabase) {}

  async append(input: EventWrite): Promise<DecisionEventRecord> {
    const [row] = await this.database
      .insert(decisionEvents)
      .values(input)
      .returning();
    if (!row) throw new Error("DECISION_EVENT_CREATE_FAILED");
    return {
      ...row,
      timestamp: iso(row.timestamp),
      metadata: (row.metadata ?? {}) as Record<string, unknown>
    };
  }

  async list(
    projectId: string,
    positionId?: string
  ): Promise<DecisionEventRecord[]> {
    const rows = await this.database
      .select()
      .from(decisionEvents)
      .where(
        positionId
          ? and(
              eq(decisionEvents.projectId, projectId),
              eq(decisionEvents.positionId, positionId)
            )
          : eq(decisionEvents.projectId, projectId)
      )
      .orderBy(asc(decisionEvents.timestamp));
    return rows.map((row) => ({
      ...row,
      timestamp: iso(row.timestamp),
      metadata: (row.metadata ?? {}) as Record<string, unknown>
    }));
  }
}

function repositoriesFor(database: DecisionDatabase): DecisionRepositories {
  const userRepository = new PostgresUserRepository(database);
  return {
    users: userRepository,
    drafts: new PostgresDecisionDraftRepository(database, userRepository),
    decisions: new PostgresSupplierDecisionRepository(database, userRepository),
    events: new PostgresDecisionEventRepository(database)
  };
}

export function createPostgresDecisionUnitOfWork(
  database: DecisionDatabase
): DecisionRepositoryUnitOfWork {
  return {
    repositories: repositoriesFor(database),
    transaction: (operation) =>
      database.transaction((transaction) =>
        operation(
          repositoriesFor(
            transaction as unknown as DecisionDatabase
          )
        )
      )
  };
}
