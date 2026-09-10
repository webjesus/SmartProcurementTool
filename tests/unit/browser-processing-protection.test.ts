import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserProjectDatabase } from "@/browser-projects/indexeddb";
import { createBrowserProjectRepositories } from "@/browser-projects/repository-factory";
import { BrowserProjectService } from "@/browser-projects/project-service";
import type { BrowserAnalysisSnapshot } from "@/browser-projects/types";

const databases: BrowserProjectDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

async function setup() {
  const database = new BrowserProjectDatabase(
    new IDBFactory(),
    `protection-${crypto.randomUUID()}`
  );
  databases.push(database);
  const repositories = createBrowserProjectRepositories(database);
  const service = new BrowserProjectService(repositories);
  const project = await service.createProject("Neue Analyse mit erhaltenem Arbeitsstand");
  // No extraction is needed for this repository boundary: it must preserve the
  // old human-owned snapshot even when there are no newly parsed rows yet.
  const previous = {
    projectId: project.projectId,
    analysisVersionId: "previous",
    createdAt: "2026-01-01T00:00:00.000Z",
    matchReviews: [],
    manualCorrections: [],
    pilot: {
      runs: [],
      analysis: null,
      supplierDecisions: [],
      matchReviewActions: [],
      supplierDecisionReviewActions: []
    },
    summary: {
      basisPositions: 1,
      supplierOffers: 0,
      positionsWithOffers: 0,
      positionsWithoutOffers: 1,
      warnings: 0,
      pagesInspected: 1,
      pagesParsed: 1,
      ocrRequiredPages: 0,
      documentDiagnostics: []
    }
  } as unknown as BrowserAnalysisSnapshot;
  await service.saveAnalysis(previous);
  await service.updateProject(project.projectId, {
    activeAnalysisVersionId: previous.analysisVersionId
  });
  const selection = {
    projectId: project.projectId,
    positionId: "position-1",
    selectedSupplierOptionId: "option-1",
    selectedLineIds: ["line-1"],
    comment: "Bewusst gewählt",
    updatedAt: "2026-01-02T00:00:00.000Z"
  };
  await service.saveSelection(selection);
  const next = { ...previous, analysisVersionId: "next", createdAt: "2026-01-03T00:00:00.000Z" };
  return { repositories, service, project, previous, next, selection };
}

describe("processing protection of human work", () => {
  it("refuses silent replacement and leaves selections and the previous analysis untouched", async () => {
    const { service, repositories, project, next, selection } = await setup();
    await expect(service.saveProcessingAnalysis(next)).rejects.toThrow(
      "REPROCESSING_CONFIRMATION_REQUIRED"
    );
    expect(await repositories.analyses.get(project.projectId, "next")).toBeNull();
    expect(await service.listSelections(project.projectId)).toEqual([selection]);
    expect((await service.getProject(project.projectId))?.activeAnalysisVersionId).toBe("previous");
  });

  it("archives the old selections without applying them to new line IDs after explicit confirmation", async () => {
    const { service, repositories, project, next, selection } = await setup();
    const protection = await service.processingProtection(project.projectId);
    expect(protection.requiresConfirmation).toBe(true);
    await service.saveProcessingAnalysis(next, protection.confirmationToken);
    expect(
      (await repositories.analyses.get(project.projectId, "previous"))?.archivedSelections
    ).toEqual([selection]);
    expect(await service.listSelections(project.projectId)).toEqual([]);
    expect(await repositories.analyses.get(project.projectId, "next")).toMatchObject({
      analysisVersionId: "next",
      matchReviews: [],
      manualCorrections: []
    });
  });

  it("requires renewed confirmation if a human changes a selection while extraction is running", async () => {
    const { service, repositories, project, next, selection } = await setup();
    const protection = await service.processingProtection(project.projectId);
    await service.saveSelection({
      ...selection,
      comment: "Neu geprüft",
      updatedAt: "2026-01-02T01:00:00.000Z"
    });
    await expect(
      service.saveProcessingAnalysis(next, protection.confirmationToken)
    ).rejects.toThrow("REPROCESSING_CONFIRMATION_REQUIRED");
    expect(await repositories.analyses.get(project.projectId, "next")).toBeNull();
  });

  it("includes archived selections in the project backup without making them current", async () => {
    const { service, project, next, selection } = await setup();
    const protection = await service.processingProtection(project.projectId);
    await service.saveProcessingAnalysis(next, protection.confirmationToken);
    const backup = JSON.parse(await (await service.backupProject(project.projectId)).text());
    expect(
      backup.analysisSnapshots.find(
        (snapshot: BrowserAnalysisSnapshot) => snapshot.analysisVersionId === "previous"
      ).archivedSelections
    ).toEqual([selection]);
    expect(backup.selections).toEqual([]);
  });
});
