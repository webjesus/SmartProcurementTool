import { describe, expect, it } from "vitest";
import { createInMemoryDecisionUnitOfWork } from "@/repositories/in-memory-decision-repositories";
import { RepositoryConflictError } from "@/repositories/decision-repositories";

describe("central decision repositories", () => {
  it("shares a server draft, preserves actor metadata and rejects stale writes", async () => {
    const unit = createInMemoryDecisionUnitOfWork();
    const userA = await unit.repositories.users.create("Gerät A");
    const userB = await unit.repositories.users.create("Gerät B");
    const created = await unit.repositories.drafts.save({
      projectId: "project",
      positionId: "position",
      userId: userA.id,
      selectedSupplierOptionId: "option",
      selectedBundleLineIds: ["line-1", "line-2"],
      rejectedOptionIds: ["option-2"],
      reasonCodes: ["OTHER_REQUIRES_COMMENT"],
      outcome: "SELECTED",
      comment: "Beginn einer nachvollziehbaren Entscheidung.",
      analysisVersionId: "analysis@1",
      expectedVersion: 0,
      updatedBy: userA.id,
      deviceSessionId: "device-a"
    });

    expect(created.version).toBe(1);
    expect(created.updatedByDisplayName).toBe("Gerät A");
    expect(
      await unit.repositories.drafts.get("project", "position")
    ).toMatchObject({
      selectedBundleLineIds: ["line-1", "line-2"],
      rejectedOptionIds: ["option-2"],
      comment: "Beginn einer nachvollziehbaren Entscheidung."
    });

    await unit.repositories.drafts.save({
      ...created,
      userId: userB.id,
      updatedBy: userB.id,
      comment: `${created.comment} Fortsetzung auf Gerät B.`,
      expectedVersion: created.version,
      deviceSessionId: "device-b"
    });

    await expect(
      unit.repositories.drafts.save({
        ...created,
        comment: "Eine veraltete lokale Eingabe darf nicht gewinnen.",
        expectedVersion: created.version,
        deviceSessionId: "device-a"
      })
    ).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it("creates immutable decision versions with previous-decision links", async () => {
    const unit = createInMemoryDecisionUnitOfWork();
    const user = await unit.repositories.users.create("Projektleitung");
    const common = {
      projectId: "project",
      positionId: "position",
      selectedSupplierOptionId: "option",
      selectedBundleLineIds: ["line-1"],
      rejectedOptionIds: [],
      outcome: "SELECTED" as const,
      reasonCodes: ["OTHER_REQUIRES_COMMENT"],
      comment:
        "Die Auswahl wurde anhand der geöffneten Quellen vollständig geprüft.",
      decidedBy: user.id,
      analysisVersionId: "analysis@1",
      decisionType: "MANUAL_SELECTION" as const,
      contextSnapshot: { position: "position" },
      evidenceSnapshot: { page: 1 },
      documentRevisionIds: ["revision-1"]
    };
    const first = await unit.repositories.decisions.create({
      ...common,
      expectedDecisionVersion: 0
    });
    const second = await unit.repositories.decisions.create({
      ...common,
      comment: `${common.comment} Die zweite Version ergänzt die Begründung.`,
      expectedDecisionVersion: 1
    });

    expect(first.decisionVersion).toBe(1);
    expect(first.previousDecisionId).toBeNull();
    expect(second.decisionVersion).toBe(2);
    expect(second.previousDecisionId).toBe(first.id);
    expect((await unit.repositories.decisions.list("project", "position"))[0])
      .toEqual(first);
  });
});
