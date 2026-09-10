import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { buildBrowserAnalysis } from "@/browser-projects/browser-analysis";
import { BrowserProjectDatabase } from "@/browser-projects/indexeddb";
import { BrowserProjectService } from "@/browser-projects/project-service";
import { createBrowserProjectRepositories } from "@/browser-projects/repository-factory";
import type { ProjectRepositories } from "@/browser-projects/repositories";
import type { BrowserAnalysisSnapshot, BrowserDocumentRecord } from "@/browser-projects/types";

const databases: BrowserProjectDatabase[] = [];

function document(
  projectId: string,
  documentId: string,
  documentType: BrowserDocumentRecord["documentType"],
  supplierName: string | null = null
): BrowserDocumentRecord {
  return {
    projectId,
    documentId,
    originalFileName: `${documentId}.pdf`,
    mimeType: "application/pdf",
    size: 1_000,
    sha256: documentId.padEnd(64, "0").slice(0, 64),
    uploadedAt: "2026-09-08T08:00:00.000Z",
    pageCount: 2,
    detectedDocumentType: documentType,
    documentType,
    discipline: "HEIZUNG",
    supplierName,
    offerNumber: null,
    documentVersion: null,
    revision: 1,
    revisionOfDocumentId: null,
    relationType: "SEPARATE_OFFER",
    scanState: "OCR_AVAILABLE",
    projectName: null,
    projectNumber: null,
    lvNumber: null,
    classificationDimensions: {
      documentRole: "HIGH",
      supplier: supplierName ? "HIGH" : "LOW",
      discipline: "HIGH",
      projectIdentity: "MEDIUM",
      offerNumber: "LOW",
      relation: "HIGH",
      scanState: "MEDIUM"
    },
    classificationSignals: ["Lokales OCR verwendet"],
    textLayerCharacterCount: 0,
    preliminaryPositionCount: 1,
    activeBasis: documentType === "BASIS_LV",
    excludedFromProcessing: false,
    manualRoleOverride: false,
    manualBasisOverrideConfirmed: false,
    classificationConfidence: "MEDIUM",
    classificationWarnings: [],
    processingStatus: "PRÜFUNG_ERFORDERLICH"
  };
}

function snapshot(projectId: string, documents: BrowserDocumentRecord[]): BrowserAnalysisSnapshot {
  return buildBrowserAnalysis({
    projectId,
    documents,
    result: {
      basisLines: [
        {
          documentId: "basis",
          positionNumber: "1.1.10",
          description: "Umwälzpumpe Alpha",
          quantity: 2,
          unit: "St",
          pageNumber: 1,
          lineIndex: 0,
          region: { x: 0.1, y: 0.2, width: 0.6, height: 0.1 },
          reviewReasons: ["OCR_SOURCE"]
        }
      ],
      supplierLines: [
        {
          documentId: "offer",
          positionNumber: "1.1.10",
          supplierPositionNumber: "10",
          description: "Falsch gelesener Text",
          quantity: 2,
          unit: "St",
          pageNumber: 1,
          lineIndex: 0,
          region: { x: 0.1, y: 0.35, width: 0.6, height: 0.1 },
          reviewReasons: ["OCR_SOURCE"],
          supplier: "Lieferant A",
          articleNumber: null,
          unitPrice: 50,
          totalPrice: 100
        }
      ],
      warnings: [],
      diagnostics: {
        pagesInspected: 2,
        pagesParsed: 2,
        ocrRequiredPages: 0,
        ocrProcessedPages: 2,
        ocrFailedPages: 0,
        matchingCandidates: 1,
        documents: []
      }
    }
  });
}

