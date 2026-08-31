import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_DATABASE_VERSION,
  BROWSER_STORES,
  BrowserProjectDatabase
} from "@/browser-projects/indexeddb";
import {
  assignProjectIllustrationId,
  ProjectIllustrationRegistry
} from "@/browser-projects/project-illustrations";
import { BrowserProjectService } from "@/browser-projects/project-service";
import { createBrowserProjectRepositories } from "@/browser-projects/repository-factory";
import { buildBrowserAnalysis } from "@/browser-projects/browser-analysis";
import { projectDisplayStatus } from "@/browser-projects/project-status";
import type { BrowserProcessingRun } from "@/browser-projects/types";

const databases: BrowserProjectDatabase[] = [];

function createService() {
  const database = new BrowserProjectDatabase(
    new IDBFactory(),
    `spt-test-${crypto.randomUUID()}`
  );
  databases.push(database);
  return {
    database,
    service: new BrowserProjectService(
      createBrowserProjectRepositories(database)
    )
  };
}

function pdf(name: string, lines: string[] = []) {
  const escapedLines = lines.map((line) => line.replace(/([()\\])/g, "\\$1"));
  const stream = [
    "BT",
    "/F1 11 Tf",
    "46 790 Td",
    ...escapedLines.flatMap((line, index) =>
      index === 0 ? [`(${line}) Tj`] : ["0 -18 Td", `(${line}) Tj`]
    ),
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([body], name, { type: "application/pdf" });
}

const basisLines = [
  "Angebotsaufforderung",
  "LV-Daten LV-Bezeichnung LV-Nummer 24-07 H",
  "Position 1.1.10. Pumpe Menge 2 St"
];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("browser-local project repositories", () => {
  it("persists the complete project-directory metadata", async () => {
    const { service } = createService();
    const project = await service.createProject({
      name: "Musterprojekt",
      address: "Musterstraße 1, 70173 Stuttgart",
      engineeringOffice: "Ingenieurbüro Muster",
      architectureOffice: "Architektur Muster",
      description: "Sanitär und Heizung"
    });

    expect(await service.getProject(project.projectId)).toMatchObject({
      name: "Musterprojekt",
      address: "Musterstraße 1, 70173 Stuttgart",
      engineeringOffice: "Ingenieurbüro Muster",
      architectureOffice: "Architektur Muster",
      objectDescription: "Sanitär und Heizung"
    });
    expect(await service.listProjects()).toHaveLength(1);
  });

  it("creates, autosaves, renames and keeps a stable illustration", async () => {
    const { service } = createService();
    const project = await service.createProject("Projekt A", "Haus 1");
    const illustrationId = project.illustrationId;

    await service.updateProject(project.projectId, {
      objectDescription: "Haus 2"
    });
    const renamed = await service.renameProject(project.projectId, "Projekt Neu");

    expect(renamed.name).toBe("Projekt Neu");
    expect(renamed.objectDescription).toBe("Haus 2");
    expect(renamed.illustrationId).toBe(illustrationId);
    expect(assignProjectIllustrationId(project.projectId)).toBe(
      assignProjectIllustrationId(project.projectId)
    );
    expect(
      ProjectIllustrationRegistry.some((entry) => entry.id === illustrationId)
    ).toBe(true);
  });

  it("keeps projects, documents, selections and workspaces isolated", async () => {
    const { service } = createService();
    const a = await service.createProject("A");
    const b = await service.createProject("B");
    await service.addFiles(a.projectId, [
      pdf("basis-lv-a.pdf", ["Position 1.1.10 Pumpe 1 St"])
    ]);
    await service.saveSelection({
      projectId: a.projectId,
      positionId: "position-a",
      selectedSupplierOptionId: "option-a",
      selectedLineIds: ["line-a"],
      comment: "lokal",
      updatedAt: new Date().toISOString()
    });
    await service.saveWorkspace({
      projectId: a.projectId,
      state: { search: "Pumpe" },
      updatedAt: new Date().toISOString()
    });

    expect(await service.listDocuments(b.projectId)).toEqual([]);
    expect(await service.listSelections(b.projectId)).toEqual([]);
    expect(await service.getWorkspace(b.projectId)).toBeNull();
    expect(await service.listSelections(a.projectId)).toHaveLength(1);
  });

  it("persists PDF blobs, page count and classification metadata", async () => {
    const { service } = createService();
    const project = await service.createProject("PDF");
    const result = await service.addFiles(project.projectId, [
      pdf("basis-lv.pdf", basisLines)
    ]);
    const document = result.items[0]?.document;
    expect(document).toBeDefined();
    if (!document) throw new Error("Expected uploaded document");

    const stored = await service.getDocumentBlob(
      project.projectId,
      document.documentId
    );
    expect(await stored?.text()).toContain("%PDF-1.4");
    expect(document.pageCount).toBe(1);
    expect(document.documentType).toBe("BASIS_LV");
    expect(document.classificationConfidence).toBe("HIGH");
  });

  it("reports duplicate PDFs per file and rejects quota overflow without losing prior data", async () => {
    const { service } = createService();
    const project = await service.createProject("Quota");
    const source = pdf("basis-lv.pdf");
    await service.addFiles(project.projectId, [source]);
    const duplicate = await service.addFiles(project.projectId, [source]);
    expect(duplicate.items[0]).toMatchObject({
      status: "DUPLICATE",
      fileName: "basis-lv.pdf"
    });
    const rejected = await service.addFiles(
      project.projectId,
      [pdf("large.pdf")],
      {
        maxFiles: 10,
        maxFileBytes: 1,
        maxTotalBytes: 10_000,
        maxTotalPages: 10
      }
    );
    expect(rejected.items[0]).toMatchObject({
      status: "REJECTED",
      message: "FILE_TOO_LARGE"
    });
    expect(await service.listDocuments(project.projectId)).toHaveLength(1);
  });

  it("partially accepts an incoming batch containing an exact duplicate", async () => {
    const { service } = createService();
    const project = await service.createProject("Batch");
    const source = pdf("basis-lv.pdf", basisLines);
    const result = await service.addFiles(project.projectId, [
      source,
      new File([await source.arrayBuffer()], "copy.pdf", {
        type: "application/pdf"
      })
    ]);
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(await service.listDocuments(project.projectId)).toHaveLength(1);
  });

  it("persists processing checkpoints", async () => {
    const { service } = createService();
    const project = await service.createProject("Run");
    const now = new Date().toISOString();
    const run: BrowserProcessingRun = {
      projectId: project.projectId,
      runId: crypto.randomUUID(),
      status: "RUNNING",
      failureCode: null,
      warnings: [],
      startedAt: now,
      updatedAt: now,
      checkpoint: {
        runId: "run",
        stage: "MATCH",
        completedStages: ["CLASSIFY_DOCUMENTS", "EXTRACT_BASIS"],
        processedPages: 2,
        totalPages: 4,
        currentDocumentId: "doc",
        currentPage: 2,
        interrupted: false,
        updatedAt: now
      }
    };
    await service.saveProcessingRun(run);
    expect(await service.currentProcessingRun(project.projectId)).toEqual(run);
  });

  it("duplicates and transactionally deletes project-owned records", async () => {
    const { service } = createService();
    const source = await service.createProject("Original");
    await service.addFiles(source.projectId, [pdf("basis-lv.pdf")]);
    const copy = await service.duplicateProject(source.projectId);

    expect(copy.projectId).not.toBe(source.projectId);
    expect(copy.name).toBe("Kopie von Original");
    expect(copy.illustrationId).toBe(assignProjectIllustrationId(copy.projectId));
    const copiedDocuments = await service.listDocuments(copy.projectId);
    expect(copiedDocuments).toHaveLength(1);
    expect(
      await service.getDocumentBlob(copy.projectId, copiedDocuments[0].documentId)
    ).not.toBeNull();

    await service.deleteProject(source.projectId);
    expect(await service.getProject(source.projectId)).toBeNull();
    expect(await service.listDocuments(source.projectId)).toEqual([]);
    expect(await service.getProject(copy.projectId)).not.toBeNull();
  });

  it("backs up and restores blobs, metadata, workspace and illustration", async () => {
    const { service } = createService();
    const source = await service.createProject("Backup");
    await service.addFiles(source.projectId, [pdf("basis-lv.pdf")]);
    await service.saveWorkspace({
      projectId: source.projectId,
      state: { page: 2 },
      updatedAt: new Date().toISOString()
    });
    const backup = await service.backupProject(source.projectId);
    const inspected = await service.inspectBackup(backup);
    expect(inspected.summary).toMatchObject({
      projectName: "Backup",
      documentCount: 1,
      checksumStatus: "VALID"
    });
    const restored = await service.restoreProject(backup);

    expect(restored.projectId).not.toBe(source.projectId);
    expect(restored.illustrationId).toBe(source.illustrationId);
    expect(await service.listDocuments(restored.projectId)).toHaveLength(1);
    expect((await service.getWorkspace(restored.projectId))?.state).toEqual({
      page: 2
    });
  });

  it("rejects a corrupt backup", async () => {
    const { service } = createService();
    await expect(
      service.restoreProject(new Blob(["not-json"]))
    ).rejects.toThrow("CORRUPT_PROJECT_BACKUP");
  });

  it("rejects non-PDF backup blobs even when their checksum is valid", async () => {
    const { service } = createService();
    const source = await service.createProject("Backup");
    await service.addFiles(source.projectId, [pdf("basis-lv.pdf")]);
    const valid = JSON.parse(await (await service.backupProject(source.projectId)).text());
    valid.documentBlobs[0].mimeType = "text/html";

    await expect(
      service.inspectBackup(new Blob([JSON.stringify(valid)]))
    ).rejects.toThrow("INVALID_PROJECT_BACKUP");
  });

  it("rejects duplicate document links in a backup", async () => {
    const { service } = createService();
    const source = await service.createProject("Backup");
    await service.addFiles(source.projectId, [pdf("basis-lv.pdf")]);
    const valid = JSON.parse(await (await service.backupProject(source.projectId)).text());
    valid.documents.push(valid.documents[0]);
    valid.documentBlobs.push(valid.documentBlobs[0]);
    valid.manifest.documentCount = 2;

    await expect(
      service.inspectBackup(new Blob([JSON.stringify(valid)]))
    ).rejects.toThrow("INVALID_PROJECT_BACKUP");
  });

  it("rejects malformed files that only imitate the PDF header", async () => {
    const { service } = createService();
    const source = await service.createProject("Malformed");
    const result = await service.addFiles(source.projectId, [
      new File(["%PDF-not-a-real-pdf"], "broken.pdf", {
        type: "application/pdf"
      })
    ]);

    expect(result.items).toMatchObject([
      { status: "REJECTED", message: "INVALID_PDF" }
    ]);
    expect(await service.listDocuments(source.projectId)).toEqual([]);
  });

  it("creates the complete migrated IndexedDB schema", async () => {
    const { database } = createService();
    const opened = await database.open();
    expect(opened.version).toBe(BROWSER_DATABASE_VERSION);
    expect(Array.from(opened.objectStoreNames)).toEqual(
      expect.arrayContaining([...BROWSER_STORES])
    );
  });

  it("removes blobs, clears the active Basis and invalidates analysis metrics", async () => {
    const { service } = createService();
    const project = await service.createProject("Remove");
    const added = await service.addFiles(project.projectId, [
      pdf("basis-lv.pdf", [...basisLines, "Heizungsinstallation"])
    ]);
    const document = added.documents[0];
    expect(document.activeBasis).toBe(true);
    await service.removeDocument(project.projectId, document.documentId);
    expect(
      await service.getDocumentBlob(project.projectId, document.documentId)
    ).toBeNull();
    expect(await service.listDocuments(project.projectId)).toEqual([]);
    expect(await service.getProject(project.projectId)).toMatchObject({
      documentCount: 0,
      basisPositionCount: 0,
      activeAnalysisVersionId: null
    });
  });

  it("replaces a document in its logical slot and recalculates its hash", async () => {
    const { service } = createService();
    const project = await service.createProject("Replace");
    const added = await service.addFiles(project.projectId, [
      pdf("basis-lv.pdf", [...basisLines, "Heizungsinstallation"])
    ]);
    const original = added.documents[0];
    const replacement = await service.replaceDocument(
      project.projectId,
      original.documentId,
      pdf("basis-neu.pdf", [
        ...basisLines,
        "Heizungsinstallation",
        "Position 1.1.20. Ventil Menge 1 St"
      ])
    );
    expect(replacement.documentId).toBe(original.documentId);
    expect(replacement.sha256).not.toBe(original.sha256);
    expect(replacement.originalFileName).toBe("basis-neu.pdf");
    expect(await service.listDocuments(project.projectId)).toHaveLength(1);
  });

  it("blocks processing when an obvious supplier offer is manually assigned as Basis", async () => {
    const { service } = createService();
    const project = await service.createProject("Invalid Basis");
    const added = await service.addFiles(project.projectId, [
      pdf("P&M-Angebot.pdf", [
        "Pfeiffer & May Angebot Nr. 591528-1 Version 2",
        "E-Preis Gesamtpreis LV.Pos.",
        "Heizungsinstallation Wärmepumpe"
      ])
    ]);
    const supplier = added.documents[0];
    await service.updateDocument(project.projectId, supplier.documentId, {
      documentType: "BASIS_LV",
      activeBasis: true,
      manualRoleOverride: true
    });
    const preflight = await service.processingPreflight(
      project.projectId,
      "HEIZUNG"
    );
    expect(preflight.valid).toBe(false);
    expect(preflight.blockingReasons.join(" ")).toContain(
      "strukturelle Basis-Prüfung"
    );
  });

  it("forbids a READY analysis when extraction produced zero Basis positions", async () => {
    const { service } = createService();
    const project = await service.createProject("Zero");
    const added = await service.addFiles(project.projectId, [
      pdf("basis-lv.pdf", [...basisLines, "Heizungsinstallation"])
    ]);
    await expect(() =>
      buildBrowserAnalysis({
        projectId: project.projectId,
        documents: added.documents,
        result: {
          basisLines: [],
          supplierLines: [],
          warnings: [],
          diagnostics: {
            pagesInspected: 1,
            pagesParsed: 0,
            ocrRequiredPages: 0,
            matchingCandidates: 0
          }
        }
      })
    ).toThrow("FAILED_NO_BASIS_POSITIONS");
  });

  it("does not display READY for a project with zero Basis positions", async () => {
    const { service } = createService();
    const project = await service.createProject("Invariant");
    const invalid = {
      ...project,
      status: "BEREIT" as const,
      basisPositionCount: 0
    };
    expect(projectDisplayStatus(invalid)).toBe("PRÜFUNG_ERFORDERLICH");
    expect(
      projectDisplayStatus({
        ...invalid,
        processingFailureCode: "FAILED_NO_BASIS_POSITIONS"
      })
    ).toBe("FEHLER");
  });
});
