import { assignProjectIllustrationId } from "@/browser-projects/project-illustrations";
import { getBrowserProjectRepositories } from "@/browser-projects/repository-factory";
import type { ProjectRepositories } from "@/browser-projects/repositories";
import {
  BROWSER_PROJECT_SCHEMA_VERSION,
  normalizeBrowserProjectRecord,
  type BrowserAnalysisSnapshot,
  type BrowserDiscipline,
  type BrowserDocumentRecord,
  type BrowserMatchReviewRecord,
  type BrowserProjectBackup,
  type BrowserProjectRecord
} from "@/browser-projects/types";
import { applyBrowserMatchReview, buildBrowserAnalysis } from "@/browser-projects/browser-analysis";
import {
  appendManualCorrection,
  materializeManualCorrections,
  type BrowserManualCorrectionCommand
} from "@/browser-projects/manual-corrections";
import {
  ProjectMetadataSchema,
  ProjectMetadataUpdateSchema,
  type ProjectMetadata
} from "@/domain/project-metadata";
import {
  applyAutomaticBasisSelection,
  applyFullRunDocumentClassification,
  classifyBrowserDocumentContent,
  isStructurallyPlausibleBasis,
  reconcileDocumentRelations
} from "@/browser-projects/document-classification";
import type { BrowserWorkerResult } from "@/browser-projects/processing-protocol";
import {
  inspectBrowserPdf,
  type BrowserPdfInspectionOptions
} from "@/browser-projects/pdf-inspection";
import {
  BROWSER_OCR_ENGINE_VERSION,
  BROWSER_OCR_MODEL_VERSION
} from "@/browser-projects/ocr-fallback";
import { ProjectWorkspaceStateSchema } from "@/domain/project-workspace";
import { z } from "zod";

export type BrowserUploadLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxTotalPages: number;
};

export type BrowserManualCorrectionInput = {
  projectId: string;
  analysisVersionId: string;
  expectedRevision: number;
  command: BrowserManualCorrectionCommand;
  operatorId: string;
  operatorLabel: string;
  comment: string;
  reasonCode?: "OCR_CORRECTION" | "SOURCE_REGION_CORRECTION";
};

export type BrowserManualBasisBootstrapInput = Omit<
  BrowserManualCorrectionInput,
  "analysisVersionId" | "expectedRevision" | "command"
> & {
  command: Extract<BrowserManualCorrectionCommand, { action: "ADD_BASIS_POSITION" }>;
};

export const DEFAULT_BROWSER_UPLOAD_LIMITS: BrowserUploadLimits = {
  maxFiles: 30,
  maxTotalBytes: 60 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalPages: 2_000
};

const MAX_BACKUP_FILE_BYTES = 90 * 1024 * 1024;
const MAX_BACKUP_DECODED_BYTES = DEFAULT_BROWSER_UPLOAD_LIMITS.maxTotalBytes;
const MAX_BACKUP_ANALYSES = 25;
const MAX_BACKUP_SELECTIONS = 50_000;

const nonNegativeInteger = z.number().int().nonnegative();
const optionalString = z.string().max(2_000).nullable();
const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
const archivedSelectionSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    positionId: z.string().min(1).max(200),
    selectedSupplierOptionId: z.string().min(1).max(200),
    selectedLineIds: z.array(z.string().min(1).max(200)).max(1_000),
    comment: z.string().max(2_000),
    updatedAt: z.string().max(100)
  })
  .strict();
const matchReviewSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    analysisVersionId: z.string().min(1).max(200),
    matchLinkId: z.string().min(1).max(300),
    positionId: z.string().min(1).max(300),
    decision: z.enum(["CONFIRMED", "REJECTED"]),
    operator: z.string().min(1).max(200),
    comment: z.string().max(2_000),
    updatedAt: z.string().datetime()
  })
  .strict();
const projectCheckpointSchema = z
  .object({
    runId: z.string().min(1).max(200),
    stage: z.enum([
      "CLASSIFY_DOCUMENTS",
      "EXTRACT_BASIS",
      "EXTRACT_SUPPLIERS",
      "NORMALIZE",
      "MATCH",
      "BUILD_OPTIONS",
      "VALIDATE",
      "FINALIZE"
    ]),
    completedStages: z.array(z.string().max(50)).max(8),
    processedPages: nonNegativeInteger,
    totalPages: nonNegativeInteger,
    currentDocumentId: z.string().max(200).nullable(),
    currentPage: nonNegativeInteger.nullable(),
    interrupted: z.boolean(),
    updatedAt: z.string().max(100)
  })
  .strict();

const backupProjectSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    name: z.string().min(1).max(160),
    address: z.string().max(300).optional().default(""),
    engineeringOffice: z.string().max(200).optional().default(""),
    architectureOffice: z.string().max(200).optional().default(""),
    objectDescription: z.string().max(2_000),
    illustrationId: z.string().min(1).max(200),
    createdAt: z.string().max(100),
    updatedAt: z.string().max(100),
    lastOpenedAt: z.string().max(100),
    lastRoute: z
      .enum([
        "PROJECT_DOCUMENTS",
        "DOCUMENT_REVIEW",
        "PROCESSING",
        "PROCESSING_RESULT",
        "LV_COMPARISON"
      ])
      .nullable(),
    lastPositionId: z.string().max(200).nullable(),
    status: z.enum([
      "ENTWURF",
      "DOKUMENTE_GELADEN",
      "PRÜFUNG_ERFORDERLICH",
      "IN_VERARBEITUNG",
      "BEREIT",
      "FEHLER"
    ]),
    schemaVersion: nonNegativeInteger,
    activeAnalysisVersionId: z.string().max(200).nullable(),
    processingCheckpoint: projectCheckpointSchema.nullable(),
    documentCount: nonNegativeInteger,
    basisPositionCount: nonNegativeInteger,
    supplierOfferCount: nonNegativeInteger,
    processingFailureCode: z.enum(["FAILED_NO_BASIS_POSITIONS", "PROCESSING_ERROR"]).nullable(),
    activeDiscipline: z
      .enum(["HEIZUNG", "SANITAER", "INSTALLATIONSSYSTEME", "MULTI", "UNKNOWN"])
      .nullable()
  })
  .strict();

const backupDocumentSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    documentId: z.string().min(1).max(200),
    originalFileName: z.string().min(1).max(500),
    mimeType: z.literal("application/pdf"),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    uploadedAt: z.string().max(100),
    pageCount: z.number().int().positive(),
    detectedDocumentType: z.string().min(1).max(100),
    documentType: z.string().min(1).max(100),
    discipline: z.string().min(1).max(100),
    supplierName: optionalString,
    offerNumber: optionalString,
    documentVersion: optionalString,
    revision: nonNegativeInteger.nullable(),
    revisionOfDocumentId: optionalString,
    relationType: z.string().min(1).max(100),
    scanState: z.string().min(1).max(100),
    projectName: optionalString,
    projectNumber: optionalString,
    lvNumber: optionalString,
    classificationDimensions: z
      .object({
        documentRole: confidenceSchema,
        supplier: confidenceSchema,
        discipline: confidenceSchema,
        projectIdentity: confidenceSchema,
        offerNumber: confidenceSchema,
        relation: confidenceSchema,
        scanState: confidenceSchema
      })
      .strict(),
    classificationSignals: z.array(z.string().max(1_000)).max(1_000),
    textLayerCharacterCount: nonNegativeInteger,
    ocrProcessedAt: z.string().max(100).nullable().optional(),
    ocrSampledPages: nonNegativeInteger.optional(),
    ocrMeanConfidence: z.number().min(0).max(100).nullable().optional(),
    ocrEngineVersion: z.string().max(100).nullable().optional(),
    ocrModelVersion: z.string().max(100).nullable().optional(),
    preliminaryPositionCount: nonNegativeInteger,
    activeBasis: z.boolean(),
    excludedFromProcessing: z.boolean(),
    manualRoleOverride: z.boolean(),
    manualBasisOverrideConfirmed: z.boolean(),
    classificationConfidence: confidenceSchema,
    classificationWarnings: z.array(z.string().max(1_000)).max(1_000),
    processingStatus: z.string().min(1).max(100)
  })
  .strict();

const backupEnvelopeSchema = z
  .object({
    format: z.literal("spt-project"),
    schemaVersion: z.union([z.literal(1), z.literal(BROWSER_PROJECT_SCHEMA_VERSION)]),
    exportedAt: z.string().max(100),
    manifest: z
      .object({
        projectId: z.string().min(1).max(200),
        name: z.string().min(1).max(160),
        documentCount: nonNegativeInteger,
        basisPositionCount: nonNegativeInteger,
        offerCount: nonNegativeInteger,
        totalSize: nonNegativeInteger,
        checksums: z.record(z.string().max(200), z.string().regex(/^[a-f0-9]{64}$/u))
      })
      .strict(),
    project: backupProjectSchema,
    documents: z.array(backupDocumentSchema).max(DEFAULT_BROWSER_UPLOAD_LIMITS.maxFiles),
    documentBlobs: z
      .array(
        z
          .object({
            documentId: z.string().min(1).max(200),
            mimeType: z.literal("application/pdf"),
            base64: z.string().max(Math.ceil(MAX_BACKUP_DECODED_BYTES / 3) * 4)
          })
          .strict()
      )
      .max(DEFAULT_BROWSER_UPLOAD_LIMITS.maxFiles),
    analysisSnapshots: z
      .array(
        z
          .object({
            projectId: z.string().min(1).max(200),
            analysisVersionId: z.string().min(1).max(200),
            createdAt: z.string().max(100),
            derivedFromAnalysisVersionId: z.string().max(200).nullable().optional(),
            manualCorrectionRevision: nonNegativeInteger.optional(),
            archivedSelections: z
              .array(archivedSelectionSchema)
              .max(MAX_BACKUP_SELECTIONS)
              .optional(),
            manualCorrections: z.array(z.unknown()).max(MAX_BACKUP_SELECTIONS).optional(),
            manualDisplayLabels: z.record(z.string().max(500), z.string().max(200)).optional(),
            manualEvidenceStatusByEntity: z
              .record(z.string().max(500), z.enum(["MISSING", "VERIFIED_VISUAL"]))
              .optional(),
            matchReviews: z
              .array(matchReviewSchema)
              .max(MAX_BACKUP_SELECTIONS)
              .optional()
              .default([]),
            pilot: z.unknown(),
            summary: z
              .object({
                basisPositions: nonNegativeInteger,
                supplierOffers: nonNegativeInteger,
                positionsWithOffers: nonNegativeInteger,
                positionsWithoutOffers: nonNegativeInteger,
                warnings: nonNegativeInteger,
                pagesInspected: nonNegativeInteger,
                pagesParsed: nonNegativeInteger,
                ocrRequiredPages: nonNegativeInteger,
                ocrProcessedPages: nonNegativeInteger.optional().default(0),
                ocrFailedPages: nonNegativeInteger.optional().default(0),
                documentDiagnostics: z
                  .array(
                    z
                      .object({
                        documentId: z.string().min(1).max(200),
                        pagesInspected: nonNegativeInteger,
                        candidatePositions: nonNegativeInteger,
                        extractedPositions: nonNegativeInteger,
                        missingSourceRegions: nonNegativeInteger,
                        ocrProcessedPages: nonNegativeInteger,
                        ocrFailedPages: nonNegativeInteger,
                        ocrRequiredPages: nonNegativeInteger,
                        multiPagePositions: nonNegativeInteger
                      })
                      .strict()
                  )
                  .max(DEFAULT_BROWSER_UPLOAD_LIMITS.maxFiles)
                  .optional()
                  .default([])
              })
              .strict()
          })
          .strict()
      )
      .max(MAX_BACKUP_ANALYSES),
    selections: z
      .array(
        z
          .object({
            projectId: z.string().min(1).max(200),
            positionId: z.string().min(1).max(200),
            selectedSupplierOptionId: z.string().min(1).max(200),
            selectedLineIds: z.array(z.string().min(1).max(200)).max(1_000),
            comment: z.string().max(2_000),
            updatedAt: z.string().max(100)
          })
          .strict()
      )
      .max(MAX_BACKUP_SELECTIONS),
    workspace: z
      .object({
        projectId: z.string().min(1).max(200),
        state: ProjectWorkspaceStateSchema,
        updatedAt: z.string().max(100)
      })
      .strict()
      .nullable()
  })
  .strict();

