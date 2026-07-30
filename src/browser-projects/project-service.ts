import {
  assignProjectIllustrationId
} from "@/browser-projects/project-illustrations";
import { getBrowserProjectRepositories } from "@/browser-projects/repository-factory";
import type { ProjectRepositories } from "@/browser-projects/repositories";
import {
  BROWSER_PROJECT_SCHEMA_VERSION,
  type BrowserAnalysisSnapshot,
  type BrowserDiscipline,
  type BrowserDocumentRecord,
  type BrowserProjectBackup,
  type BrowserProjectRecord
} from "@/browser-projects/types";
import {
  applyAutomaticBasisSelection,
  classifyBrowserDocumentContent,
  isStructurallyPlausibleBasis,
  reconcileDocumentRelations
} from "@/browser-projects/document-classification";
import { inspectBrowserPdf } from "@/browser-projects/pdf-inspection";

export type BrowserUploadLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxTotalPages: number;
};

export const DEFAULT_BROWSER_UPLOAD_LIMITS: BrowserUploadLimits = {
  maxFiles: 30,
  maxTotalBytes: 300 * 1024 * 1024,
  maxFileBytes: 60 * 1024 * 1024,
  maxTotalPages: 2_000
};

function id(): string {
  return crypto.randomUUID();
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function classifyBrowserDocument(input: {
  fileName: string;
  text: string;
}) {
  return classifyBrowserDocumentContent({
    fileName: input.fileName,
    inspection: {
      pageCount: 1,
      metadata: {},
      text: input.text,
      textLayerCharacterCount: input.text.replace(/\s+/g, "").length,
      inspectedPageCount: 1,
      pagesWithText: input.text.trim() ? 1 : 0
    }
  });
}

export type BrowserUploadItemResult = {
  fileName: string;
  status: "ADDED" | "DUPLICATE" | "OCR_REQUIRED" | "REJECTED";
  document: BrowserDocumentRecord | null;
  existingDocumentId: string | null;
  message: string;
};

export type BrowserBatchUploadResult = {
  selected: number;
  added: number;
  duplicates: number;
  ocrRequired: number;
  rejected: number;
  items: BrowserUploadItemResult[];
  documents: BrowserDocumentRecord[];
};

export type BrowserProcessingPreflight = {
  valid: boolean;
  discipline: BrowserDiscipline;
  activeBasisDocumentId: string | null;
  blockingReasons: string[];
  warnings: string[];
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function documentFromFile(
  projectId: string,
  file: File,
  documentId = id()
): Promise<{ document: BrowserDocumentRecord; bytes: Uint8Array }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (
    file.type !== "application/pdf" ||
    new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-"
  ) {
    throw new Error("UNSUPPORTED_PDF");
  }
  const [checksum, inspection] = await Promise.all([
    sha256(buffer),
    inspectBrowserPdf(bytes)
  ]);
  const classification = classifyBrowserDocumentContent({
    fileName: file.name,
    inspection
  });
  return {
    bytes,
    document: {
      projectId,
      documentId,
      originalFileName: file.name,
      mimeType: file.type,
      size: file.size,
      sha256: checksum,
      uploadedAt: new Date().toISOString(),
      pageCount: inspection.pageCount,
      detectedDocumentType: classification.detectedDocumentType,
      documentType: classification.documentType,
      discipline: classification.discipline,
      supplierName: classification.supplierName,
      offerNumber: classification.offerNumber,
      documentVersion: classification.documentVersion,
      revision: classification.revision,
      revisionOfDocumentId: classification.revisionOfDocumentId,
      relationType: classification.relationType,
      scanState: classification.scanState,
      projectName: classification.projectName,
      projectNumber: classification.projectNumber,
      lvNumber: classification.lvNumber,
      classificationDimensions: classification.dimensions,
      classificationSignals: classification.signals,
      textLayerCharacterCount: inspection.textLayerCharacterCount,
      preliminaryPositionCount: classification.preliminaryPositionCount,
      activeBasis: false,
      excludedFromProcessing: false,
      manualRoleOverride: false,
      manualBasisOverrideConfirmed: false,
      classificationConfidence: classification.confidence,
      classificationWarnings: classification.warnings,
      processingStatus:
        classification.documentType === "SCAN_OCR_REQUIRED"
          ? "PRÜFUNG_ERFORDERLICH"
          : classification.confidence === "LOW"
            ? "PRÜFUNG_ERFORDERLICH"
            : "BEREIT"
    }
  };
}

export class BrowserProjectService {
  constructor(private readonly repositories: ProjectRepositories) {}

  listProjects() {
    return this.repositories.projects.list();
  }

  getProject(projectId: string) {
    return this.repositories.projects.get(projectId);
  }

  async createProject(name: string, objectDescription = "") {
    const now = new Date().toISOString();
    const projectId = id();
    const project: BrowserProjectRecord = {
      projectId,
      name: name.trim(),
      objectDescription: objectDescription.trim(),
      illustrationId: assignProjectIllustrationId(projectId),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      lastRoute: "PROJECT_DOCUMENTS",
      lastPositionId: null,
      status: "ENTWURF",
      schemaVersion: BROWSER_PROJECT_SCHEMA_VERSION,
      activeAnalysisVersionId: null,
      processingCheckpoint: null,
      documentCount: 0,
      basisPositionCount: 0,
      supplierOfferCount: 0,
      processingFailureCode: null,
      activeDiscipline: null
    };
    if (!project.name) throw new Error("PROJECT_NAME_REQUIRED");
    await this.repositories.projects.save(project);
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => false);
    }
    return project;
  }

  async updateProject(
    projectId: string,
    update: Partial<
      Pick<
        BrowserProjectRecord,
        | "name"
        | "objectDescription"
        | "lastOpenedAt"
        | "lastRoute"
        | "lastPositionId"
        | "status"
        | "activeAnalysisVersionId"
        | "processingCheckpoint"
        | "basisPositionCount"
        | "supplierOfferCount"
        | "documentCount"
        | "processingFailureCode"
        | "activeDiscipline"
      >
    >
  ) {
    const current = await this.repositories.projects.get(projectId);
    if (!current) throw new Error("PROJECT_NOT_FOUND");
    const next = {
      ...current,
      ...update,
      name: update.name?.trim() ?? current.name,
      updatedAt: new Date().toISOString()
    };
    if (!next.name) throw new Error("PROJECT_NAME_REQUIRED");
    await this.repositories.projects.save(next);
    return next;
  }

  renameProject(projectId: string, name: string) {
    return this.updateProject(projectId, { name });
  }

  async openProject(projectId: string) {
    return this.updateProject(projectId, {
      lastOpenedAt: new Date().toISOString()
    });
  }

  async addFiles(
    projectId: string,
    files: readonly File[],
    limits: BrowserUploadLimits = DEFAULT_BROWSER_UPLOAD_LIMITS
  ): Promise<BrowserBatchUploadResult> {
    const project = await this.repositories.projects.get(projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const existing = await this.repositories.documents.list(projectId);
    const records: BrowserDocumentRecord[] = [];
    const items: BrowserUploadItemResult[] = [];
    let accumulatedBytes = existing.reduce((sum, item) => sum + item.size, 0);
    let accumulatedPages = existing.reduce(
      (sum, item) => sum + item.pageCount,
      0
    );

    for (const file of files) {
      try {
        if (existing.length + records.length >= limits.maxFiles) {
          throw new Error("TOO_MANY_FILES");
        }
        if (file.size > limits.maxFileBytes) throw new Error("FILE_TOO_LARGE");
        if (accumulatedBytes + file.size > limits.maxTotalBytes) {
          throw new Error("NOT_ENOUGH_BROWSER_STORAGE");
        }
        const prepared = await documentFromFile(projectId, file);
        const duplicate = [...existing, ...records].find(
          (item) => item.sha256 === prepared.document.sha256
        );
        if (duplicate) {
          items.push({
            fileName: file.name,
            status: "DUPLICATE",
            document: null,
            existingDocumentId: duplicate.documentId,
            message: "Identische Datei erkannt. Die PDF ist bereits vorhanden."
          });
          continue;
        }
        if (
          accumulatedPages + prepared.document.pageCount >
          limits.maxTotalPages
        ) {
          throw new Error("TOO_MANY_PAGES");
        }
        await this.repositories.documentBlobs.save({
          projectId,
          documentId: prepared.document.documentId,
          blob: file
        });
        await this.repositories.documents.save(prepared.document);
        records.push(prepared.document);
        accumulatedBytes += file.size;
        accumulatedPages += prepared.document.pageCount;
        const ocrRequired =
          prepared.document.documentType === "SCAN_OCR_REQUIRED";
        items.push({
          fileName: file.name,
          status: ocrRequired ? "OCR_REQUIRED" : "ADDED",
          document: prepared.document,
          existingDocumentId: null,
          message: ocrRequired
            ? "Scan erkannt. OCR erforderlich."
            : "Datei hinzugefügt."
        });
      } catch (storageError) {
        const message =
          storageError instanceof DOMException &&
          storageError.name === "QuotaExceededError"
            ? "NOT_ENOUGH_BROWSER_STORAGE"
            : storageError instanceof Error
              ? storageError.message
              : "UPLOAD_FAILED";
        items.push({
          fileName: file.name,
          status: "REJECTED",
          document: null,
          existingDocumentId: null,
          message
        });
      }
    }

    const documents = applyAutomaticBasisSelection(
      reconcileDocumentRelations([...existing, ...records])
    );
    await Promise.all(
      documents.map((document) => this.repositories.documents.save(document))
    );
    await this.repositories.projects.save({
      ...project,
      documentCount: documents.length,
      supplierOfferCount: documents.filter(
        (item) =>
          item.documentType === "SUPPLIER_OFFER" ||
          item.documentType === "MANUFACTURER_OFFER"
      ).length,
      status: documents.some(
        (item) =>
          item.processingStatus === "PRÜFUNG_ERFORDERLICH" &&
          item.documentType !== "SCAN_OCR_REQUIRED"
      )
        ? "PRÜFUNG_ERFORDERLICH"
        : "DOKUMENTE_GELADEN",
      lastRoute: "DOCUMENT_REVIEW",
      processingFailureCode: null,
      updatedAt: new Date().toISOString()
    });
    return {
      selected: files.length,
      added: items.filter((item) => item.status === "ADDED").length,
      duplicates: items.filter((item) => item.status === "DUPLICATE").length,
      ocrRequired: items.filter((item) => item.status === "OCR_REQUIRED").length,
      rejected: items.filter((item) => item.status === "REJECTED").length,
      items,
      documents
    };
  }

  listDocuments(projectId: string) {
    return this.repositories.documents.list(projectId);
  }

  getDocumentBlob(projectId: string, documentId: string) {
    return this.repositories.documentBlobs.get(projectId, documentId);
  }

  latestAnalysis(projectId: string) {
    return this.repositories.analyses.latest(projectId);
  }

  saveAnalysis(snapshot: BrowserAnalysisSnapshot) {
    return this.repositories.analyses.save(snapshot);
  }

  currentProcessingRun(projectId: string) {
    return this.repositories.processingRuns.current(projectId);
  }

  saveProcessingRun(
    run: Parameters<ProjectRepositories["processingRuns"]["save"]>[0]
  ) {
    return this.repositories.processingRuns.save(run);
  }

  listSelections(projectId: string) {
    return this.repositories.selections.list(projectId);
  }

  saveSelection(
    selection: Parameters<ProjectRepositories["selections"]["save"]>[0]
  ) {
    return this.repositories.selections.save(selection);
  }

  getWorkspace(projectId: string) {
    return this.repositories.workspaces.get(projectId);
  }

  saveWorkspace(
    workspace: Parameters<ProjectRepositories["workspaces"]["save"]>[0]
  ) {
    return this.repositories.workspaces.save(workspace);
  }

  async updateDocument(
    projectId: string,
    documentId: string,
    update: Partial<
      Pick<
        BrowserDocumentRecord,
        | "documentType"
        | "discipline"
        | "supplierName"
        | "offerNumber"
        | "documentVersion"
        | "revision"
        | "revisionOfDocumentId"
        | "relationType"
        | "activeBasis"
        | "excludedFromProcessing"
        | "manualRoleOverride"
        | "manualBasisOverrideConfirmed"
        | "classificationConfidence"
        | "classificationWarnings"
        | "processingStatus"
      >
    >
  ) {
    const document = await this.repositories.documents.get(projectId, documentId);
    if (!document) throw new Error("DOCUMENT_NOT_FOUND");
    const next = {
      ...document,
      ...update,
      manualRoleOverride:
        update.documentType !== undefined &&
        update.documentType !== document.detectedDocumentType
          ? true
          : update.manualRoleOverride ?? document.manualRoleOverride
    };
    const documents = applyAutomaticBasisSelection(
      reconcileDocumentRelations(
        (await this.repositories.documents.list(projectId)).map((current) =>
          current.documentId === documentId ? next : current
        )
      )
    );
    await Promise.all(
      documents.map((current) => this.repositories.documents.save(current))
    );
    return documents.find((current) => current.documentId === documentId)!;
  }

  async replaceDocument(
    projectId: string,
    documentId: string,
    file: File
  ): Promise<BrowserDocumentRecord> {
    const current = await this.repositories.documents.get(projectId, documentId);
    if (!current) throw new Error("DOCUMENT_NOT_FOUND");
    const prepared = await documentFromFile(projectId, file, documentId);
    const documents = await this.repositories.documents.list(projectId);
    if (
      documents.some(
        (document) =>
          document.documentId !== documentId &&
          document.sha256 === prepared.document.sha256
      )
    ) {
      throw new Error("DUPLICATE_PDF");
    }
    await this.repositories.documentBlobs.save({
      projectId,
      documentId,
      blob: file
    });
    await this.repositories.documents.save(prepared.document);
    const reconciled = applyAutomaticBasisSelection(
      reconcileDocumentRelations(
        documents.map((document) =>
          document.documentId === documentId ? prepared.document : document
        )
      )
    );
    await Promise.all(
      reconciled.map((document) => this.repositories.documents.save(document))
    );
    await this.updateProject(projectId, {
      activeAnalysisVersionId: null,
      basisPositionCount: 0,
      status: "PRÜFUNG_ERFORDERLICH",
      lastRoute: "DOCUMENT_REVIEW",
      processingFailureCode: null
    });
    return reconciled.find((document) => document.documentId === documentId)!;
  }

  async selectActiveBasis(projectId: string, documentId: string) {
    const documents = await this.repositories.documents.list(projectId);
    const selected = documents.find(
      (document) => document.documentId === documentId
    );
    if (!selected || selected.documentType !== "BASIS_LV") {
      throw new Error("BASIS_DOCUMENT_REQUIRED");
    }
    const next = documents.map((document) => ({
      ...document,
      activeBasis:
        document.discipline === selected.discipline
          ? document.documentId === documentId
          : document.activeBasis
    }));
    await Promise.all(
      next.map((document) => this.repositories.documents.save(document))
    );
    return selected;
  }

  async processingPreflight(
    projectId: string,
    discipline: BrowserDiscipline
  ): Promise<BrowserProcessingPreflight> {
    const documents = (await this.repositories.documents.list(projectId)).filter(
      (document) => !document.excludedFromProcessing
    );
    const relevant = documents.filter(
      (document) =>
        document.discipline === discipline ||
        document.discipline === "MULTI" ||
        (discipline === "SANITAER" &&
          document.discipline === "INSTALLATIONSSYSTEME")
    );
    const bases = relevant.filter(
      (document) => document.documentType === "BASIS_LV" && document.activeBasis
    );
    const blockingReasons: string[] = [];
    const warnings: string[] = [];
    if (bases.length !== 1) {
      blockingReasons.push(
        bases.length === 0
          ? "Kein aktives Basis-LV für die gewählte Disziplin."
          : "Mehr als ein aktives Basis-LV für die gewählte Disziplin."
      );
    }
    const basis = bases[0];
    if (
      basis &&
      !isStructurallyPlausibleBasis(basis) &&
      !basis.manualBasisOverrideConfirmed
    ) {
      blockingReasons.push(
        "Das aktive Basis-LV besteht die strukturelle Basis-Prüfung nicht."
      );
    }
    if (basis && basis.preliminaryPositionCount === 0) {
      blockingReasons.push(
        "Im Basis-LV wurde keine vorläufige Positionsstruktur erkannt."
      );
    }
    for (const document of relevant) {
      const blob = await this.repositories.documentBlobs.get(
        projectId,
        document.documentId
      );
      if (!blob) {
        blockingReasons.push(`PDF-Datei fehlt: ${document.originalFileName}`);
      }
      if (
        document.documentType === "UNKNOWN" ||
        (document.classificationConfidence === "LOW" &&
          document.documentType !== "SCAN_OCR_REQUIRED")
      ) {
        blockingReasons.push(
          `Offene Dokumentzuordnung: ${document.originalFileName}`
        );
      }
      if (document.documentType === "SCAN_OCR_REQUIRED") {
        warnings.push(
          `${document.originalFileName}: OCR ausstehend, im aktuellen Lauf ausgeschlossen.`
        );
      }
    }
    return {
      valid: blockingReasons.length === 0,
      discipline,
      activeBasisDocumentId: basis?.documentId ?? null,
      blockingReasons,
      warnings
    };
  }

  async removeDocument(projectId: string, documentId: string) {
    const removed = await this.repositories.documents.get(projectId, documentId);
    await Promise.all([
      this.repositories.documents.delete(projectId, documentId),
      this.repositories.documentBlobs.delete(projectId, documentId)
    ]);
    const documents = applyAutomaticBasisSelection(
      reconcileDocumentRelations(
        await this.repositories.documents.list(projectId)
      )
    );
    await Promise.all(
      documents.map((document) => this.repositories.documents.save(document))
    );
    await this.updateProject(projectId, {
      status: documents.length ? "DOKUMENTE_GELADEN" : "ENTWURF",
      activeAnalysisVersionId: null,
      basisPositionCount: 0,
      supplierOfferCount: documents.filter(
        (item) =>
          item.documentType === "SUPPLIER_OFFER" ||
          item.documentType === "MANUFACTURER_OFFER"
      ).length,
      documentCount: documents.length,
      lastRoute: "DOCUMENT_REVIEW",
      processingFailureCode: null
    });
    return {
      removed,
      invalidatedAnalysis: Boolean(removed)
    };
  }

  async duplicateProject(projectId: string) {
    const source = await this.repositories.projects.get(projectId);
    if (!source) throw new Error("PROJECT_NOT_FOUND");
    const duplicate = await this.createProject(
      `Kopie von ${source.name}`,
      source.objectDescription
    );
    try {
      const documents = await this.repositories.documents.list(projectId);
      for (const document of documents) {
        const blob = await this.repositories.documentBlobs.get(
          projectId,
          document.documentId
        );
        if (!blob) throw new Error("DOCUMENT_BLOB_MISSING");
        await this.repositories.documents.save({
          ...structuredClone(document),
          projectId: duplicate.projectId
        });
        await this.repositories.documentBlobs.save({
          projectId: duplicate.projectId,
          documentId: document.documentId,
          blob
        });
      }
      const snapshots = await this.repositories.analyses.list(projectId);
      for (const snapshot of snapshots) {
        await this.repositories.analyses.save({
          ...structuredClone(snapshot),
          projectId: duplicate.projectId,
          pilot: {
            ...structuredClone(snapshot.pilot),
            projectReview: {
              ...structuredClone(snapshot.pilot.projectReview),
              projectId: duplicate.projectId
            }
          }
        });
      }
      const selections = await this.repositories.selections.list(projectId);
      for (const selection of selections) {
        await this.repositories.selections.save({
          ...structuredClone(selection),
          projectId: duplicate.projectId
        });
      }
      const workspace = await this.repositories.workspaces.get(projectId);
      if (workspace) {
        await this.repositories.workspaces.save({
          ...structuredClone(workspace),
          projectId: duplicate.projectId
        });
      }
      const finalProject: BrowserProjectRecord = {
        ...duplicate,
        status: source.status,
        lastRoute: documents.length ? "DOCUMENT_REVIEW" : "PROJECT_DOCUMENTS",
        activeAnalysisVersionId: source.activeAnalysisVersionId,
        basisPositionCount: source.basisPositionCount,
        supplierOfferCount: source.supplierOfferCount,
        documentCount: documents.length,
        processingFailureCode: source.processingFailureCode,
        updatedAt: new Date().toISOString()
      };
      await this.repositories.projects.save(finalProject);
      return finalProject;
    } catch (error) {
      await this.repositories.projects.delete(duplicate.projectId);
      throw error;
    }
  }

  deleteProject(projectId: string) {
    return this.repositories.projects.delete(projectId);
  }

  async backupProject(projectId: string): Promise<Blob> {
    const project = await this.repositories.projects.get(projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const documents = await this.repositories.documents.list(projectId);
    const documentBlobs: BrowserProjectBackup["documentBlobs"] = [];
    const checksums: Record<string, string> = {};
    for (const document of documents) {
      const blob = await this.repositories.documentBlobs.get(
        projectId,
        document.documentId
      );
      if (!blob) throw new Error("DOCUMENT_BLOB_MISSING");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const digest = await sha256(bytes.buffer);
      checksums[document.documentId] = digest;
      documentBlobs.push({
        documentId: document.documentId,
        mimeType: document.mimeType,
        base64: bytesToBase64(bytes)
      });
    }
    const backup: BrowserProjectBackup = {
      format: "spt-project",
      schemaVersion: BROWSER_PROJECT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      manifest: {
        projectId,
        name: project.name,
        documentCount: documents.length,
        basisPositionCount: project.basisPositionCount,
        offerCount: project.supplierOfferCount,
        totalSize: documents.reduce((sum, document) => sum + document.size, 0),
        checksums
      },
      project,
      documents,
      documentBlobs,
      analysisSnapshots: await this.repositories.analyses.list(projectId),
      selections: await this.repositories.selections.list(projectId),
      workspace: await this.repositories.workspaces.get(projectId)
    };
    return new Blob([JSON.stringify(backup)], {
      type: "application/vnd.smart-procurement.project+json"
    });
  }

  async inspectBackup(file: Blob) {
    let backup: BrowserProjectBackup;
    try {
      backup = JSON.parse(await file.text()) as BrowserProjectBackup;
    } catch {
      throw new Error("CORRUPT_PROJECT_BACKUP");
    }
    if (
      backup.format !== "spt-project" ||
      backup.schemaVersion !== BROWSER_PROJECT_SCHEMA_VERSION ||
      backup.documents.length !== backup.manifest.documentCount ||
      backup.documentBlobs.length !== backup.documents.length
    ) {
      throw new Error("INVALID_PROJECT_BACKUP");
    }
    for (const item of backup.documentBlobs) {
      const bytes = base64ToBytes(item.base64);
      const buffer = Uint8Array.from(bytes).buffer;
      if ((await sha256(buffer)) !== backup.manifest.checksums[item.documentId]) {
        throw new Error("PROJECT_BACKUP_CHECKSUM_MISMATCH");
      }
    }
    return {
      backup,
      summary: {
        projectName: backup.manifest.name,
        schemaVersion: backup.schemaVersion,
        documentCount: backup.manifest.documentCount,
        basisPositionCount:
          backup.manifest.basisPositionCount ??
          backup.project.basisPositionCount ??
          0,
        offerCount:
          backup.manifest.offerCount ??
          backup.project.supplierOfferCount ??
          0,
        exportedAt: backup.exportedAt,
        totalSize:
          backup.manifest.totalSize ??
          backup.documents.reduce((sum, document) => sum + document.size, 0),
        checksumStatus: "VALID" as const
      }
    };
  }

  async restoreProject(file: Blob) {
    const { backup } = await this.inspectBackup(file);
    const projectId = id();
    const now = new Date().toISOString();
    const project: BrowserProjectRecord = {
      ...backup.project,
      projectId,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      lastRoute: backup.documents.length ? "DOCUMENT_REVIEW" : "PROJECT_DOCUMENTS",
      processingFailureCode: backup.project.processingFailureCode ?? null
    };
    try {
      await this.repositories.projects.save(project);
      for (const document of backup.documents) {
        await this.repositories.documents.save({ ...document, projectId });
        const blob = backup.documentBlobs.find(
          (candidate) => candidate.documentId === document.documentId
        );
        if (!blob) throw new Error("DOCUMENT_BLOB_MISSING");
        const bytes = Uint8Array.from(base64ToBytes(blob.base64));
        await this.repositories.documentBlobs.save({
          projectId,
          documentId: document.documentId,
          blob: new Blob([bytes.buffer], { type: blob.mimeType })
        });
      }
      for (const snapshot of backup.analysisSnapshots) {
        await this.repositories.analyses.save({
          ...snapshot,
          projectId,
          pilot: {
            ...snapshot.pilot,
            projectReview: { ...snapshot.pilot.projectReview, projectId }
          }
        });
      }
      for (const selection of backup.selections) {
        await this.repositories.selections.save({ ...selection, projectId });
      }
      if (backup.workspace) {
        await this.repositories.workspaces.save({
          ...backup.workspace,
          projectId
        });
      }
      return project;
    } catch (error) {
      await this.repositories.projects.delete(projectId);
      throw error;
    }
  }
}

let service: BrowserProjectService | null = null;

export function getBrowserProjectService() {
  service ??= new BrowserProjectService(getBrowserProjectRepositories());
  return service;
}
