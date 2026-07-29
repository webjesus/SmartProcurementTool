import crypto from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDecisionDatabase } from "@/db/client";
import { decisionEvents, supplierDecisions, users } from "@/db/schema";
import { decisionAnalysisVersionId, decisionProjectId } from "@/domain/decision-project";
import { LocalPilotPersistence } from "@/storage/document-storage";

function legacyUserId(operator: string): string {
  const hex = crypto
    .createHash("sha256")
    .update(`spt-legacy-user:${operator}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(
    13,
    16
  )}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; no fallback is available.");
  }
  const persistence = new LocalPilotPersistence(
    path.resolve(process.cwd(), ".data"),
    true
  );
  const state = await persistence.read();
  if (!state.analysis) throw new Error("Legacy pilot analysis is missing.");
  const database = getDecisionDatabase();
  const projectId = decisionProjectId(state.analysis);
  const analysisVersionId = decisionAnalysisVersionId(state.analysis);
  const imported: string[] = [];
  const duplicates: string[] = [];

  for (const [index, decision] of state.supplierDecisions.entries()) {
    const [existing] = await database
      .select()
      .from(supplierDecisions)
      .where(eq(supplierDecisions.id, decision.id))
      .limit(1);
    if (existing) {
      if (
        existing.projectId !== projectId ||
        existing.positionId !== decision.basisPositionId ||
        existing.outcome !== decision.status
      ) {
        throw new Error(`LEGACY_DECISION_CONFLICT:${decision.id}`);
      }
      duplicates.push(decision.id);
      continue;
    }

    const operator =
      "decidedBy" in decision ? decision.decidedBy : decision.operator;
    const decidedAt =
      "decidedAt" in decision ? decision.decidedAt : decision.timestamp;
    const actorId = legacyUserId(operator);
    await database
      .insert(users)
      .values({
        id: actorId,
        displayName: `Legacy: ${operator}`,
        createdAt: new Date(decidedAt),
        lastSeenAt: new Date(decidedAt)
      })
      .onConflictDoNothing({ target: users.id });

    const selectedLines =
      "selectedSupplierLineIds" in decision
        ? decision.selectedSupplierLineIds
        : [];
    const reasonCodes =
      "reasonCodes" in decision ? decision.reasonCodes : [];
    const documentRevisionIds =
      "documentRevisionIds" in decision ? decision.documentRevisionIds : [];
    const originalEvidence =
      "evidenceSnapshot" in decision ? decision.evidenceSnapshot : null;
    const contextSnapshot = {
      migration: "legacy-pilot-state-v1",
      originalDecisionId: decision.id,
      originalOperator: operator,
      originalStatus: decision.status,
      evidenceSnapshotOriginallyPresent: Boolean(originalEvidence)
    };
    const [created] = await database
      .insert(supplierDecisions)
      .values({
        id: decision.id,
        projectId,
        positionId: decision.basisPositionId,
        selectedSupplierId: decision.supplierDocumentId,
        selectedSupplierOptionId:
          "selectedSupplierOptionId" in decision
            ? decision.selectedSupplierOptionId
            : null,
        selectedSupplierLineIds: selectedLines,
        selectedBundleLineIds: selectedLines,
        rejectedOptionIds: [],
        status: decision.status,
        outcome: decision.status,
        operator,
        reason: reasonCodes[0] ?? decision.status,
        reasonCodes,
        comment: decision.comment,
        evidenceSnapshot:
          originalEvidence ?? {
            kind: "LEGACY_EVIDENCE_SNAPSHOT_ABSENT",
            originalDecisionId: decision.id
          },
        contextSnapshot,
        documentRevisionIds,
        decidedBy: actorId,
        decidedAt: new Date(decidedAt),
        catalogVersion:
          "catalogVersion" in decision ? decision.catalogVersion : null,
        previousDecisionId:
          "previousDecisionId" in decision
            ? decision.previousDecisionId
            : null,
        analysisVersionId,
        decisionVersion: index + 1,
        decisionType:
          "decisionType" in decision
            ? decision.decisionType
            : decision.status,
        createdAt: new Date(decidedAt)
      })
      .returning({ id: supplierDecisions.id });
    if (!created) throw new Error(`LEGACY_DECISION_IMPORT_FAILED:${decision.id}`);
    await database.insert(decisionEvents).values({
      projectId,
      positionId: decision.basisPositionId,
      decisionId: decision.id,
      draftId: null,
      eventType: "LEGACY_DECISION_IMPORTED",
      actorId,
      timestamp: new Date(),
      metadata: {
        source: ".data/pilot-state.local.json",
        originalDecisionId: decision.id,
        evidenceSnapshotOriginallyPresent: Boolean(originalEvidence)
      }
    });
    imported.push(decision.id);
  }

  console.log(
    JSON.stringify(
      {
        projectId,
        imported,
        duplicates,
        total: state.supplierDecisions.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