async function setup(): Promise<{
  service: BrowserProjectService;
  repositories: ProjectRepositories;
  analysis: BrowserAnalysisSnapshot;
}> {
  const database = new BrowserProjectDatabase(
    new IDBFactory(),
    `spt-manual-service-${crypto.randomUUID()}`
  );
  databases.push(database);
  const repositories = createBrowserProjectRepositories(database);
  const service = new BrowserProjectService(repositories);
  const project = await service.createProject("OCR-Korrektur");
  const documents = [
    document(project.projectId, "basis", "BASIS_LV"),
    document(project.projectId, "offer", "SUPPLIER_OFFER", "Lieferant A")
  ];
  await Promise.all(documents.map((item) => repositories.documents.save(item)));
  const analysis = snapshot(project.projectId, documents);
  await service.saveAnalysis(analysis);
  await service.updateProject(project.projectId, {
    activeAnalysisVersionId: analysis.analysisVersionId,
    status: "PRÜFUNG_ERFORDERLICH"
  });
  await service.saveSelection({
    projectId: project.projectId,
    positionId: analysis.pilot.projectReview.positions[0]!.basis.id,
    selectedSupplierOptionId: analysis.pilot.projectReview.positions[0]!.options[0]!.id,
    selectedLineIds: analysis.pilot.projectReview.positions[0]!.options[0]!.matchedOfferLineIds,
    comment: "Vor der Korrektur",
    updatedAt: "2026-09-08T09:00:00.000Z"
  });
  return { service, repositories, analysis };
}

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("manual correction persistence", () => {
  it.each(["OCR_REQUIRED", "OCR_AVAILABLE"] as const)(
    "lets a confirmed %s Basis with zero preview positions reach full processing",
    async (scanState) => {
      const database = new BrowserProjectDatabase(
        new IDBFactory(),
        `spt-ocr-basis-preflight-${crypto.randomUUID()}`
      );
      databases.push(database);
      const repositories = createBrowserProjectRepositories(database);
      const service = new BrowserProjectService(repositories);
      const project = await service.createProject("OCR-Basis Preflight");
      const ocrBasis = {
        ...document(project.projectId, "basis", "BASIS_LV"),
        detectedDocumentType: "SCAN_OCR_REQUIRED" as const,
        scanState,
        preliminaryPositionCount: 0,
        manualRoleOverride: true,
        manualBasisOverrideConfirmed: false,
        classificationConfidence: "LOW" as const,
        processingStatus: "PRÜFUNG_ERFORDERLICH" as const
      };
      await repositories.documents.save(ocrBasis);
      await repositories.documentBlobs.save({
        projectId: project.projectId,
        documentId: ocrBasis.documentId,
        blob: new Blob(["scan"], { type: "application/pdf" })
      });

      const preflight = await service.processingPreflight(project.projectId, "HEIZUNG");

      expect(preflight.valid).toBe(true);
      expect(preflight.blockingReasons).toEqual([]);
      expect(preflight.warnings.join(" ")).toContain("Voll-OCR");
      expect(preflight.warnings.join(" ")).toContain("keine vorläufige Positionsstruktur");
    }
  );

  it("still blocks an OCR supplier offer reassigned as Basis without explicit confirmation", async () => {
    const database = new BrowserProjectDatabase(
      new IDBFactory(),
      `spt-ocr-supplier-preflight-${crypto.randomUUID()}`
    );
    databases.push(database);
    const repositories = createBrowserProjectRepositories(database);
    const service = new BrowserProjectService(repositories);
    const project = await service.createProject("OCR-Lieferant als Basis");
    const disguisedSupplier = {
      ...document(project.projectId, "supplier", "BASIS_LV", "Lieferant A"),
      detectedDocumentType: "SUPPLIER_OFFER" as const,
      scanState: "OCR_AVAILABLE" as const,
      preliminaryPositionCount: 0,
      manualRoleOverride: true,
      manualBasisOverrideConfirmed: false,
      classificationConfidence: "LOW" as const
    };
    await repositories.documents.save(disguisedSupplier);
    await repositories.documentBlobs.save({
      projectId: project.projectId,
      documentId: disguisedSupplier.documentId,
      blob: new Blob(["scan"], { type: "application/pdf" })
    });

    const preflight = await service.processingPreflight(project.projectId, "HEIZUNG");

    expect(preflight.valid).toBe(false);
    expect(preflight.blockingReasons.join(" ")).toContain("strukturelle Basis-Prüfung");
  });

  it("recovers a failed empty Basis extraction with an audited first manual position", async () => {
    const database = new BrowserProjectDatabase(
      new IDBFactory(),
      `spt-manual-bootstrap-${crypto.randomUUID()}`
    );
    databases.push(database);
    const repositories = createBrowserProjectRepositories(database);
    const service = new BrowserProjectService(repositories);
    const project = await service.createProject("OCR-Basis Fallback");
    const documents = [
      document(project.projectId, "basis", "BASIS_LV"),
      document(project.projectId, "offer", "SUPPLIER_OFFER", "Lieferant A"),
      {
        ...document(project.projectId, "sanitaer-offer", "SUPPLIER_OFFER", "Lieferant Sanitär"),
        discipline: "SANITAER" as const
      }
    ];
    const originalPdf = new Blob(["immutable-pdf-bytes"], {
      type: "application/pdf"
    });
    await Promise.all(documents.map((item) => repositories.documents.save(item)));
    await repositories.documentBlobs.save({
      projectId: project.projectId,
      documentId: "basis",
      blob: originalPdf
    });
    await service.updateProject(project.projectId, {
      activeAnalysisVersionId: null,
      basisPositionCount: 0,
      supplierOfferCount: 1,
      status: "FEHLER",
      processingFailureCode: "FAILED_NO_BASIS_POSITIONS",
      lastRoute: "PROCESSING_RESULT"
    });

    const recovered = await service.bootstrapManualBasisPosition({
      projectId: project.projectId,
      command: {
        action: "ADD_BASIS_POSITION",
        value: {
          documentId: "basis",
          positionNumber: "1.1.10",
          shortLabel: "Heizungspumpe",
          description: "Heizungspumpe aus dem gescannten Basis-LV",
          quantity: 2,
          unit: "St",
          source: {
            pageNumber: 2,
            region: { x: 0.1, y: 0.2, width: 0.7, height: 0.15 }
          }
        }
      },
      operatorId: "local-user",
      operatorLabel: "Lokaler Benutzer",
      comment: "OCR konnte keine Basis-Position extrahieren"
    });

    const snapshots = await repositories.analyses.list(project.projectId);
    const raw = snapshots.find(
      (candidate) => candidate.analysisVersionId === recovered.derivedFromAnalysisVersionId
    );
    expect(snapshots).toHaveLength(2);
    expect(raw?.pilot.analysis?.basisPositions).toEqual([]);
    expect(raw?.pilot.runs.flatMap((run) => run.result.envelope.extraction.basisPositions)).toEqual(
      []
    );
    expect(raw?.manualCorrections).toBeUndefined();
    expect(recovered.manualCorrectionRevision).toBe(1);
    expect(recovered.pilot.runs.map((run) => run.document.id)).not.toContain("sanitaer-offer");
    expect(recovered.manualCorrections).toEqual([
      expect.objectContaining({
        revision: 1,
        entityKind: "BASIS_POSITION",
        command: expect.objectContaining({ action: "ADD_BASIS_POSITION" })
      })
    ]);
    expect(recovered.pilot.analysis?.basisPositions).toEqual([
      expect.objectContaining({
        positionNumber: "1.1.10",
        description: "Heizungspumpe aus dem gescannten Basis-LV",
        verificationStatus: "HUMAN_CORRECTED",
        evidence: [
          expect.objectContaining({
            pageNumber: 2,
            status: "VERIFIED_VISUAL",
            region: { x: 0.1, y: 0.2, width: 0.7, height: 0.15 }
          })
        ]
      })
    ]);
    expect(recovered.manualDisplayLabels).toEqual({
      [`BASIS_POSITION:${recovered.pilot.analysis!.basisPositions[0]!.id}`]: "Heizungspumpe"
    });
    expect(await (await service.getDocumentBlob(project.projectId, "basis"))?.text()).toBe(
      "immutable-pdf-bytes"
    );
    expect(await service.getProject(project.projectId)).toMatchObject({
      activeAnalysisVersionId: recovered.analysisVersionId,
      basisPositionCount: 1,
      supplierOfferCount: 1,
      status: "PRÜFUNG_ERFORDERLICH",
      processingFailureCode: null,
      lastRoute: "PROCESSING_RESULT"
    });

    const second = await service.applyManualCorrection({
      projectId: project.projectId,
      analysisVersionId: recovered.analysisVersionId,
      expectedRevision: 1,
      command: {
        action: "ADD_BASIS_POSITION",
        value: {
          documentId: "basis",
          positionNumber: "1.1.20",
          description: "Zweite manuell erfasste Position",
          source: { pageNumber: 2, region: null }
        }
      },
      operatorId: "local-user",
      operatorLabel: "Lokaler Benutzer",
      comment: "Weitere fehlende OCR-Position ergänzt"
    });
    expect(second.manualCorrectionRevision).toBe(2);
    expect(second.pilot.analysis?.basisPositions).toHaveLength(2);
    expect(await repositories.analyses.list(project.projectId)).toHaveLength(2);
  });

  it("allows the empty-analysis fallback only for the active Basis document after that failure", async () => {
    const database = new BrowserProjectDatabase(
      new IDBFactory(),
      `spt-manual-bootstrap-guard-${crypto.randomUUID()}`
    );
    databases.push(database);
    const repositories = createBrowserProjectRepositories(database);
    const service = new BrowserProjectService(repositories);
    const project = await service.createProject("Fallback Schutz");
    const documents = [
      document(project.projectId, "basis", "BASIS_LV"),
      document(project.projectId, "offer", "SUPPLIER_OFFER", "Lieferant A")
    ];
    await Promise.all(documents.map((item) => repositories.documents.save(item)));
    await repositories.documentBlobs.save({
      projectId: project.projectId,
      documentId: "basis",
      blob: new Blob(["basis"], { type: "application/pdf" })
    });
    const input = {
      projectId: project.projectId,
      command: {
        action: "ADD_BASIS_POSITION" as const,
        value: {
          documentId: "basis",
          positionNumber: "1.1.10",
          description: "Manuell erfasste Position",
          source: { pageNumber: 1, region: null }
        }
      },
      operatorId: "local-user",
      operatorLabel: "Lokaler Benutzer",
      comment: "OCR leer"
    };

    await expect(service.bootstrapManualBasisPosition(input)).rejects.toThrow(
      "MANUAL_BOOTSTRAP_NOT_ALLOWED"
    );
    await service.updateProject(project.projectId, {
      status: "FEHLER",
      processingFailureCode: "FAILED_NO_BASIS_POSITIONS",
      activeAnalysisVersionId: null
    });
    await expect(
      service.bootstrapManualBasisPosition({
        ...input,
        command: {
          ...input.command,
          value: { ...input.command.value, documentId: "offer" }
        }
      })
    ).rejects.toThrow("MANUAL_BOOTSTRAP_ACTIVE_BASIS_REQUIRED");
    await expect(
      service.bootstrapManualBasisPosition({
        ...input,
        command: {
          ...input.command,
          value: {
            ...input.command.value,
            source: { pageNumber: 3, region: null }
          }
        }
      })
    ).rejects.toThrow("MANUAL_CORRECTION_SOURCE_INVALID");
  });

  it("creates an immutable derived analysis, recalculates matching and invalidates stale selections", async () => {
    const { service, repositories, analysis } = await setup();
    const sourceLine = analysis.pilot.runs.find((run) => run.document.id === "offer")!.result
      .envelope.extraction.offerGroups[0]!.lines[0]!;

    const corrected = await service.applyManualCorrection({
      projectId: analysis.projectId,
      analysisVersionId: analysis.analysisVersionId,
      expectedRevision: 0,
      command: {
        action: "CORRECT_FIELDS",
        target: { kind: "SUPPLIER_LINE", entityId: sourceLine.id },
        patch: {
          shortLabel: "Umwälzpumpe A",
          description: "Umwälzpumpe Alpha",
          articleNumber: "ART-100",
          totalPrice: 90
        }
      },
      operatorId: "local-user",
      operatorLabel: "Lokaler Benutzer",
      comment: "Im PDF geprüft"
    });

    expect(corrected.analysisVersionId).not.toBe(analysis.analysisVersionId);
    expect(corrected.derivedFromAnalysisVersionId).toBe(analysis.analysisVersionId);
    expect(corrected.manualCorrections).toHaveLength(1);
    expect(corrected.manualCorrectionRevision).toBe(1);
    expect(corrected.manualDisplayLabels).toMatchObject({
      [`SUPPLIER_LINE:${sourceLine.id}`]: "Umwälzpumpe A"
    });
    expect(corrected.pilot.analysis?.matchLinks).not.toEqual(analysis.pilot.analysis?.matchLinks);
    expect(await repositories.analyses.get(analysis.projectId, analysis.analysisVersionId)).toEqual(
      analysis
    );
    expect((await service.latestAnalysis(analysis.projectId))?.analysisVersionId).toBe(
      corrected.analysisVersionId
    );
    expect(await service.listSelections(analysis.projectId)).toEqual([]);
  });

  it("replays the root analysis and appends a second correction with optimistic revision checking", async () => {
    const { service, repositories, analysis } = await setup();
    const first = await service.applyManualCorrection({
      projectId: analysis.projectId,
      analysisVersionId: analysis.analysisVersionId,
      expectedRevision: 0,
      command: {
        action: "ADD_BASIS_POSITION",
        value: {
          documentId: "basis",
          positionNumber: "1.1.20",
          shortLabel: "Pumpe Beta",
          description: "Manuell erfasste Pumpe Beta",
          quantity: 1,
          unit: "St",
          source: { pageNumber: 2, region: null }
        }
      },
      operatorId: "local-user",
      operatorLabel: "Lokaler Benutzer",
      comment: "OCR hat die Position nicht erkannt"
    });
    const second = await service.applyManualCorrection({
      projectId: analysis.projectId,
      analysisVersionId: first.analysisVersionId,
      expectedRevision: 1,
      command: {
        action: "ADD_SUPPLIER_LINE",
        value: {
          documentId: "offer",
          positionNumber: "1.1.20",
          shortLabel: "Pumpe Beta Angebot",
          description: "Manuell erfasste Pumpe Beta",
          quantity: 1,
          unit: "St",
          unitPrice: 80,
          totalPrice: 75,
          source: {
            pageNumber: 2,
            region: { x: 0.1, y: 0.2, width: 0.7, height: 0.2 }
          }
        }
      },
      operatorId: "local-user",
      operatorLabel: "Lokaler Benutzer",
      comment: "Angebotszeile manuell ergänzt"
    });

    expect(second.manualCorrections).toHaveLength(2);
    expect(second.manualCorrectionRevision).toBe(2);
    expect(second.analysisVersionId).toBe(first.analysisVersionId);
    expect(await repositories.analyses.list(analysis.projectId)).toHaveLength(2);
    expect(
      second.pilot.projectReview.positions.find(
        (position) => position.basis.positionNumber === "1.1.20"
      )?.options
    ).toEqual([
      expect.objectContaining({
        primaryPrice: 75,
        pricedTotal: 75
      })
    ]);
    const addedOfferLine = second.pilot.runs
      .find((run) => run.document.id === "offer")!
      .result.envelope.extraction.offerGroups.flatMap((group) => group.lines)
      .find((line) => line.sourcePositionNumber === "1.1.20");
    expect(addedOfferLine).toMatchObject({
      interpretedUnitPrice: 80,
      interpretedTotalPrice: 75
    });

    await expect(
      service.applyManualCorrection({
        projectId: analysis.projectId,
        analysisVersionId: second.analysisVersionId,
        expectedRevision: 1,
        command: {
          action: "CORRECT_FIELDS",
          target: {
            kind: "BASIS_POSITION",
            entityId: second.pilot.projectReview.positions[0]!.basis.id
          },
          patch: { description: "Veraltete Änderung" }
        },
        operatorId: "local-user",
        operatorLabel: "Lokaler Benutzer",
        comment: "stale"
      })
    ).rejects.toThrow("MANUAL_CORRECTION_REVISION_CONFLICT");
  });
});
