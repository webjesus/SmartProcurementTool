import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalDocumentStorage,
  LocalPilotPersistence,
  UnconfiguredProductionStorage
} from "@/storage/document-storage";

describe("document storage boundaries", () => {
  it("requires an explicit local enable gate", () => {
    expect(() => new LocalDocumentStorage(".data/documents", false)).toThrow(
      "Local document storage is disabled"
    );
  });

  it("rejects traversal before touching the filesystem", async () => {
    const storage = new LocalDocumentStorage(".data/documents", true);
    await expect(storage.exists("../commercial.pdf")).rejects.toThrow(
      "escapes the configured root"
    );
  });

  it("fails honestly when production storage is not configured", async () => {
    const storage = new UnconfiguredProductionStorage();
    await expect(storage.exists("document.pdf")).rejects.toThrow(
      "Production document storage is not configured"
    );
  });

  it("persists and replaces a supplier decision across repository instances", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spt-decision-"));
    try {
      const persistence = new LocalPilotPersistence(root, true);
      const timestamp = new Date().toISOString();
      const decision = {
        id: "decision-1",
        basisPositionId: "basis-1",
        supplierDocumentId: "supplier-a",
        status: "SELECTED" as const,
        comment: "scope checked",
        operator: "tester",
        timestamp
      };
      await persistence.appendSupplierDecision(decision, {
        id: decision.id,
        issueId: "decision:basis-1",
        action: "DECIDE",
        previousValue: null,
        newValue: decision,
        operator: "tester",
        timestamp,
        reason: "fixture",
        entityType: "SupplierDecision",
        entityId: "basis-1"
      });
      const restarted = new LocalPilotPersistence(root, true);
      expect((await restarted.read()).supplierDecisions).toEqual([decision]);
      expect((await restarted.read()).auditEvents).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