function assertSafeJsonTree(values: unknown[]) {
  const stack = values.map((value) => ({ value, depth: 0 }));
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > 500_000 || current.depth > 64) {
      throw new Error("INVALID_PROJECT_BACKUP");
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, child] of Object.entries(current.value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error("INVALID_PROJECT_BACKUP");
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function id(): string {
  return crypto.randomUUID();
}

function emptyManualBootstrapRoot(input: {
  projectId: string;
  documents: BrowserDocumentRecord[];
}): BrowserAnalysisSnapshot {
  const basisDocument = input.documents.find(
    (document) => document.documentType === "BASIS_LV" && document.activeBasis
  );
  if (!basisDocument) throw new Error("MANUAL_BOOTSTRAP_ACTIVE_BASIS_REQUIRED");

  // buildBrowserAnalysis establishes the complete, versioned analysis shape.
  // The internal seed is removed from every extraction and derived collection
  // before the root is persisted, leaving an honest empty machine result that
  // can receive the first append-only manual ADD_BASIS_POSITION event.
  const root = buildBrowserAnalysis({
    projectId: input.projectId,
    documents: input.documents,
    result: {
      basisLines: [
        {
          documentId: basisDocument.documentId,
          positionNumber: "0.0.0",
          description: "Interne Bootstrap-Position",
          quantity: null,
          unit: null,
          pageNumber: 1,
          lineIndex: 0,
          reviewReasons: ["SOURCE_REGION_MISSING"]
        }
      ],
      supplierLines: [],
      warnings: ["Keine Basis-Positionen automatisch erkannt."],
      diagnostics: {
        pagesInspected: 0,
        pagesParsed: 0,
        ocrRequiredPages: input.documents.reduce(
          (total, document) =>
            total + (document.scanState === "OCR_REQUIRED" ? document.pageCount : 0),
          0
        ),
        ocrProcessedPages: 0,
        ocrFailedPages: 0,
        matchingCandidates: 0,
        documents: input.documents.map((document) => ({
          documentId: document.documentId,
          pagesInspected: 0,
          candidatePositions: document.preliminaryPositionCount,
          extractedPositions: 0,
          missingSourceRegions: 0,
          ocrProcessedPages: 0,
          ocrFailedPages: 0,
          ocrRequiredPages: document.scanState === "OCR_REQUIRED" ? document.pageCount : 0,
          multiPagePositions: 0
        }))
      }
    }
  });
  const analysis = root.pilot.analysis;
  if (!analysis) throw new Error("MANUAL_BOOTSTRAP_ANALYSIS_REQUIRED");
  root.pilot.analysis = {
    ...analysis,
    basisPositionFrom: "",
    basisPositionTo: "",
    basisPositions: [],
    matchLinks: [],
    supplierOptions: [],
    recommendations: []
  };
  root.pilot.runs = root.pilot.runs.map((run) => ({
    ...run,
    result: {
      ...run.result,
      envelope: {
        ...run.result.envelope,
        extraction: {
          ...run.result.envelope.extraction,
          basisPositions: []
        }
      }
    }
  }));
  root.pilot.projectReview = {
    ...root.pilot.projectReview,
    positions: [],
    invariant: {
      valid: true,
      totalBasisLeafPositions: 0,
      lvRows: 0,
      statusCount: 0,
      duplicatePositionIds: [],
      duplicatePositionNumbers: [],
      missingPositionIds: [],
      orphanDecisionIds: [],
      orphanSupplierOptionIds: [],
      unknownStatusPositionIds: [],
      problemPositionIds: []
    }
  };
  root.summary = {
    ...root.summary,
    basisPositions: 0,
    positionsWithOffers: 0,
    positionsWithoutOffers: 0
  };
  return root;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function classifyBrowserDocument(input: { fileName: string; text: string }) {
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
    inspectBrowserPdf(bytes, { enableOcr: true, maxOcrPages: 3 })
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
      ocrProcessedAt: (inspection.ocrPageCount ?? 0) > 0 ? new Date().toISOString() : null,
      ocrSampledPages: inspection.ocrPageCount ?? 0,
      ocrMeanConfidence: inspection.ocrMeanConfidence ?? null,
      ocrEngineVersion: (inspection.ocrPageCount ?? 0) > 0 ? BROWSER_OCR_ENGINE_VERSION : null,
      ocrModelVersion: (inspection.ocrPageCount ?? 0) > 0 ? BROWSER_OCR_MODEL_VERSION : null,
      preliminaryPositionCount: classification.preliminaryPositionCount,
      activeBasis: false,
      excludedFromProcessing: false,
      manualRoleOverride: false,
      manualBasisOverrideConfirmed: false,
      classificationConfidence: classification.confidence,
      classificationWarnings: classification.warnings,
      processingStatus:
        classification.scanState === "OCR_AVAILABLE"
          ? "PRÜFUNG_ERFORDERLICH"
          : classification.documentType === "SCAN_OCR_REQUIRED"
            ? "PRÜFUNG_ERFORDERLICH"
            : classification.confidence === "LOW"
              ? "PRÜFUNG_ERFORDERLICH"
              : "BEREIT"
    }
  };
}

export class BrowserProjectService {
  private readonly addFilesChains = new Map<string, Promise<unknown>>();

  constructor(private readonly repositories: ProjectRepositories) {}

  listProjects() {
    return this.repositories.projects.list();
  }

  getProject(projectId: string) {
    return this.repositories.projects.get(projectId);
  }

