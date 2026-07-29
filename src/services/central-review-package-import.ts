import { and, eq } from "drizzle-orm";
import type { DecisionDatabase } from "@/db/client";
import {
  decisionDrafts,
  decisionEvents,
  supplierDecisions,
  users
} from "@/db/schema";
import type { ReviewPackage } from "@/domain/review-package";

type CentralPackage = NonNullable<ReviewPackage["centralServer"]>;

export type CentralPackageMergeReport = {
  mode: "CENTRAL_SERVER";
  applied: boolean;
  inserted: {
    users: number;
    drafts: number;
    decisions: number;
    events: number;
  };
  duplicates: string[];
  conflicts: string[];
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function importCentralReviewPackage(
  database: DecisionDatabase,
  projectId: string,
  data: CentralPackage
): Promise<CentralPackageMergeReport> {
  return database.transaction(async (transaction) => {
    const db = transaction as unknown as DecisionDatabase;
    const conflicts: string[] = [];
    const duplicates: string[] = [];
    const usersToInsert = [];
    const draftsToInsert = [];
    const decisionsToInsert = [];
    const eventsToInsert = [];

    for (const imported of data.users) {
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.id, imported.id))
        .limit(1);
      if (!existing) usersToInsert.push(imported);
      else if (
        existing.displayName === imported.displayName ||
        imported.displayName === "Importierter Benutzer"
      ) {
        duplicates.push(`user:${imported.id}`);
      } else {
        conflicts.push(`user:${imported.id}:display-name`);
      }
    }

    for (const imported of data.drafts) {
      if (imported.projectId !== projectId) {
        conflicts.push(`draft:${imported.id}:project`);
        continue;
      }
      const [existing] = await db
        .select()
        .from(decisionDrafts)
        .where(
          and(
            eq(decisionDrafts.projectId, projectId),
            eq(decisionDrafts.positionId, imported.positionId)
          )
        )
        .limit(1);
      const comparable = existing
        ? {
            id: existing.id,
            version: existing.version,
            selectedSupplierOptionId: existing.selectedSupplierOptionId,
            selectedBundleLineIds: existing.selectedBundleLineIds,
            rejectedOptionIds: existing.rejectedOptionIds,
            reasonCodes: existing.reasonCodes,
            outcome: existing.outcome,
            comment: existing.comment,
            analysisVersionId: existing.analysisVersionId,
            updatedBy: existing.updatedBy,
            deviceSessionId: existing.deviceSessionId
          }
        : null;
      const incoming = {
        id: imported.id,
        version: imported.version,
        selectedSupplierOptionId: imported.selectedSupplierOptionId,
        selectedBundleLineIds: imported.selectedBundleLineIds,
        rejectedOptionIds: imported.rejectedOptionIds,
        reasonCodes: imported.reasonCodes,
        outcome: imported.outcome,
        comment: imported.comment,
        analysisVersionId: imported.analysisVersionId,
        updatedBy: imported.updatedBy,
        deviceSessionId: imported.deviceSessionId
      };
      if (!existing) draftsToInsert.push(imported);
      else if (same(comparable, incoming)) duplicates.push(`draft:${imported.id}`);
      else conflicts.push(`draft:${imported.positionId}:active-version`);
    }

    for (const imported of data.decisions) {
      if (imported.projectId !== projectId) {
        conflicts.push(`decision:${imported.id}:project`);
        continue;
      }
      const [byId] = await db
        .select()
        .from(supplierDecisions)
        .where(eq(supplierDecisions.id, imported.id))
        .limit(1);
      const [byVersion] = await db
        .select()
        .from(supplierDecisions)
        .where(
          and(
            eq(supplierDecisions.projectId, projectId),
            eq(supplierDecisions.positionId, imported.positionId),
            eq(supplierDecisions.decisionVersion, imported.decisionVersion)
          )
        )
        .limit(1);
      const existing = byId ?? byVersion;
      const comparable = existing
        ? {
            id: existing.id,
            positionId: existing.positionId,
            selectedSupplierOptionId: existing.selectedSupplierOptionId,
            selectedBundleLineIds: existing.selectedBundleLineIds,
            rejectedOptionIds: existing.rejectedOptionIds,
            outcome: existing.outcome,
            reasonCodes: existing.reasonCodes,
            comment: existing.comment,
            decidedBy: existing.decidedBy,
            previousDecisionId: existing.previousDecisionId,
            analysisVersionId: existing.analysisVersionId,
            decisionVersion: existing.decisionVersion,
            decisionType: existing.decisionType,
            contextSnapshot: existing.contextSnapshot,
            evidenceSnapshot: existing.evidenceSnapshot,
            documentRevisionIds: existing.documentRevisionIds
          }
        : null;
      const incoming = {
        id: imported.id,
        positionId: imported.positionId,
        selectedSupplierOptionId: imported.selectedSupplierOptionId,
        selectedBundleLineIds: imported.selectedBundleLineIds,
        rejectedOptionIds: imported.rejectedOptionIds,
        outcome: imported.outcome,
        reasonCodes: imported.reasonCodes,
        comment: imported.comment,
        decidedBy: imported.decidedBy,
        previousDecisionId: imported.previousDecisionId,
        analysisVersionId: imported.analysisVersionId,
        decisionVersion: imported.decisionVersion,
        decisionType: imported.decisionType,
        contextSnapshot: imported.contextSnapshot,
        evidenceSnapshot: imported.evidenceSnapshot,
        documentRevisionIds: imported.documentRevisionIds
      };
      if (!existing) decisionsToInsert.push(imported);
      else if (same(comparable, incoming)) {
        duplicates.push(`decision:${imported.id}`);
      } else {
        conflicts.push(
          `decision:${imported.positionId}:version-${imported.decisionVersion}`
        );
      }
    }

    for (const imported of data.events) {
      if (imported.projectId !== projectId) {
        conflicts.push(`event:${imported.id}:project`);
        continue;
      }
      const [existing] = await db
        .select()
        .from(decisionEvents)
        .where(eq(decisionEvents.id, imported.id))
        .limit(1);
      if (!existing) eventsToInsert.push(imported);
      else if (
        same(
          {
            id: existing.id,
            positionId: existing.positionId,
            decisionId: existing.decisionId,
            draftId: existing.draftId,
            eventType: existing.eventType,
            actorId: existing.actorId,
            metadata: existing.metadata
          },
          {
            id: imported.id,
            positionId: imported.positionId,
            decisionId: imported.decisionId,
            draftId: imported.draftId,
            eventType: imported.eventType,
            actorId: imported.actorId,
            metadata: imported.metadata
          }
        )
      ) {
        duplicates.push(`event:${imported.id}`);
      } else conflicts.push(`event:${imported.id}`);
    }

    if (conflicts.length) {
      return {
        mode: "CENTRAL_SERVER",
        applied: false,
        inserted: { users: 0, drafts: 0, decisions: 0, events: 0 },
        duplicates,
        conflicts
      };
    }

    if (usersToInsert.length) {
      await db.insert(users).values(
        usersToInsert.map((user) => ({
          id: user.id,
          displayName: user.displayName
        }))
      );
    }
    if (draftsToInsert.length) {
      await db.insert(decisionDrafts).values(
        draftsToInsert.map((draft) => ({
          id: draft.id,
          projectId: draft.projectId,
          positionId: draft.positionId,
          userId: draft.userId,
          selectedSupplierOptionId: draft.selectedSupplierOptionId,
          selectedBundleLineIds: draft.selectedBundleLineIds,
          rejectedOptionIds: draft.rejectedOptionIds,
          reasonCodes: draft.reasonCodes,
          outcome: draft.outcome,
          comment: draft.comment,
          analysisVersionId: draft.analysisVersionId,
          version: draft.version,
          createdAt: new Date(draft.createdAt),
          updatedAt: new Date(draft.updatedAt),
          updatedBy: draft.updatedBy,
          deviceSessionId: draft.deviceSessionId
        }))
      );
    }
    if (decisionsToInsert.length) {
      await db.insert(supplierDecisions).values(
        [...decisionsToInsert]
          .sort((left, right) => left.decisionVersion - right.decisionVersion)
          .map((decision) => ({
            id: decision.id,
            projectId: decision.projectId,
            positionId: decision.positionId,
            selectedSupplierOptionId: decision.selectedSupplierOptionId,
            selectedSupplierLineIds: decision.selectedBundleLineIds,
            selectedBundleLineIds: decision.selectedBundleLineIds,
            rejectedOptionIds: decision.rejectedOptionIds,
            status: decision.outcome,
            outcome: decision.outcome,
            operator: decision.decidedBy,
            reason: decision.reasonCodes.join(",") || decision.outcome,
            reasonCodes: decision.reasonCodes,
            comment: decision.comment,
            evidenceSnapshot: decision.evidenceSnapshot,
            contextSnapshot: decision.contextSnapshot,
            documentRevisionIds: decision.documentRevisionIds,
            decidedBy: decision.decidedBy,
            decidedAt: new Date(decision.decidedAt),
            previousDecisionId: decision.previousDecisionId,
            analysisVersionId: decision.analysisVersionId,
            decisionVersion: decision.decisionVersion,
            decisionType: decision.decisionType,
            createdAt: new Date(decision.createdAt)
          }))
      );
    }
    if (eventsToInsert.length) {
      await db.insert(decisionEvents).values(
        eventsToInsert.map((event) => ({
          id: event.id,
          projectId: event.projectId,
          positionId: event.positionId,
          decisionId: event.decisionId,
          draftId: event.draftId,
          eventType: event.eventType,
          actorId: event.actorId,
          timestamp: new Date(event.timestamp),
          metadata: event.metadata
        }))
      );
    }
    return {
      mode: "CENTRAL_SERVER",
      applied: true,
      inserted: {
        users: usersToInsert.length,
        drafts: draftsToInsert.length,
        decisions: decisionsToInsert.length,
        events: eventsToInsert.length
      },
      duplicates,
      conflicts
    };
  });
}
