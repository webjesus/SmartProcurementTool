import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  decisionDrafts,
  decisionEvents,
  supplierDecisions,
  userSessions,
  users
} from "@/db/schema";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)("PostgreSQL decision repositories", () => {
  it("persists drafts and immutable decisions in PostgreSQL", async () => {
    const { getDecisionDatabase } = await import("@/db/client");
    const { createPostgresDecisionUnitOfWork } = await import(
      "@/repositories/postgres-decision-repositories"
    );
    const database = getDecisionDatabase();
    const unit = createPostgresDecisionUnitOfWork(database);
    const projectId = `repository-test-${crypto.randomUUID()}`;
    const user = await unit.repositories.users.create("PostgreSQL Test");

    try {
      const draft = await unit.repositories.drafts.save({
        projectId,
        positionId: "position",
        userId: user.id,
        selectedSupplierOptionId: "option",
        selectedBundleLineIds: ["line"],
        rejectedOptionIds: [],
        reasonCodes: ["OTHER_REQUIRES_COMMENT"],
        outcome: "SELECTED",
        comment: "Server draft",
        analysisVersionId: "analysis@1",
        expectedVersion: 0,
        updatedBy: user.id,
        deviceSessionId: "postgres-test"
      });
      expect(
        await unit.repositories.drafts.get(projectId, "position")
      ).toMatchObject({ id: draft.id, version: 1 });

      const decision = await unit.repositories.decisions.create({
        projectId,
        positionId: "position",
        selectedSupplierOptionId: "option",
        selectedBundleLineIds: ["line"],
        rejectedOptionIds: [],
        outcome: "SELECTED",
        reasonCodes: ["OTHER_REQUIRES_COMMENT"],
        comment:
          "Die persistierte Testentscheidung enthält eine nachvollziehbare Begründung.",
        decidedBy: user.id,
        analysisVersionId: "analysis@1",
        expectedDecisionVersion: 0,
        decisionType: "MANUAL_SELECTION",
        contextSnapshot: {},
        evidenceSnapshot: {},
        documentRevisionIds: []
      });
      expect(
        await unit.repositories.decisions.list(projectId, "position")
      ).toEqual([decision]);
    } finally {
      await database
        .delete(decisionEvents)
        .where(eq(decisionEvents.projectId, projectId));
      await database
        .delete(decisionDrafts)
        .where(eq(decisionDrafts.projectId, projectId));
      await database
        .delete(supplierDecisions)
        .where(eq(supplierDecisions.projectId, projectId));
      await database
        .delete(userSessions)
        .where(eq(userSessions.userId, user.id));
      await database.delete(users).where(eq(users.id, user.id));
    }
  });
});
