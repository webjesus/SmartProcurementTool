import path from "node:path";
import { describe, expect, it } from "vitest";
import { decisionAnalysisVersionId, decisionProjectId } from "@/domain/decision-project";
import { createInMemoryDecisionUnitOfWork } from "@/repositories/in-memory-decision-repositories";
import { RepositoryConflictError } from "@/repositories/decision-repositories";
import { DecisionSyncService } from "@/services/decision-sync-service";
import { LocalPilotPersistence } from "@/storage/document-storage";

describe("central server decision synchronization", () => {
  it("loads a draft on a second device and atomically creates a final decision", async () => {
    const state = await new LocalPilotPersistence(
      path.resolve(process.cwd(), ".data"),
      true
    ).read();
    expect(state.analysis).not.toBeNull();
    const analysis = state.analysis!;
    const basis = analysis.basisPositions.find(
      (candidate) =>
        !candidate.heading &&
        candidate.evidence.length > 0 &&
        analysis.supplierOptions.some(
          (option) =>
            option.basisPositionIds.includes(candidate.id) &&
            option.matchedOfferLineIds.length > 0
        )
    );
    expect(basis).toBeDefined();
    const option = analysis.supplierOptions.find(
      (candidate) =>
        candidate.basisPositionIds.includes(basis!.id) &&
        candidate.matchedOfferLineIds.length > 0
    );
    expect(option).toBeDefined();

    const unit = createInMemoryDecisionUnitOfWork();
    const service = new DecisionSyncService(unit);
    const userA = await unit.repositories.users.create("Gerät A");
    const userB = await unit.repositories.users.create("Gerät B");
    const projectId = decisionProjectId(analysis);
    const analysisVersionId = decisionAnalysisVersionId(analysis);
    const draft = await service.saveDraft({
      projectId,
      positionId: basis!.id,
      actorId: userA.id,
      actorSessionId: "session-a",
      draft: {
        selectedSupplierOptionId: option!.id,
        selectedBundleLineIds: [...option!.matchedOfferLineIds],
        rejectedOptionIds: [],
        reasonCodes: ["OTHER_REQUIRES_COMMENT"],
        outcome: "SELECTED",
        comment: "Die Quellen wurden auf Gerät A geöffnet und geprüft.",
        analysisVersionId,
        expectedVersion: 0,
        deviceSessionId: "device-a"
      }
    });

    const secondDevice = await service.getDraft(
      projectId,
      basis!.id,
      analysisVersionId
    );
    expect(secondDevice).toMatchObject({
      id: draft.id,
      selectedSupplierOptionId: option!.id,
      selectedBundleLineIds: option!.matchedOfferLineIds,
      updatedByDisplayName: "Gerät A"
    });

    await service.saveDraft({
      projectId,
      positionId: basis!.id,
      actorId: userB.id,
      actorSessionId: "session-b",
      draft: {
        ...draft,
        comment:
          "Die Quellen wurden auf Gerät B vollständig ergänzt und geprüft.",
        expectedVersion: draft.version,
        deviceSessionId: "device-b"
      }
    });
    await expect(
      service.saveDraft({
        projectId,
        positionId: basis!.id,
        actorId: userA.id,
        actorSessionId: "session-a",
        draft: {
          ...draft,
          comment: "Diese veraltete Fassung darf nicht still überschreiben.",
          expectedVersion: draft.version,
          deviceSessionId: "device-a"
        }
      })
    ).rejects.toBeInstanceOf(RepositoryConflictError);

    const decision = await service.createDecision({
      projectId,
      positionId: basis!.id,
      actorId: userB.id,
      decision: {
        selectedSupplierOptionId: option!.id,
        selectedBundleLineIds: [...option!.matchedOfferLineIds],
        rejectedOptionIds: [],
        outcome: "SELECTED",
        reasonCodes: ["OTHER_REQUIRES_COMMENT"],
        comment:
          "Die vollständige Variante wurde anhand der Basis- und Angebotsquellen nachvollziehbar geprüft.",
        analysisVersionId,
        expectedDecisionVersion: 0,
        decisionType: "MANUAL_SELECTION"
      }
    });

    expect(decision).toMatchObject({
      decisionVersion: 1,
      decidedByDisplayName: "Gerät B",
      selectedBundleLineIds: option!.matchedOfferLineIds
    });
    expect(decision.evidenceSnapshot).toBeTruthy();
    expect(await service.getDraft(projectId, basis!.id, analysisVersionId))
      .toBeNull();
    expect((await unit.repositories.events.list(projectId, basis!.id)).map(
      (event) => event.eventType
    )).toEqual(expect.arrayContaining([
      "DRAFT_CREATED",
      "DRAFT_UPDATED",
      "FINAL_DECISION_CREATED",
      "REVIEW_ACTION_CREATED"
    ]));
  });
});
