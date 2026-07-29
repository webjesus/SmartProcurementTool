import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalDocumentStorage,
  LocalPilotPersistence,
  UnconfiguredProductionStorage
} from "@/storage/document-storage";
import type {
  DecisionEvidenceSnapshot,
  PilotAnalysis,
  SupplierDecisionReviewAction,
  SupplierDecisionV2
} from "@/domain/contracts";

function emptyAnalysis(id: string): PilotAnalysis {
  return {
    id,
    basisDocumentId: "basis-document",
    basisDocumentLabel: "Basis",
    basisPages: [1],
    basisPositionFrom: "",
    basisPositionTo: "",
    supplierDocuments: [],
    basisPositions: [],
    matchLinks: [],
    supplierOptions: [],
    recommendations: [],
    generatedAt: "2026-01-01T00:00:00.000Z"
  };
}

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

  it("keeps the previous analysis version when corrected logic is saved", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spt-analysis-version-"));
    try {
      const persistence = new LocalPilotPersistence(root, true);
      await persistence.saveAnalysis(emptyAnalysis("analysis-v1"));
      await persistence.saveAnalysis(emptyAnalysis("analysis-v2"));
      const state = await new LocalPilotPersistence(root, true).read();
      expect(state.analysis?.id).toBe("analysis-v2");
      expect(state.analysisVersions?.map((analysis) => analysis.id)).toEqual([
        "analysis-v1"
      ]);
      expect(state.supplierDecisions).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("appends a new decision without overwriting an existing DEFERRED decision", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spt-decision-"));
    try {
      const persistence = new LocalPilotPersistence(root, true);
      const timestamp = new Date().toISOString();
      const deferredDecision = {
        id: "decision-deferred",
        basisPositionId: "basis-1",
        supplierDocumentId: null,
        status: "DEFERRED" as const,
        comment: "manual review later",
        operator: "tester",
        timestamp
      };
      await persistence.appendSupplierDecision(deferredDecision, {
        id: deferredDecision.id,
        issueId: "decision:basis-1",
        action: "DEFER",
        previousValue: null,
        newValue: deferredDecision,
        operator: "tester",
        timestamp,
        reason: "fixture",
        entityType: "SupplierDecision",
        entityId: "basis-1"
      });
      const nextDecision = {
        id: "decision-next",
        basisPositionId: "basis-1",
        supplierDocumentId: null,
        status: "DEFERRED" as const,
        selectedSupplierOptionId: null,
        selectedSupplierLineIds: [],
        reasonCodes: [],
        comment: "still unresolved",
        evidenceSnapshot: null,
        documentRevisionIds: [],
        decidedBy: "tester",
        decidedAt: timestamp,
        catalogVersion: "decision-reasons-placeholder-v1",
        previousDecisionId: deferredDecision.id
      };
      await persistence.appendSupplierDecision(nextDecision, {
        id: nextDecision.id,
        issueId: "decision:basis-1",
        action: "DEFER",
        previousValue: deferredDecision,
        newValue: nextDecision,
        operator: "tester",
        timestamp,
        reason: "fixture",
        entityType: "SupplierDecision",
        entityId: "basis-1"
      });
      const restarted = new LocalPilotPersistence(root, true);
      expect((await restarted.read()).supplierDecisions).toEqual([
        deferredDecision,
        nextDecision
      ]);
      expect((await restarted.read()).auditEvents).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("imports portable decision history append-only and is idempotent after restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spt-import-"));
    const timestamp = "2026-01-01T00:00:00.000Z";
    const source = {
      evidenceId: "evidence-1",
      documentId: "doc-basis",
      documentRevisionId: "revision-basis-1",
      pageNumber: 3,
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      assetKey: "pages/basis-3.png"
    };
    const snapshot: DecisionEvidenceSnapshot = {
      capturedAt: timestamp,
      basisPosition: {
        id: "basis-1",
        positionNumber: "1.1",
        description: "Fixture",
        quantity: 1,
        unit: "Stk",
        sources: [source]
      },
      basisContext: [],
      supplierOptionId: "option-2",
      supplierDocumentId: "supplier-2",
      selectedLines: [
        {
          lineId: "line-2",
          role: "PRIMARY",
          description: "Fixture offer",
          manufacturer: null,
          articleNumber: null,
          quantity: 1,
          unit: "Stk",
          continuation: false,
          sources: [
            {
              ...source,
              evidenceId: "evidence-2",
              documentId: "supplier-2",
              documentRevisionId: "revision-supplier-2",
              assetKey: "pages/supplier-3.png"
            }
          ]
        }
      ],
      visibleSupplierOptions: [],
      supplierContextLines: [],
      includedRequiredComponents: [],
      excludedOptionalComponents: [],
      continuationPages: [],
      documentRevisionIds: ["revision-basis-1", "revision-supplier-2"]
    };
    const automatic: SupplierDecisionV2 = {
      id: "decision-auto",
      basisPositionId: "basis-1",
      supplierDocumentId: "supplier-1",
      status: "SELECTED",
      selectedSupplierOptionId: "option-1",
      selectedSupplierLineIds: ["line-1"],
      reasonCodes: [],
      comment: "AUTO_SELECTED_LOWEST_PRICE",
      evidenceSnapshot: {
        ...snapshot,
        supplierOptionId: "option-1",
        supplierDocumentId: "supplier-1",
        selectedLines: [
          {
            ...snapshot.selectedLines[0],
            lineId: "line-1"
          }
        ]
      },
      documentRevisionIds: snapshot.documentRevisionIds,
      decidedBy: "system",
      decidedAt: timestamp,
      catalogVersion: "decision-reasons-placeholder-v1",
      previousDecisionId: null,
      decisionType: "AUTOMATIC_LOWEST_PRICE"
    };
    const override: SupplierDecisionV2 = {
      ...automatic,
      id: "decision-override",
      supplierDocumentId: "supplier-2",
      selectedSupplierOptionId: "option-2",
      selectedSupplierLineIds: ["line-2"],
      comment: "Manager hat die abweichende Auswahl ausführlich begründet.",
      evidenceSnapshot: snapshot,
      decidedBy: "manager",
      previousDecisionId: automatic.id,
      decisionType: "AUTOMATIC_OVERRIDE"
    };
    const reviewAction: SupplierDecisionReviewAction = {
      id: "review-override",
      supplierDecisionId: override.id,
      basisPositionId: "basis-1",
      action: "AUTOMATIC_OVERRIDE",
      previousDecisionId: automatic.id,
      operator: "manager",
      comment: override.comment,
      timestamp
    };
    try {
      const persistence = new LocalPilotPersistence(root, true);
      const first = await persistence.importSupplierDecisionHistory({
        decisions: [automatic, override],
        reviewActions: [reviewAction],
        importedBy: "owner",
        importedAt: timestamp
      });
      const second = await new LocalPilotPersistence(
        root,
        true
      ).importSupplierDecisionHistory({
        decisions: [automatic, override],
        reviewActions: [reviewAction],
        importedBy: "owner",
        importedAt: timestamp
      });
      const restarted = await new LocalPilotPersistence(root, true).read();

      expect(first).toEqual({ imported: 2, skipped: 0 });
      expect(second).toEqual({ imported: 0, skipped: 2 });
      expect(restarted.supplierDecisions).toEqual([automatic, override]);
      expect(restarted.supplierDecisions[0]).toEqual(automatic);
      expect(restarted.supplierDecisionReviewActions).toEqual([reviewAction]);
      expect(restarted.auditEvents).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
