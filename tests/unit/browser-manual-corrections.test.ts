import { describe, expect, it } from "vitest";
import { buildBrowserAnalysis } from "@/browser-projects/browser-analysis";
import {
  appendManualCorrection,
  materializeManualCorrections,
  type BrowserManualCorrectionRecord
} from "@/browser-projects/manual-corrections";
import type { BrowserAnalysisSnapshot, BrowserDocumentRecord } from "@/browser-projects/types";

function document(
  documentId: string,
  documentType: BrowserDocumentRecord["documentType"],
  supplierName: string | null = null,
  pageCount = 2
): BrowserDocumentRecord {
  return {
    projectId: "project-1",
    documentId,
    originalFileName: `${documentId}.pdf`,
    mimeType: "application/pdf",
    size: 1_000,
    sha256: documentId.padEnd(64, "0").slice(0, 64),
    uploadedAt: "2026-09-08T08:00:00.000Z",
    pageCount,
    detectedDocumentType: documentType,
    documentType,
    discipline: "HEIZUNG",
    supplierName,
    offerNumber: null,
    documentVersion: null,
    revision: 1,
    revisionOfDocumentId: null,
    relationType: "SEPARATE_OFFER",
    scanState: "TEXT_AVAILABLE",
    projectName: null,
    projectNumber: null,
    lvNumber: null,
    classificationDimensions: {
      documentRole: "HIGH",
      supplier: "HIGH",
      discipline: "HIGH",
      projectIdentity: "HIGH",
      offerNumber: "HIGH",
      relation: "HIGH",
      scanState: "HIGH"
    },
    classificationSignals: [],
    textLayerCharacterCount: 1_000,
    preliminaryPositionCount: 1,
    activeBasis: documentType === "BASIS_LV",
    excludedFromProcessing: false,
    manualRoleOverride: false,
    manualBasisOverrideConfirmed: false,
    classificationConfidence: "HIGH",
    classificationWarnings: [],
    processingStatus: "BEREIT"
  };
}

const documents = [
  document("basis", "BASIS_LV"),
  document("supplier-a", "SUPPLIER_OFFER", "Supplier A"),
  document("supplier-b", "SUPPLIER_OFFER", "Supplier B")
];

function analysis(): BrowserAnalysisSnapshot {
  return buildBrowserAnalysis({
    projectId: "project-1",
    documents,
    result: {
      basisLines: [
        {
          documentId: "basis",
          positionNumber: "1.1.10",
          description: "Hocheffizienz Umwälzpumpe Alpha",
          quantity: 2,
          unit: "St",
          pageNumber: 1,
          lineIndex: 0,
          region: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 }
        }
      ],
      supplierLines: [
        {
          documentId: "supplier-a",
          positionNumber: "1.1.10",
          supplierPositionNumber: "10",
          description: "Fremder Text",
          quantity: 2,
          unit: "St",
          pageNumber: 1,
          lineIndex: 0,
          region: { x: 0.12, y: 0.3, width: 0.68, height: 0.08 },
          supplier: "Supplier A",
          articleNumber: "A-100",
          unitPrice: 100,
          totalPrice: 200
        },
        {
          documentId: "supplier-b",
          positionNumber: "1.1.10",
          supplierPositionNumber: "20",
          description: "Hocheffizienz Umwälzpumpe Alpha",
          quantity: 2,
          unit: "St",
          pageNumber: 1,
          lineIndex: 0,
          region: { x: 0.12, y: 0.4, width: 0.68, height: 0.08 },
          supplier: "Supplier B",
          articleNumber: "B-200",
          unitPrice: 75,
          totalPrice: 150
        }
      ],
      warnings: [],
      diagnostics: {
        pagesInspected: 3,
        pagesParsed: 3,
        ocrRequiredPages: 0,
        ocrProcessedPages: 0,
        ocrFailedPages: 0,
        matchingCandidates: 2,
        documents: documents.map(document => ({ documentId: document.documentId, pagesInspected: document.pageCount, candidatePositions: 1, extractedPositions: 1, missingSourceRegions: 0, ocrProcessedPages: 0, ocrFailedPages: 0, ocrRequiredPages: 0, multiPagePositions: 0 }))
      }
    }
  });
}

function supplierLine(snapshot: BrowserAnalysisSnapshot, documentId: string) {
  const line = snapshot.pilot.runs
    .find((run) => run.document.id === documentId)
    ?.result.envelope.extraction.offerGroups.flatMap((group) => group.lines)[0];
  if (!line) throw new Error(`Missing fixture line for ${documentId}`);
  return line;
}