  async createProject(input: string | ProjectMetadata, objectDescription = "") {
    const metadata =
      typeof input === "string"
        ? {
            name: input.trim(),
            address: "",
            engineeringOffice: "",
            architectureOffice: "",
            description: objectDescription.trim()
          }
        : ProjectMetadataSchema.parse(input);
    const now = new Date().toISOString();
    const projectId = id();
    const project: BrowserProjectRecord = {
      projectId,
      name: metadata.name,
      address: metadata.address,
      engineeringOffice: metadata.engineeringOffice,
      architectureOffice: metadata.architectureOffice,
      objectDescription: metadata.description,
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
        | "address"
        | "engineeringOffice"
        | "architectureOffice"
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
    const parsedMetadata = ProjectMetadataUpdateSchema.parse({
      ...(update.name === undefined ? {} : { name: update.name }),
      ...(update.address === undefined ? {} : { address: update.address }),
      ...(update.engineeringOffice === undefined
        ? {}
        : { engineeringOffice: update.engineeringOffice }),
      ...(update.architectureOffice === undefined
        ? {}
        : { architectureOffice: update.architectureOffice }),
      ...(update.objectDescription === undefined ? {} : { description: update.objectDescription })
    });
    const next = {
      ...current,
      ...update,
      name: parsedMetadata.name ?? current.name,
      address: parsedMetadata.address ?? current.address,
      engineeringOffice: parsedMetadata.engineeringOffice ?? current.engineeringOffice,
      architectureOffice: parsedMetadata.architectureOffice ?? current.architectureOffice,
      objectDescription: parsedMetadata.description ?? current.objectDescription,
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
    const previous = this.addFilesChains.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => gate);
    this.addFilesChains.set(projectId, chain);
    await previous.catch(() => undefined);
    try {
      return await this.addFilesUnlocked(projectId, files, limits);
    } finally {
      release();
      if (this.addFilesChains.get(projectId) === chain) {
        this.addFilesChains.delete(projectId);
      }
    }
  }

  private async addFilesUnlocked(
    projectId: string,
    files: readonly File[],
    limits: BrowserUploadLimits
  ): Promise<BrowserBatchUploadResult> {
    await this.repairMissingDocumentBlobs(projectId);
    const project = await this.repositories.projects.get(projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const existing = await this.repositories.documents.list(projectId);
    const records: BrowserDocumentRecord[] = [];
    const items: BrowserUploadItemResult[] = [];
    let accumulatedBytes = existing.reduce((sum, item) => sum + item.size, 0);
    let accumulatedPages = existing.reduce((sum, item) => sum + item.pageCount, 0);

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
        if (accumulatedPages + prepared.document.pageCount > limits.maxTotalPages) {
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
        const ocrRequired = prepared.document.documentType === "SCAN_OCR_REQUIRED";
        items.push({
          fileName: file.name,
          status: ocrRequired ? "OCR_REQUIRED" : "ADDED",
          document: prepared.document,
          existingDocumentId: null,
          message: ocrRequired ? "Scan erkannt. OCR erforderlich." : "Datei hinzugefügt."
        });
      } catch (storageError) {
        const message =
          storageError instanceof DOMException && storageError.name === "QuotaExceededError"
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
    await Promise.all(documents.map((document) => this.repositories.documents.save(document)));
    await this.repositories.projects.save({
      ...project,
      documentCount: documents.length,
      supplierOfferCount: documents.filter(
        (item) =>
          item.documentType === "SUPPLIER_OFFER" || item.documentType === "MANUFACTURER_OFFER"
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

  /**
   * Removes document rows whose PDF blob is gone when an identical SHA still
   * has a blob in the same project. Orphans without a sibling stay listed so
   * the operator can replace or delete them explicitly.
   */
  async repairMissingDocumentBlobs(projectId: string): Promise<{
    removedDocumentIds: string[];
    missingDocumentIds: string[];
  }> {
    const documents = await this.repositories.documents.list(projectId);
    const presence = await Promise.all(
      documents.map(async (document) => ({
        document,
        hasBlob: Boolean(
          await this.repositories.documentBlobs.get(projectId, document.documentId)
        )
      }))
    );
    const shaWithBlob = new Set(
      presence.filter((item) => item.hasBlob).map((item) => item.document.sha256)
    );
    const removedDocumentIds: string[] = [];
    const missingDocumentIds: string[] = [];
    for (const item of presence) {
      if (item.hasBlob) continue;
      if (shaWithBlob.has(item.document.sha256)) {
        await this.repositories.documents.delete(projectId, item.document.documentId);
        removedDocumentIds.push(item.document.documentId);
      } else {
        missingDocumentIds.push(item.document.documentId);
      }
    }
    if (removedDocumentIds.length === 0) {
      return { removedDocumentIds, missingDocumentIds };
    }
    const remaining = applyAutomaticBasisSelection(
      reconcileDocumentRelations(await this.repositories.documents.list(projectId))
    );
    await Promise.all(remaining.map((document) => this.repositories.documents.save(document)));
    const project = await this.repositories.projects.get(projectId);
    if (project) {
      await this.repositories.projects.save({
        ...project,
        documentCount: remaining.length,
        supplierOfferCount: remaining.filter(
          (item) =>
            item.documentType === "SUPPLIER_OFFER" || item.documentType === "MANUFACTURER_OFFER"
        ).length,
        updatedAt: new Date().toISOString()
      });
    }
    return { removedDocumentIds, missingDocumentIds };
  }

  listDocuments(projectId: string) {
    return this.repositories.documents.list(projectId);
  }

  getDocumentBlob(projectId: string, documentId: string) {
    return this.repositories.documentBlobs.get(projectId, documentId);
  }

  async runDocumentOcr(
    projectId: string,
    documentId: string,
    onOcrProgress?: BrowserPdfInspectionOptions["onOcrProgress"]
  ): Promise<BrowserDocumentRecord> {
    const [document, blob] = await Promise.all([
      this.repositories.documents.get(projectId, documentId),
      this.repositories.documentBlobs.get(projectId, documentId)
    ]);
    if (!document) throw new Error("DOCUMENT_NOT_FOUND");
    if (!blob) throw new Error("DOCUMENT_BLOB_MISSING");
    const inspection = await inspectBrowserPdf(new Uint8Array(await blob.arrayBuffer()), {
      enableOcr: true,
      maxOcrPages: 3,
      onOcrProgress
    });
    const classification = classifyBrowserDocumentContent({
      fileName: document.originalFileName,
      inspection
    });
    const preserveManualRole = document.manualRoleOverride;
    const next: BrowserDocumentRecord = {
      ...document,
      detectedDocumentType: classification.detectedDocumentType,
      documentType: preserveManualRole ? document.documentType : classification.documentType,
      discipline:
        preserveManualRole && document.discipline !== "UNKNOWN"
          ? document.discipline
          : classification.discipline,
      supplierName: document.supplierName ?? classification.supplierName,
      offerNumber: document.offerNumber ?? classification.offerNumber,
      documentVersion: document.documentVersion ?? classification.documentVersion,
      relationType: classification.relationType,
      scanState: classification.scanState,
      projectName: classification.projectName,
      projectNumber: classification.projectNumber,
      lvNumber: classification.lvNumber,
      classificationDimensions: classification.dimensions,
      classificationSignals: classification.signals,
      textLayerCharacterCount: inspection.textLayerCharacterCount,
      ocrProcessedAt: new Date().toISOString(),
      ocrSampledPages: inspection.ocrPageCount ?? 0,
      ocrMeanConfidence: inspection.ocrMeanConfidence ?? null,
      ocrEngineVersion: BROWSER_OCR_ENGINE_VERSION,
      ocrModelVersion: BROWSER_OCR_MODEL_VERSION,
      preliminaryPositionCount: classification.preliminaryPositionCount,
      classificationConfidence: classification.confidence,
      classificationWarnings: classification.warnings,
      processingStatus:
        classification.scanState === "OCR_AVAILABLE"
          ? "PRÜFUNG_ERFORDERLICH"
          : classification.documentType === "SCAN_OCR_REQUIRED"
            ? "PRÜFUNG_ERFORDERLICH"
            : classification.confidence === "LOW"
              ? "PRÜFUNG_ERFORDERLICH"
              : "BEREIT"
    };
    const documents = applyAutomaticBasisSelection(
      reconcileDocumentRelations(
        (await this.repositories.documents.list(projectId)).map((current) =>
          current.documentId === documentId ? next : current
        )
      )
    );
    await Promise.all(documents.map((current) => this.repositories.documents.save(current)));
    await this.updateProject(projectId, {
      status: "PRÜFUNG_ERFORDERLICH",
      activeAnalysisVersionId: null,
      basisPositionCount: 0,
      supplierOfferCount: documents.filter((current) =>
        ["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(current.documentType)
      ).length,
      processingFailureCode: null,
      lastRoute: "DOCUMENT_REVIEW"
    });
    return documents.find((current) => current.documentId === documentId)!;
  }

  latestAnalysis(projectId: string) {
    return this.repositories.analyses.latest(projectId);
  }

  async applyDocumentClassifications(
    projectId: string,
    updates: NonNullable<BrowserWorkerResult["documentClassifications"]>
  ): Promise<BrowserDocumentRecord[]> {
    const documents = await this.repositories.documents.list(projectId);
    const byId = new Map(updates.map((update) => [update.documentId, update.classification]));
    if (
      updates.some(
        (update) => !documents.some((document) => document.documentId === update.documentId)
      )
    ) {
      throw new Error("DOCUMENT_NOT_FOUND");
    }
    const resolved = applyAutomaticBasisSelection(
      documents.map((document) => {
        const classification = byId.get(document.documentId);
        return classification
          ? applyFullRunDocumentClassification(document, classification)
          : document;
      })
    );
    await Promise.all(resolved.map((document) => this.repositories.documents.save(document)));
    return resolved;
  }

  saveAnalysis(snapshot: BrowserAnalysisSnapshot) {
    return this.repositories.analyses.save(snapshot);
  }

  async processingProtection(projectId: string) {
    const [previous, selections] = await Promise.all([
      this.repositories.analyses.latest(projectId),
      this.repositories.selections.list(projectId)
    ]);
    const requiresConfirmation = Boolean(
      selections.length ||
        previous?.manualCorrections?.length ||
        previous?.matchReviews.length ||
        previous?.pilot.supplierDecisions?.length ||
        previous?.pilot.supplierDecisionReviewActions?.length ||
        previous?.pilot.matchReviewActions?.length
    );
    // Includes human changes during processing, not just the machine version ID.
    const confirmationToken = JSON.stringify([
      previous?.analysisVersionId,
      previous?.manualCorrections,
      previous?.matchReviews,
      previous?.pilot.supplierDecisions,
      previous?.pilot.supplierDecisionReviewActions,
      previous?.pilot.matchReviewActions,
      selections
    ]);
    return {
      requiresConfirmation,
      confirmationToken,
      previousAnalysisVersionId: previous?.analysisVersionId ?? null
    };
  }

  async saveProcessingAnalysis(snapshot: BrowserAnalysisSnapshot, confirmationToken?: string) {
    const protection = await this.processingProtection(snapshot.projectId);
    if (protection.requiresConfirmation && confirmationToken !== protection.confirmationToken) {
      throw new Error("REPROCESSING_CONFIRMATION_REQUIRED");
    }
    if (protection.previousAnalysisVersionId === snapshot.analysisVersionId) {
      throw new Error("REPROCESSING_NEW_VERSION_REQUIRED");
    }
    const selections = await this.repositories.selections.list(snapshot.projectId);
    if (protection.previousAnalysisVersionId && selections.length) {
      const previous = await this.repositories.analyses.get(
        snapshot.projectId,
        protection.previousAnalysisVersionId
      );
      if (!previous) throw new Error("PREVIOUS_ANALYSIS_NOT_FOUND");
      await this.repositories.analyses.save({ ...previous, archivedSelections: selections });
    }
    // Keep the old immutable extraction/corrections in its own snapshot. Matching
    // old line-index IDs onto new extraction output is not a trustworthy rebase.
    await this.repositories.analyses.save(snapshot);
    await Promise.all(
      selections.map((selection) =>
        this.repositories.selections.delete(snapshot.projectId, selection.positionId)
      )
    );
  }

  async bootstrapManualBasisPosition(
    input: BrowserManualBasisBootstrapInput
  ): Promise<BrowserAnalysisSnapshot> {
    const project = await this.repositories.projects.get(input.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (
      project.status !== "FEHLER" ||
      project.processingFailureCode !== "FAILED_NO_BASIS_POSITIONS" ||
      project.activeAnalysisVersionId !== null
    ) {
      throw new Error("MANUAL_BOOTSTRAP_NOT_ALLOWED");
    }

    const storedDocuments = (await this.repositories.documents.list(input.projectId)).filter(
      (document) => !document.excludedFromProcessing
    );
    const activeBasis = storedDocuments.find(
      (document) => document.documentType === "BASIS_LV" && document.activeBasis
    );
    if (!activeBasis || input.command.value.documentId !== activeBasis.documentId) {
      throw new Error("MANUAL_BOOTSTRAP_ACTIVE_BASIS_REQUIRED");
    }
    if (!(await this.repositories.documentBlobs.get(input.projectId, activeBasis.documentId))) {
      throw new Error("DOCUMENT_BLOB_MISSING");
    }
    const discipline = project.activeDiscipline ?? activeBasis.discipline;
    const documents = storedDocuments.filter(
      (document) =>
        document.documentId === activeBasis.documentId ||
        document.documentType === "SCAN_OCR_REQUIRED" ||
        document.discipline === discipline ||
        document.discipline === "MULTI" ||
        (discipline === "SANITAER" && document.discipline === "INSTALLATIONSSYSTEME")
    );

    const root = emptyManualBootstrapRoot({
      projectId: input.projectId,
      documents
    });
    const previousCreatedAt = Date.parse(root.createdAt);
    const createdAt = new Date(
      Math.max(Date.now(), Number.isFinite(previousCreatedAt) ? previousCreatedAt + 1 : 0)
    ).toISOString();
    const appended = appendManualCorrection({
      snapshot: root,
      documents,
      history: [],
      expectedRevision: 0,
      command: input.command,
      audit: {
        id: crypto.randomUUID(),
        operatorId: input.operatorId,
        operatorLabel: input.operatorLabel,
        reasonCode: input.reasonCode ?? "OCR_CORRECTION",
        comment: input.comment,
        createdAt
      }
    });
    const effective = materializeManualCorrections({
      snapshot: root,
      documents,
      history: appended.history
    });
    const nextAnalysis = effective.snapshot.pilot.analysis;
    if (!nextAnalysis) throw new Error("MANUAL_BOOTSTRAP_ANALYSIS_REQUIRED");
    const analysisVersionId = crypto.randomUUID();
    const derived: BrowserAnalysisSnapshot = {
      ...effective.snapshot,
      analysisVersionId,
      createdAt,
      derivedFromAnalysisVersionId: root.analysisVersionId,
      manualCorrectionRevision: effective.correctionRevision,
      manualCorrections: appended.history,
      manualDisplayLabels: effective.displayLabels,
      manualEvidenceStatusByEntity: effective.evidenceStatusByEntity,
      matchReviews: [],
      pilot: {
        ...effective.snapshot.pilot,
        analysis: {
          ...nextAnalysis,
          id: analysisVersionId,
          generatedAt: createdAt
        },
        matchReviewActions: [],
        supplierDecisions: [],
        supplierDecisionReviewActions: [],
        projectReview: {
          ...effective.snapshot.pilot.projectReview,
          analysisVersionId
        }
      }
    };

    await this.repositories.analyses.save(root);
    await this.repositories.analyses.save(derived);
    const selections = await this.repositories.selections.list(input.projectId);
    await Promise.all(
      selections.map((selection) =>
        this.repositories.selections.delete(input.projectId, selection.positionId)
      )
    );
    await this.updateProject(input.projectId, {
      activeAnalysisVersionId: analysisVersionId,
      basisPositionCount: derived.summary.basisPositions,
      supplierOfferCount: derived.summary.supplierOffers,
      status: "PRÜFUNG_ERFORDERLICH",
      processingFailureCode: null,
      processingCheckpoint: null,
      lastRoute: "PROCESSING_RESULT",
      lastOpenedAt: createdAt
    });
    return derived;
  }

  async applyManualCorrection(
    input: BrowserManualCorrectionInput
  ): Promise<BrowserAnalysisSnapshot> {
    const current = await this.repositories.analyses.get(input.projectId, input.analysisVersionId);
    if (!current) throw new Error("MANUAL_CORRECTION_ANALYSIS_NOT_FOUND");
    const project = await this.repositories.projects.get(input.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (
      project.activeAnalysisVersionId &&
      project.activeAnalysisVersionId !== input.analysisVersionId
    ) {
      throw new Error("MANUAL_CORRECTION_STALE_ANALYSIS");
    }

    const rootAnalysisVersionId = current.derivedFromAnalysisVersionId ?? current.analysisVersionId;
    const root = await this.repositories.analyses.get(input.projectId, rootAnalysisVersionId);
    if (!root) throw new Error("MANUAL_CORRECTION_ROOT_ANALYSIS_NOT_FOUND");

    const documents = await this.repositories.documents.list(input.projectId);
    const existingHistory = current.manualCorrections ?? [];
    const previousCreatedAt = Date.parse(current.createdAt);
    const createdAt = new Date(
      Math.max(Date.now(), Number.isFinite(previousCreatedAt) ? previousCreatedAt + 1 : 0)
    ).toISOString();
    const appended = appendManualCorrection({
      snapshot: root,
      documents,
      history: existingHistory,
      expectedRevision: input.expectedRevision,
      command: input.command,
      audit: {
        id: crypto.randomUUID(),
        operatorId: input.operatorId,
        operatorLabel: input.operatorLabel,
        reasonCode: input.reasonCode ?? "OCR_CORRECTION",
        comment: input.comment,
        createdAt
      }
    });
    const effective = materializeManualCorrections({
      snapshot: root,
      documents,
      history: appended.history
    });
    // Keep one effective derived snapshot beside the immutable machine result.
    // Subsequent events replay the root plus the append-only audit history and
    // replace only that derived materialization, avoiding a full LV copy per edit.
    const analysisVersionId = current.derivedFromAnalysisVersionId
      ? current.analysisVersionId
      : crypto.randomUUID();
    const nextAnalysis = effective.snapshot.pilot.analysis;
    if (!nextAnalysis) throw new Error("MANUAL_CORRECTION_ANALYSIS_REQUIRED");

    const derived: BrowserAnalysisSnapshot = {
      ...effective.snapshot,
      analysisVersionId,
      createdAt,
      derivedFromAnalysisVersionId: rootAnalysisVersionId,
      manualCorrectionRevision: effective.correctionRevision,
      manualCorrections: appended.history,
      manualDisplayLabels: effective.displayLabels,
      manualEvidenceStatusByEntity: effective.evidenceStatusByEntity,
      // Any earlier confirmation or supplier selection may point to a match
      // that changed after the corrected text/price was re-evaluated.
      matchReviews: [],
      pilot: {
        ...effective.snapshot.pilot,
        analysis: {
          ...nextAnalysis,
          id: analysisVersionId,
          generatedAt: createdAt
        },
        matchReviewActions: [],
        supplierDecisions: [],
        supplierDecisionReviewActions: [],
        projectReview: {
          ...effective.snapshot.pilot.projectReview,
          analysisVersionId
        }
      }
    };

    await this.repositories.analyses.save(derived);
    const selections = await this.repositories.selections.list(input.projectId);
    await Promise.all(
      selections.map((selection) =>
        this.repositories.selections.delete(input.projectId, selection.positionId)
      )
    );
    await this.updateProject(input.projectId, {
      activeAnalysisVersionId: analysisVersionId,
      basisPositionCount: derived.summary.basisPositions,
      status: "PRÜFUNG_ERFORDERLICH",
      processingFailureCode: null,
      lastRoute: "LV_COMPARISON",
      lastOpenedAt: createdAt
    });
    return derived;
  }

  async listMatchReviews(projectId: string) {
    return (await this.repositories.analyses.latest(projectId))?.matchReviews ?? [];
  }

  async reviewMatch(review: BrowserMatchReviewRecord) {
    const parsed = matchReviewSchema.safeParse(review);
    if (!parsed.success) throw new Error("INVALID_MATCH_REVIEW");
    const snapshot = await this.repositories.analyses.get(
      parsed.data.projectId,
      parsed.data.analysisVersionId
    );
    if (!snapshot) throw new Error("MATCH_REVIEW_ANALYSIS_NOT_FOUND");
    const updated = applyBrowserMatchReview(snapshot, parsed.data);
    await this.repositories.analyses.save(updated);
    return updated;
  }

  currentProcessingRun(projectId: string) {
    return this.repositories.processingRuns.current(projectId);
  }

  saveProcessingRun(run: Parameters<ProjectRepositories["processingRuns"]["save"]>[0]) {
    return this.repositories.processingRuns.save(run);
  }

  listSelections(projectId: string) {
    return this.repositories.selections.list(projectId);
  }

  saveSelection(selection: Parameters<ProjectRepositories["selections"]["save"]>[0]) {
    return this.repositories.selections.save(selection);
  }

  getWorkspace(projectId: string) {
    return this.repositories.workspaces.get(projectId);
  }

  saveWorkspace(workspace: Parameters<ProjectRepositories["workspaces"]["save"]>[0]) {
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
        update.documentType !== undefined && update.documentType !== document.detectedDocumentType
          ? true
          : (update.manualRoleOverride ?? document.manualRoleOverride)
    };
    const documents = applyAutomaticBasisSelection(
      reconcileDocumentRelations(
        (await this.repositories.documents.list(projectId)).map((current) =>
          current.documentId === documentId ? next : current
        )
      )
    );
    await Promise.all(documents.map((current) => this.repositories.documents.save(current)));
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
          document.documentId !== documentId && document.sha256 === prepared.document.sha256
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
    await Promise.all(reconciled.map((document) => this.repositories.documents.save(document)));
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
    const selected = documents.find((document) => document.documentId === documentId);
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
    await Promise.all(next.map((document) => this.repositories.documents.save(document)));
    return selected;
  }

  async processingPreflight(
    projectId: string,
    discipline: BrowserDiscipline
  ): Promise<BrowserProcessingPreflight> {
    await this.repairMissingDocumentBlobs(projectId);
    const documents = (await this.repositories.documents.list(projectId)).filter(
      (document) => !document.excludedFromProcessing
    );
    const relevant = documents.filter(
      (document) =>
        ["SCAN_OCR_REQUIRED", "UNKNOWN"].includes(document.documentType) ||
        document.discipline === discipline ||
        document.discipline === "MULTI" ||
        (discipline === "SANITAER" && document.discipline === "INSTALLATIONSSYSTEME")
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
    const basisNeedsFullOcr = Boolean(
      basis &&
        ["OCR_REQUIRED", "OCR_AVAILABLE"].includes(basis.scanState) &&
        (basis.detectedDocumentType === "BASIS_LV" ||
          (basis.manualRoleOverride &&
            !["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(basis.detectedDocumentType)) ||
          basis.manualBasisOverrideConfirmed)
    );
    if (
      basis &&
      !isStructurallyPlausibleBasis(basis) &&
      !basis.manualBasisOverrideConfirmed &&
      !basisNeedsFullOcr
    ) {
      blockingReasons.push("Das aktive Basis-LV besteht die strukturelle Basis-Prüfung nicht.");
    }
    if (basis && basis.preliminaryPositionCount === 0) {
      if (basisNeedsFullOcr) {
        warnings.push(
          `${basis.originalFileName}: In der Vorschau wurde keine vorläufige Positionsstruktur erkannt; die Voll-OCR prüft automatisch alle Seiten.`
        );
      } else {
        blockingReasons.push("Im Basis-LV wurde keine vorläufige Positionsstruktur erkannt.");
      }
    }
    for (const document of relevant) {
      const blob = await this.repositories.documentBlobs.get(projectId, document.documentId);
      if (!blob) {
        blockingReasons.push(`PDF-Datei fehlt: ${document.originalFileName}`);
      }
      if (document.documentType === "UNKNOWN" && document.documentId !== basis?.documentId) {
        warnings.push(
          `${document.originalFileName}: Dokumentrolle nach Vorschau offen. Die Vollprüfung wird ausgeführt; bei weiterhin unklarer Rolle ist eine manuelle Zuordnung erforderlich.`
        );
      } else if (
        document.classificationConfidence === "LOW" &&
        document.documentType !== "SCAN_OCR_REQUIRED" &&
        !(basisNeedsFullOcr && document.documentId === basis?.documentId)
      ) {
        blockingReasons.push(`Offene Dokumentzuordnung: ${document.originalFileName}`);
      }
      if (
        document.documentType === "SCAN_OCR_REQUIRED" ||
        (basisNeedsFullOcr && document.documentId === basis?.documentId)
      ) {
        warnings.push(
          `${document.originalFileName}: OCR wird im Verarbeitungslauf automatisch ausgeführt; Dokumentrolle und Ergebnis anschließend manuell prüfen.`
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
      reconcileDocumentRelations(await this.repositories.documents.list(projectId))
    );
    await Promise.all(documents.map((document) => this.repositories.documents.save(document)));
    await this.updateProject(projectId, {
      status: documents.length ? "DOKUMENTE_GELADEN" : "ENTWURF",
      activeAnalysisVersionId: null,
      basisPositionCount: 0,
      supplierOfferCount: documents.filter(
        (item) =>
          item.documentType === "SUPPLIER_OFFER" || item.documentType === "MANUFACTURER_OFFER"
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
      source.address && source.engineeringOffice && source.architectureOffice
        ? {
            name: `Kopie von ${source.name}`,
            address: source.address,
            engineeringOffice: source.engineeringOffice,
            architectureOffice: source.architectureOffice,
            description: source.objectDescription
          }
        : `Kopie von ${source.name}`,
      source.objectDescription
    );
    try {
      const documents = await this.repositories.documents.list(projectId);
      for (const document of documents) {
        const blob = await this.repositories.documentBlobs.get(projectId, document.documentId);
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
      const workspace = await this.repositories.workspaces.get(projectId);
      if (workspace) {
        await this.repositories.workspaces.save({
          ...structuredClone(workspace),
          projectId: duplicate.projectId,
          state: {
            ...structuredClone(workspace.state),
            expandedPositionIds: [],
            selectedBasisPositionId: null,
            selectedSupplierOptionId: null,
            inspectorOpen: false,
            fullscreenSourceOpen: false,
            warningCenterOpen: false,
            sourceOverlay: null
          }
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
      const blob = await this.repositories.documentBlobs.get(projectId, document.documentId);
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
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error("PROJECT_BACKUP_TOO_LARGE");
    }
    let rawBackup: unknown;
    try {
      rawBackup = JSON.parse(await file.text()) as unknown;
    } catch {
      throw new Error("CORRUPT_PROJECT_BACKUP");
    }
    const parsedBackup = backupEnvelopeSchema.safeParse(rawBackup);
    if (!parsedBackup.success) throw new Error("INVALID_PROJECT_BACKUP");
    const backup = parsedBackup.data as BrowserProjectBackup;
    assertSafeJsonTree([
      ...backup.analysisSnapshots.map((snapshot) => snapshot.pilot),
      backup.workspace?.state
    ]);
    if (
      backup.format !== "spt-project" ||
      ![1, BROWSER_PROJECT_SCHEMA_VERSION].includes(backup.schemaVersion) ||
      !backup.manifest ||
      !backup.project ||
      !Array.isArray(backup.documents) ||
      !Array.isArray(backup.documentBlobs) ||
      !Array.isArray(backup.analysisSnapshots) ||
      !Array.isArray(backup.selections) ||
      backup.documents.length > DEFAULT_BROWSER_UPLOAD_LIMITS.maxFiles ||
      backup.analysisSnapshots.length > MAX_BACKUP_ANALYSES ||
      backup.selections.length > MAX_BACKUP_SELECTIONS ||
      backup.documents.length !== backup.manifest.documentCount ||
      backup.documentBlobs.length !== backup.documents.length
    ) {
      throw new Error("INVALID_PROJECT_BACKUP");
    }
    const documentIds = new Set(backup.documents.map((item) => item.documentId));
    const blobIds = new Set(backup.documentBlobs.map((item) => item.documentId));
    const checksumIds = Object.keys(backup.manifest.checksums ?? {});
    if (
      documentIds.size !== backup.documents.length ||
      blobIds.size !== backup.documentBlobs.length ||
      checksumIds.length !== backup.documents.length ||
      checksumIds.some((documentId) => !documentIds.has(documentId)) ||
      [...documentIds].some((documentId) => !blobIds.has(documentId)) ||
      backup.project.projectId !== backup.manifest.projectId ||
      backup.documents.some(
        (document) =>
          document.projectId !== backup.manifest.projectId ||
          document.mimeType !== "application/pdf" ||
          !Number.isSafeInteger(document.size) ||
          document.size < 1 ||
          typeof document.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/u.test(document.sha256)
      ) ||
      backup.analysisSnapshots.some(
        (snapshot) =>
          snapshot.projectId !== backup.manifest.projectId ||
          snapshot.matchReviews.some(
            (review) =>
              review.projectId !== backup.manifest.projectId ||
              review.analysisVersionId !== snapshot.analysisVersionId
          )
      ) ||
      backup.selections.some((selection) => selection.projectId !== backup.manifest.projectId) ||
      (backup.workspace !== null && backup.workspace.projectId !== backup.manifest.projectId)
    ) {
      throw new Error("INVALID_PROJECT_BACKUP");
    }

    let decodedSize = 0;
    for (const item of backup.documentBlobs) {
      if (
        item.mimeType !== "application/pdf" ||
        typeof item.base64 !== "string" ||
        item.base64.length > Math.ceil(MAX_BACKUP_DECODED_BYTES / 3) * 4
      ) {
        throw new Error("INVALID_PROJECT_BACKUP");
      }
      const bytes = base64ToBytes(item.base64);
      decodedSize += bytes.byteLength;
      if (decodedSize > MAX_BACKUP_DECODED_BYTES) {
        throw new Error("PROJECT_BACKUP_TOO_LARGE");
      }
      if (new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error("INVALID_PROJECT_BACKUP");
      }
      const document = backup.documents.find(
        (candidate) => candidate.documentId === item.documentId
      );
      if (!document || document.size !== bytes.byteLength) {
        throw new Error("INVALID_PROJECT_BACKUP");
      }
      const buffer = Uint8Array.from(bytes).buffer;
      const digest = await sha256(buffer);
      if (digest !== backup.manifest.checksums[item.documentId] || digest !== document.sha256) {
        throw new Error("PROJECT_BACKUP_CHECKSUM_MISMATCH");
      }
      try {
        await inspectBrowserPdf(bytes);
      } catch {
        throw new Error("INVALID_PROJECT_BACKUP");
      }
    }
    if (
      decodedSize !== backup.documents.reduce((sum, item) => sum + item.size, 0) ||
      decodedSize !== backup.manifest.totalSize
    ) {
      throw new Error("INVALID_PROJECT_BACKUP");
    }
    const restoredProjectStatus = backup.documents.some(
      (document) =>
        document.processingStatus === "PRÜFUNG_ERFORDERLICH" ||
        document.documentType === "SCAN_OCR_REQUIRED" ||
        document.documentType === "UNKNOWN"
    )
      ? "PRÜFUNG_ERFORDERLICH"
      : backup.documents.length > 0
        ? "DOKUMENTE_GELADEN"
        : "ENTWURF";
    backup.project = normalizeBrowserProjectRecord({
      ...backup.project,
      activeAnalysisVersionId: null,
      processingCheckpoint: null,
      processingFailureCode: null,
      basisPositionCount: 0,
      supplierOfferCount: 0,
      documentCount: backup.documents.length,
      lastPositionId: null,
      lastRoute: backup.documents.length > 0 ? "DOCUMENT_REVIEW" : "PROJECT_DOCUMENTS",
      status: restoredProjectStatus
    });
    // Backups are unsigned input. PDFs and strictly validated UI preferences may
    // be restored, but derived prices, matches and human confirmations must be
    // regenerated or confirmed in this installation before they become trusted.
    backup.analysisSnapshots = [];
    backup.selections = [];
    if (backup.workspace) {
      backup.workspace = {
        ...backup.workspace,
        state: {
          ...backup.workspace.state,
          tableScroll: 0,
          page: 1,
          expandedPositionIds: [],
          selectedBasisPositionId: null,
          selectedSupplierOptionId: null,
          inspectorOpen: false,
          fullscreenSourceOpen: false,
          warningCenterOpen: false,
          sourceOverlay: null,
          sourceViews: {}
        }
      };
    }
    backup.schemaVersion = BROWSER_PROJECT_SCHEMA_VERSION;
    return {
      backup,
      summary: {
        projectName: backup.manifest.name,
        schemaVersion: backup.schemaVersion,
        documentCount: backup.manifest.documentCount,
        basisPositionCount:
          backup.manifest.basisPositionCount ?? backup.project.basisPositionCount ?? 0,
        offerCount: backup.manifest.offerCount ?? backup.project.supplierOfferCount ?? 0,
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
      ...normalizeBrowserProjectRecord(backup.project),
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
          blob: new Blob([bytes.buffer], { type: "application/pdf" })
        });
      }
      for (const snapshot of backup.analysisSnapshots) {
        await this.repositories.analyses.save({
          ...snapshot,
          projectId,
          matchReviews: snapshot.matchReviews.map((review) => ({
            ...review,
            projectId
          })),
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