function audit(id: string, minute: number) {
  return {
    id,
    operatorId: "operator-1",
    operatorLabel: "Lokaler Benutzer",
    reasonCode: "OCR_CORRECTION" as const,
    comment: "Am Original geprüft",
    createdAt: `2026-09-08T10:${String(minute).padStart(2, "0")}:00.000Z`
  };
}

function append(
  snapshot: BrowserAnalysisSnapshot,
  history: readonly BrowserManualCorrectionRecord[],
  command: Parameters<typeof appendManualCorrection>[0]["command"],
  id: string,
  expectedRevision = history.length
) {
  return appendManualCorrection({
    snapshot,
    documents,
    history,
    expectedRevision,
    command,
    audit: audit(id, expectedRevision)
  });
}

describe("browser-local manual OCR corrections", () => {
  it("keeps raw extraction immutable, supersedes append-only and fully recalculates prices", () => {
    const raw = analysis();
    const rawBefore = structuredClone(raw);
    const line = supplierLine(raw, "supplier-a");

    const first = append(
      raw,
      [],
      {
        action: "CORRECT_FIELDS",
        target: { kind: "SUPPLIER_LINE", entityId: line.id },
        patch: {
          description: "Hocheffizienz Umwälzpumpe Alpha",
          unitPrice: 99,
          totalPrice: 120
        }
      },
      "correction-1"
    );
    const second = append(
      raw,
      first.history,
      {
        action: "CORRECT_FIELDS",
        target: { kind: "SUPPLIER_LINE", entityId: line.id },
        patch: { totalPrice: 110 }
      },
      "correction-2"
    );

    expect(raw).toEqual(rawBefore);
    expect(second.history).toHaveLength(2);
    expect(second.record.previousValues).toMatchObject({ totalPrice: 120 });
    expect(second.record.supersedesIds).toContain("correction-1");
    expect(first.history[0]).toEqual(first.record);

    const effective = materializeManualCorrections({
      snapshot: raw,
      documents,
      history: second.history
    });
    const corrected = supplierLine(effective.snapshot, "supplier-a");
    expect(corrected).toMatchObject({
      description: "Hocheffizienz Umwälzpumpe Alpha",
      interpretedUnitPrice: 99,
      interpretedTotalPrice: 110,
      verificationStatus: "HUMAN_CORRECTED"
    });
    expect(corrected.lockedFields).toEqual(
      expect.arrayContaining(["description", "interpretedUnitPrice", "interpretedTotalPrice"])
    );
    expect(supplierLine(raw, "supplier-a").interpretedTotalPrice).toBe(200);

    const correctedOption = effective.snapshot.pilot.analysis?.supplierOptions.find(
      (option) => option.supplierDocumentId === "supplier-a"
    );
    const position = effective.snapshot.pilot.projectReview.positions[0];
    expect(correctedOption?.comparableTotal).toBe(110);
    expect(position.independent.systemCheapestOptionId).toBe(correctedOption?.id);
    expect(corrected.interpretedTotalPrice).not.toBe(
      corrected.quantity! * corrected.interpretedUnitPrice!
    );
  });

  it("recalculates quantity compatibility and match score after content edits", () => {
    const raw = analysis();
    const line = supplierLine(raw, "supplier-a");
    const originalLink = raw.pilot.analysis?.matchLinks.find((link) =>
      link.offerLineIds.includes(line.id)
    );
    const result = append(
      raw,
      [],
      {
        action: "CORRECT_FIELDS",
        target: { kind: "SUPPLIER_LINE", entityId: line.id },
        patch: {
          description: "Hocheffizienz Umwälzpumpe Alpha",
          quantity: 3
        }
      },
      "content-change"
    );
    const effective = materializeManualCorrections({
      snapshot: raw,
      documents,
      history: result.history
    });
    const nextLink = effective.snapshot.pilot.analysis?.matchLinks.find((link) =>
      link.offerLineIds.includes(line.id)
    );
    const option = effective.snapshot.pilot.analysis?.supplierOptions.find(
      (candidate) => candidate.supplierDocumentId === "supplier-a"
    );

    expect(nextLink?.score).toBeGreaterThan(originalLink?.score ?? 0);
    expect(option?.quantityCompatible).toBe(false);
  });

  it("allows a wrongly OCR-read LV position number to be corrected explicitly", () => {
    const raw = analysis();
    const line = supplierLine(raw, "supplier-a");
    const appended = append(
      raw,
      [],
      {
        action: "CORRECT_FIELDS",
        target: { kind: "SUPPLIER_LINE", entityId: line.id },
        patch: { positionNumber: " 1.1.99. " }
      },
      "position-number-change"
    );
    const effective = materializeManualCorrections({
      snapshot: raw,
      documents,
      history: appended.history
    });
    const corrected = supplierLine(effective.snapshot, "supplier-a");

    expect(appended.record.previousValues.positionNumber).toBe("1.1.10");
    expect(corrected.sourcePositionNumber).toBe("1.1.99");
    expect(corrected.lockedFields).toContain("sourcePositionNumber");
  });

  it("corrects an existing Basis position and rebuilds every dependent option", () => {
    const raw = analysis();
    const basis = raw.pilot.analysis!.basisPositions[0];
    const originalEvidence = structuredClone(basis.evidence[0]);
    const appended = append(
      raw,
      [],
      {
        action: "CORRECT_FIELDS",
        target: { kind: "BASIS_POSITION", entityId: basis.id },
        patch: {
          description: "Hocheffizienz Umwälzpumpe Alpha korrigiert",
          quantity: 3,
          unit: "St",
          source: {
            pageNumber: 2,
            region: { x: 0.08, y: 0.18, width: 0.75, height: 0.14 }
          }
        }
      },
      "basis-change"
    );
    const effective = materializeManualCorrections({
      snapshot: raw,
      documents,
      history: appended.history
    });
    const corrected = effective.snapshot.pilot.analysis!.basisPositions[0];

    expect(corrected).toMatchObject({
      description: "Hocheffizienz Umwälzpumpe Alpha korrigiert",
      quantity: 3,
      unit: "St",
      verificationStatus: "HUMAN_CORRECTED"
    });
    expect(corrected.evidence[0]).toMatchObject({
      pageNumber: 2,
      status: "VERIFIED_VISUAL",
      region: { x: 0.08, y: 0.18, width: 0.75, height: 0.14 }
    });
    expect(
      effective.snapshot.pilot.analysis!.supplierOptions.every(
        (option) => !option.quantityCompatible
      )
    ).toBe(true);
    expect(basis.evidence[0]).toEqual(originalEvidence);
    expect(basis.quantity).toBe(2);
  });

  it("changes only effective source geometry and records visual provenance", () => {
    const raw = analysis();
    const line = supplierLine(raw, "supplier-a");
    const originalEvidence = structuredClone(line.evidence[0]);
    const appended = append(
      raw,
      [],
      {
        action: "CORRECT_FIELDS",
        target: {
          kind: "SUPPLIER_LINE",
          entityId: line.id,
          evidenceId: line.evidence[0].id
        },
        patch: {
          source: {
            pageNumber: 2,
            region: { x: 0.2, y: 0.25, width: 0.5, height: 0.12 }
          }
        }
      },
      "source-change"
    );
    const effective = materializeManualCorrections({
      snapshot: raw,
      documents,
      history: appended.history
    });
    const correctedEvidence = supplierLine(effective.snapshot, "supplier-a").evidence[0];

    expect(correctedEvidence).toMatchObject({
      pageNumber: 2,
      region: { x: 0.2, y: 0.25, width: 0.5, height: 0.12 },
      status: "VERIFIED_VISUAL",
      sourceText: originalEvidence.sourceText
    });
    expect(line.evidence[0]).toEqual(originalEvidence);
    expect(effective.evidenceStatusByEntity[`SUPPLIER_LINE:${line.id}`]).toBe("VERIFIED_VISUAL");
  });

  it("adds OCR-missed Basis and supplier rows without inventing source geometry", () => {
    const raw = analysis();
    const basisAdded = append(
      raw,
      [],
      {
        action: "ADD_BASIS_POSITION",
        value: {
          documentId: "basis",
          positionNumber: "1.1.20",
          shortLabel: "Nachspeisepumpe",
          description: "Nachspeisepumpe Beta",
          quantity: 1,
          unit: "St",
          source: { pageNumber: 1, region: null }
        }
      },
      "add-basis"
    );
    const supplierAdded = append(
      raw,
      basisAdded.history,
      {
        action: "ADD_SUPPLIER_LINE",
        value: {
          documentId: "supplier-a",
          positionNumber: "1.1.20",
          supplierPositionNumber: "30",
          shortLabel: "Nachspeisepumpe Angebot",
          description: "Nachspeisepumpe Beta",
          articleNumber: "A-200",
          quantity: 1,
          unit: "St",
          unitPrice: 50,
          totalPrice: 50,
          source: {
            pageNumber: 1,
            region: { x: 0.15, y: 0.55, width: 0.65, height: 0.09 }
          }
        }
      },
      "add-supplier"
    );
    const effective = materializeManualCorrections({
      snapshot: raw,
      documents,
      history: supplierAdded.history
    });
    const addedBasis = effective.snapshot.pilot.analysis?.basisPositions.find(
      (position) => position.id === basisAdded.record.entityId
    );
    const addedSupplier = supplierLine(effective.snapshot, "supplier-a");
    const manualSupplier = effective.snapshot.pilot.runs
      .find((run) => run.document.id === "supplier-a")
      ?.result.envelope.extraction.offerGroups.flatMap((group) => group.lines)
      .find((line) => line.id === supplierAdded.record.entityId);
    const reviewPosition = effective.snapshot.pilot.projectReview.positions.find(
      (position) => position.basis.id === basisAdded.record.entityId
    );

    expect(addedBasis).toMatchObject({
      positionNumber: "1.1.20",
      verificationStatus: "HUMAN_CORRECTED",
      evidence: [
        {
          pageNumber: 1,
          status: "MISSING",
          region: { x: 0, y: 0, width: 0, height: 0 }
        }
      ]
    });
    expect(effective.evidenceStatusByEntity[`BASIS_POSITION:${basisAdded.record.entityId}`]).toBe(
      "MISSING"
    );
    expect(manualSupplier).toMatchObject({
      description: "Nachspeisepumpe Beta",
      articleNumber: "A-200",
      interpretedTotalPrice: 50,
      verificationStatus: "HUMAN_CORRECTED"
    });
    expect(manualSupplier?.evidence[0]?.status).toBe("VERIFIED_VISUAL");
    expect(
      reviewPosition?.options.some((option) =>
        option.matchedOfferLineIds.includes(supplierAdded.record.entityId)
      )
    ).toBe(true);
    expect(effective.displayLabels).toMatchObject({
      [`BASIS_POSITION:${basisAdded.record.entityId}`]: "Nachspeisepumpe",
      [`SUPPLIER_LINE:${supplierAdded.record.entityId}`]: "Nachspeisepumpe Angebot"
    });
    expect(supplierLine(raw, "supplier-a")).toEqual(addedSupplier);
  });

  it("fails closed for invalid fields, numbers, source bounds and stale revisions", () => {
    const raw = analysis();
    const line = supplierLine(raw, "supplier-a");

    expect(() =>
      append(
        raw,
        [],
        {
          action: "CORRECT_FIELDS",
          target: { kind: "BASIS_POSITION", entityId: "basis:basis:1.1.10" },
          patch: { articleNumber: "NOT-ALLOWED" }
        },
        "bad-field"
      )
    ).toThrow("MANUAL_CORRECTION_FIELD_NOT_ALLOWED");
    expect(() =>
      append(
        raw,
        [],
        {
          action: "CORRECT_FIELDS",
          target: { kind: "SUPPLIER_LINE", entityId: line.id },
          patch: { totalPrice: Number.NaN }
        },
        "bad-number"
      )
    ).toThrow("MANUAL_CORRECTION_VALUE_INVALID");
    expect(() =>
      append(
        raw,
        [],
        {
          action: "CORRECT_FIELDS",
          target: { kind: "SUPPLIER_LINE", entityId: line.id },
          patch: {
            source: {
              pageNumber: 3,
              region: { x: 0.9, y: 0.9, width: 0.2, height: 0.2 }
            }
          }
        },
        "bad-source"
      )
    ).toThrow("MANUAL_CORRECTION_SOURCE_INVALID");
    expect(() =>
      append(
        raw,
        [],
        {
          action: "CORRECT_FIELDS",
          target: { kind: "SUPPLIER_LINE", entityId: line.id },
          patch: { description: "Korrigiert" }
        },
        "stale-revision",
        1
      )
    ).toThrow("MANUAL_CORRECTION_REVISION_CONFLICT");
  });

  it("revalidates persisted history instead of trusting a tampered correction", () => {
    const raw = analysis();
    const line = supplierLine(raw, "supplier-a");
    const appended = append(
      raw,
      [],
      {
        action: "CORRECT_FIELDS",
        target: { kind: "SUPPLIER_LINE", entityId: line.id },
        patch: { totalPrice: 120 }
      },
      "valid-before-tamper"
    );
    const tampered = structuredClone(appended.history);
    const command = tampered[0].command;
    if (command.action !== "CORRECT_FIELDS") throw new Error("Unexpected fixture");
    command.patch.totalPrice = -1;

    expect(() =>
      materializeManualCorrections({
        snapshot: raw,
        documents,
        history: tampered
      })
    ).toThrow("MANUAL_CORRECTION_VALUE_INVALID");
  });
});
