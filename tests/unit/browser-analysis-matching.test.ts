import { describe, expect, it } from "vitest";
import { applyBrowserMatchReview, buildBrowserAnalysis, browserWorkerResultFromAnalysis } from "@/browser-projects/browser-analysis";
import type { BrowserWorkerResult } from "@/browser-projects/processing-protocol";
import type { BrowserDocumentRecord } from "@/browser-projects/types";
import { sourceRecordsFor } from "@/components/lv/lv-comparison-page";

const projectId = "project-matching";

function document(input: {
  documentId: string;
  documentType: "BASIS_LV" | "SUPPLIER_OFFER";
  supplierName?: string;
}): BrowserDocumentRecord {
  const basis = input.documentType === "BASIS_LV";
  return {
    projectId,
    documentId: input.documentId,
    originalFileName: basis ? "Basis-LV.pdf" : `${input.supplierName}.pdf`,
    mimeType: "application/pdf",
    size: 1_024,
    sha256: input.documentId.padEnd(64, "0").slice(0, 64),
    uploadedAt: "2026-08-31T12:00:00.000Z",
    pageCount: 1,
    detectedDocumentType: input.documentType,
    documentType: input.documentType,
    discipline: "HEIZUNG",
    supplierName: input.supplierName ?? null,
    offerNumber: basis ? null : "A-100",
    documentVersion: null,
    revision: 1,
    revisionOfDocumentId: null,
    relationType: "SEPARATE_OFFER",
    scanState: "TEXT_AVAILABLE",
    projectName: null,
    projectNumber: null,
    lvNumber: basis ? "LV-1" : null,
    classificationDimensions: {
      documentRole: "HIGH",
      supplier: basis ? "LOW" : "HIGH",
      discipline: "HIGH",
      projectIdentity: "LOW",
      offerNumber: basis ? "LOW" : "HIGH",
      relation: "HIGH",
      scanState: "HIGH"
    },
    classificationSignals: [],
    textLayerCharacterCount: 200,
    preliminaryPositionCount: 1,
    activeBasis: basis,
    excludedFromProcessing: false,
    manualRoleOverride: false,
    manualBasisOverrideConfirmed: false,
    classificationConfidence: "HIGH",
    classificationWarnings: [],
    processingStatus: "BEREIT"
  };
}

function result(
  basis: BrowserWorkerResult["basisLines"],
  supplier: BrowserWorkerResult["supplierLines"]
): BrowserWorkerResult {
  return {
    basisLines: basis,
    supplierLines: supplier,
    warnings: [],
    diagnostics: {
      pagesInspected: 2,
      pagesParsed: 2,
      ocrRequiredPages: 0,
      matchingCandidates: supplier.length,
      documents: [...new Set([...basis, ...supplier].map(line => line.documentId))].map(documentId => {
        const lines = [...basis, ...supplier].filter(line => line.documentId === documentId);
        return { documentId, pagesInspected: Math.max(...lines.map(line => line.pageNumber)), candidatePositions: lines.length, extractedPositions: lines.length, missingSourceRegions: 0, ocrProcessedPages: 0, ocrFailedPages: 0, ocrRequiredPages: 0, multiPagePositions: 0 };
      })
    }
  };
}

const documents = [
  document({ documentId: "basis-doc", documentType: "BASIS_LV" }),
  document({
    documentId: "supplier-a",
    documentType: "SUPPLIER_OFFER",
    supplierName: "Lieferant A"
  })
];

describe("browser PDF analysis matching", () => {
  const sampleBasis = { documentId: "basis-doc", positionNumber: "1.1.10", description: "Hocheffizienz Umwälzpumpe", quantity: 3, unit: "St", pageNumber: 1, lineIndex: 0, region: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 } };
  const sampleOffer = { ...sampleBasis, documentId: "supplier-a", supplier: "Lieferant A", articleNumber: "SYN-814", unitPrice: 100, totalPrice: 300 };

  it("retains price bases and source geometry through an incremental rebuild", () => {
    const input = result([{ ...sampleBasis, reviewReasons: ["OCR_SOURCE"], continuationEvidence: [{ pageNumber: 2, sourceText: "Fortsetzung", region: sampleBasis.region }] }], [{ ...sampleOffer, supplierPositionNumber: "70", priceBasis: 100 }]);
    const snapshot = buildBrowserAnalysis({ projectId, documents, result: input });
    const rebuilt = browserWorkerResultFromAnalysis(snapshot, documents);
    expect(rebuilt.basisLines[0].region).toEqual(sampleBasis.region);
    expect(rebuilt.basisLines[0].reviewReasons).toContain("OCR_SOURCE");
    expect(rebuilt.basisLines[0].continuationEvidence?.[0].pageNumber).toBe(2);
    expect(rebuilt.supplierLines[0]).toMatchObject({ positionNumber: "1.1.10", supplierPositionNumber: "70", priceBasis: 100, region: sampleBasis.region });
  });

  it("does not mark a fully read but unclassified document as covered", () => {
    const input = result([sampleBasis], []);
    input.diagnostics.documents.push({ documentId: "supplier-a", pagesInspected: 1, candidatePositions: 0, extractedPositions: 0, missingSourceRegions: 0, ocrProcessedPages: 1, ocrFailedPages: 0, ocrRequiredPages: 0, multiPagePositions: 0 });
    const snapshot = buildBrowserAnalysis({ projectId, documents: documents.map(doc => doc.documentId === "supplier-a" ? { ...doc, documentType: "UNKNOWN" as const } : doc), result: input });
    expect(snapshot.pilot.projectReview.coverage.allRelevantOffersProcessed).toBe(false);
  });

  it("retains unresolved extraction warnings through a rebuild", () => {
    const snapshot = buildBrowserAnalysis({ projectId, documents, result: result([sampleBasis], [{ ...sampleOffer, reviewReasons: ["QUANTITY_AMBIGUOUS"] }]) });
    const rebuilt = browserWorkerResultFromAnalysis(snapshot, documents);
    expect(rebuilt.supplierLines[0].reviewReasons).toContain("QUANTITY_AMBIGUOUS");
    expect(buildBrowserAnalysis({ projectId, documents, result: rebuilt }).pilot.analysis?.supplierOptions[0].comparableTotal).toBeNull();
  });

  it("keeps a recognized different-discipline offer out of this LV", () => {
    const snapshot = buildBrowserAnalysis({ projectId, documents: documents.map(doc => doc.documentId === "supplier-a" ? { ...doc, discipline: "SANITAER" as const } : doc), result: result([sampleBasis], [sampleOffer]) });
    expect(snapshot.pilot.analysis?.supplierOptions).toHaveLength(0);
    expect(snapshot.pilot.projectReview.coverage.relevantSupplierDocumentIds).toHaveLength(0);
  });

  it("uses the full-run classification before accepting OCR offer rows", () => {
    const supplier = documents[1];
    const input = result([sampleBasis], [{ ...sampleOffer, reviewReasons: ["OCR_SOURCE"] }]);
    input.documentClassifications = [{ documentId: supplier.documentId, classification: {
      ...supplier, detectedDocumentType: "SUPPLIER_OFFER", documentType: "SUPPLIER_OFFER", scanState: "OCR_AVAILABLE", confidence: "MEDIUM", dimensions: supplier.classificationDimensions, signals: ["Ausgefülltes LV zurückgegeben"], warnings: [], preliminaryPositionCount: 1
    } }];
    const snapshot = buildBrowserAnalysis({ projectId, documents: [documents[0], { ...supplier, documentType: "SCAN_OCR_REQUIRED", discipline: "UNKNOWN" }], result: input });
    expect(snapshot.summary.supplierOffers).toBe(1);
    expect(snapshot.pilot.runs.find(run => run.document.id === supplier.documentId)?.result.envelope.extraction.offerGroups[0].lines).toHaveLength(1);
    expect(snapshot.pilot.analysis?.supplierOptions[0].comparableTotal).toBeNull();
  });

  it("never confirms technical equivalence from a matching number alone", () => {
    const snapshot = buildBrowserAnalysis({ projectId, documents, result: result([sampleBasis], [{ ...sampleOffer, description: "Waschtisch Keramik weiß" }]) });
    expect(snapshot.pilot.analysis?.supplierOptions[0].comparableTotal).toBeNull();
    expect(snapshot.pilot.analysis?.supplierOptions[0].matchingReliable).toBe(false);
  });

  it("preserves explicit alternative and no-offer semantics from supplier text", () => {
    const snapshot = buildBrowserAnalysis({ projectId, documents, result: result([sampleBasis], [
      sampleOffer,
      { ...sampleOffer, lineIndex: 1, description: "Wahlweise Umwälzpumpe andere Ausführung", totalPrice: 450 },
      { ...sampleOffer, lineIndex: 2, positionNumber: "1.1.20", description: "Nicht im Lieferprogramm", totalPrice: null, unitPrice: null }
    ]) });
    const lines = snapshot.pilot.runs.flatMap(run => run.result.envelope.extraction.offerGroups.flatMap(group => group.lines));
    expect(lines.map(line => line.role)).toEqual(["PRIMARY", "ALTERNATIVE", "NOT_OFFERED"]);
    expect(snapshot.pilot.analysis?.supplierOptions[0].pricedTotal).toBe(300);
  });

  it("retains explicit manufacturer and technical requirements from Basis text", () => {
    const snapshot = buildBrowserAnalysis({ projectId, documents, result: result([{ ...sampleBasis, description: "Umwälzpumpe DN 25 Fabrikat: Synthetic Typ: Eco 25 Art.-Nr.: SYN-814 Komplett liefern und montieren." }], [sampleOffer]) });
    expect(snapshot.pilot.analysis?.basisPositions[0].manufacturerRequirements).toEqual(["Synthetic"]);
    expect(snapshot.pilot.analysis?.basisPositions[0].technicalAttributes).toContainEqual({ name: "Nennweite", value: "DN 25" });
  });

  it("does not declare incomplete OCR supplier documents fully processed", () => {
    const input = result([sampleBasis], [sampleOffer]);
    input.diagnostics.documents = [
      { documentId: "basis-doc", pagesInspected: 1, candidatePositions: 1, extractedPositions: 1, missingSourceRegions: 0, ocrProcessedPages: 0, ocrFailedPages: 0, ocrRequiredPages: 0, multiPagePositions: 0 },
      { documentId: "supplier-a", pagesInspected: 3, candidatePositions: 2, extractedPositions: 1, missingSourceRegions: 0, ocrProcessedPages: 2, ocrFailedPages: 1, ocrRequiredPages: 1, multiPagePositions: 0 }
    ];
    const snapshot = buildBrowserAnalysis({ projectId, documents: documents.map(doc => doc.documentId === "supplier-a" ? { ...doc, pageCount: 3 } : doc), result: input });
    expect(snapshot.pilot.projectReview.coverage.allRelevantOffersProcessed).toBe(false);
    expect(snapshot.pilot.projectReview.coverage.processedSupplierDocumentIds).not.toContain("supplier-a");
    expect(snapshot.pilot.projectReview.positions[0].coverage.coverageStatus).not.toBe("SUFFICIENT");
  });

  it("rejects extracted rows from documents outside the active project input", () => {
    expect(() => buildBrowserAnalysis({ projectId, documents, result: result([sampleBasis], [{ ...sampleOffer, documentId: "foreign-document" }]) })).toThrow("EXTRACTION_DOCUMENT_MISMATCH");
  });

  it("assigns supplier lines to runs by exact document ID rather than substring", () => {
    const docs = [...documents, document({ documentId: "supplier-ab", documentType: "SUPPLIER_OFFER", supplierName: "Lieferant B" })];
    const snapshot = buildBrowserAnalysis({ projectId, documents: docs, result: result([sampleBasis], [sampleOffer, { ...sampleOffer, documentId: "supplier-ab", supplier: "Lieferant B" }]) });
    const a = snapshot.pilot.runs.find(run => run.document.id === "supplier-a")!;
    expect(a.result.envelope.extraction.offerGroups[0].lines).toHaveLength(1);
  });

  it("persists per-document full-run diagnostics in the analysis summary", () => {
    const input = result(
      [
        {
          documentId: "basis-doc",
          positionNumber: "1.1.10",
          description: "Prüfposition",
          quantity: 1,
          unit: "St",
          pageNumber: 1,
          lineIndex: 0,
          region: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }
        }
      ],
      []
    );
    input.diagnostics.documents = [
      {
        documentId: "basis-doc",
        pagesInspected: 9,
        candidatePositions: 12,
        extractedPositions: 11,
        missingSourceRegions: 1,
        ocrProcessedPages: 2,
        ocrFailedPages: 1,
        ocrRequiredPages: 1,
        multiPagePositions: 3
      }
    ];
    const snapshot = buildBrowserAnalysis({ projectId, documents, result: input });

    expect(snapshot.summary.documentDiagnostics).toEqual(input.diagnostics.documents);
  });

  it("preserves continuation evidence on later pages for Basis and supplier lines", () => {
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "1.1.10",
            description: "Mehrseitige Basisposition",
            quantity: 2,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            region: { x: 0.1, y: 0.7, width: 0.6, height: 0.2 },
            reviewReasons: ["MULTI_PAGE_POSITION"],
            continuationEvidence: [
              {
                pageNumber: 2,
                sourceText: "Fortsetzung der Basisposition",
                region: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 }
              },
              {
                pageNumber: 3,
                sourceText: "Abschluss der Basisposition",
                region: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 }
              }
            ]
          }
        ],
        [
          {
            documentId: "supplier-a",
            positionNumber: "1.1.10",
            description: "Mehrseitige Angebotsposition",
            quantity: 2,
            unit: "St",
            pageNumber: 3,
            lineIndex: 0,
            region: { x: 0.1, y: 0.7, width: 0.6, height: 0.2 },
            reviewReasons: ["MULTI_PAGE_POSITION"],
            continuationEvidence: [
              {
                pageNumber: 4,
                sourceText: "Fortsetzung der Angebotsposition",
                region: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 }
              }
            ],
            supplier: "Lieferant A",
            articleNumber: "A-10",
            unitPrice: 10,
            totalPrice: 20
          }
        ]
      )
    });

    const basis = snapshot.pilot.projectReview.positions[0].basis;
    expect(basis.evidence.map((item) => item.pageNumber)).toEqual([1]);
    expect(basis.continuationEvidence?.map((item) => item.pageNumber)).toEqual([
      2,
      3
    ]);
    const supplier = snapshot.pilot.runs
      .flatMap((run) => run.result.envelope.extraction.offerGroups)
      .flatMap((group) => group.lines)[0];
    expect(supplier.evidence.map((item) => item.pageNumber)).toEqual([3, 4]);

    const records = sourceRecordsFor(
      snapshot.pilot,
      snapshot.pilot.projectReview.positions[0],
      new Map([[supplier.id, supplier]])
    );
    expect(
      records.filter((record) => record.kind === "basis").map((record) => record.pageNumber)
    ).toEqual([1, 2, 3]);
    expect(
      records.filter((record) => record.kind === "supplier").map((record) => record.pageNumber)
    ).toEqual([3, 4]);
  });

  it("preserves measured PDF text geometry and never fabricates a line position", () => {
    const measured = { x: 0.12, y: 0.34, width: 0.7, height: 0.04 };
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "1.1.10",
            description: "Hocheffizienz Umwälzpumpe",
            quantity: 2,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            region: measured
          }
        ],
        []
      )
    });

    expect(
      snapshot.pilot.projectReview.positions[0].basis.evidence[0]
    ).toMatchObject({
      region: measured,
      status: "VERIFIED_NATIVE"
    });

    const withoutGeometry = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "1.1.20",
            description: "Absperrventil",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 1
          }
        ],
        []
      )
    });
    expect(
      withoutGeometry.pilot.projectReview.positions[0].basis.evidence[0]
    ).toMatchObject({
      region: { x: 0, y: 0, width: 0, height: 0 },
      status: "MISSING"
    });
    expect(
      withoutGeometry.pilot.projectReview.positions[0].basis.verificationStatus
    ).toBe("NEEDS_REVIEW");
  });

  it("keeps a directly numbered offer non-comparable when source geometry is missing", () => {
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "1.1.30",
            description: "Absperrventil DN 25",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0
          }
        ],
        [
          {
            documentId: "supplier-a",
            positionNumber: "1.1.30",
            description: "Absperrventil DN 25",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            supplier: "Lieferant A",
            articleNumber: "V-25",
            unitPrice: 80,
            totalPrice: 80
          }
        ]
      )
    });

    expect(snapshot.pilot.analysis?.matchLinks[0]).toMatchObject({
      status: "EXACT",
      confirmedByOperator: false
    });
    expect(snapshot.pilot.analysis?.supplierOptions[0]).toMatchObject({
      evidenceSufficient: false,
      comparableTotal: null
    });
    expect(
      snapshot.pilot.runs
        .flatMap((run) => run.result.envelope.extraction.offerGroups)
        .flatMap((group) => group.lines)[0]
    ).toMatchObject({ verificationStatus: "NEEDS_REVIEW" });
  });

  it("keeps measured but structurally ambiguous extraction out of automatic comparison", () => {
    const region = { x: 0.1, y: 0.2, width: 0.7, height: 0.08 };
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "1.1.40",
            description: "Synthetische Regelgruppe",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            region,
            reviewReasons: ["BARE_POSITION_SINGLETON"]
          }
        ],
        [
          {
            documentId: "supplier-a",
            positionNumber: "1.1.40",
            description: "Synthetische Regelgruppe",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            region,
            reviewReasons: ["MULTI_PAGE_POSITION"],
            supplier: "Lieferant A",
            articleNumber: "DEMO-40",
            unitPrice: 40,
            totalPrice: 40
          }
        ]
      )
    });

    expect(snapshot.pilot.analysis?.basisPositions[0]).toMatchObject({
      verificationStatus: "NEEDS_REVIEW",
      evidence: [expect.objectContaining({ status: "VISUAL_ONLY_UNCONFIRMED" })]
    });
    expect(
      snapshot.pilot.runs
        .flatMap((run) => run.result.envelope.extraction.offerGroups)
        .flatMap((group) => group.lines)[0]
    ).toMatchObject({
      verificationStatus: "NEEDS_REVIEW",
      evidence: [expect.objectContaining({ status: "VISUAL_ONLY_UNCONFIRMED" })]
    });
    expect(snapshot.pilot.analysis?.supplierOptions[0]).toMatchObject({
      extractionValidated: false,
      evidenceSufficient: false,
      comparableTotal: null
    });
  });

  it("keeps a strong text candidate when supplier numbering differs, but blocks price comparison until confirmation", () => {
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "1.1.10",
            description: "Hocheffizienz Umwälzpumpe Heizkreis DN 25",
            quantity: 2,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            region: { x: 0.1, y: 0.1, width: 0.6, height: 0.08 }
          }
        ],
        [
          {
            documentId: "supplier-a",
            positionNumber: "4711",
            description: "Umwälzpumpe Heizkreis DN 25 Hocheffizienz",
            quantity: 2,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            supplier: "Lieferant A",
            articleNumber: "P-25",
            unitPrice: 100,
            totalPrice: 200,
            region: { x: 0.1, y: 0.2, width: 0.6, height: 0.08 }
          }
        ]
      )
    });

    expect(snapshot.pilot.analysis?.matchLinks).toHaveLength(1);
    expect(snapshot.pilot.analysis?.matchLinks[0]).toMatchObject({
      status: "PROBABLE",
      confirmedByOperator: false
    });
    expect(snapshot.pilot.analysis?.matchLinks[0].reasons).toContain(
      "Beschreibung ist inhaltlich ähnlich"
    );
    expect(snapshot.pilot.analysis?.supplierOptions[0]).toMatchObject({
      supplierLabel: "Lieferant A",
      matchingAccepted: false,
      matchingReliable: false,
      comparableTotal: null
    });
    expect(snapshot.pilot.projectReview.positions[0].liveStatus).toBe("MANUAL_DECISION_REQUIRED");
  });

  it("recognizes a supplier LV range as an exact source reference", () => {
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "1.1.15",
            description: "Absperrventil DN 25",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0
          }
        ],
        [
          {
            documentId: "supplier-a",
            positionNumber: "1.1.10-20",
            description: "Absperrventil DN 25",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            supplier: "Lieferant A",
            articleNumber: "V-25",
            unitPrice: 80,
            totalPrice: 80
          }
        ]
      )
    });

    expect(snapshot.pilot.analysis?.matchLinks).toHaveLength(1);
    expect(snapshot.pilot.analysis?.matchLinks[0]).toMatchObject({
      status: "EXACT",
      confirmedByOperator: false
    });
    expect(snapshot.pilot.analysis?.matchLinks[0].reasons).toContain("Direkter LV-Positionsbezug");
  });

  it("keeps same-reference supplier rows as one priced bundle instead of choosing an incomplete cheap row", () => {
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "2.1.730",
            description: "Manometer mit Manometerventil",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0
          }
        ],
        [
          {
            documentId: "supplier-a",
            positionNumber: "2.1.730",
            description: "Manometer",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            supplier: "Lieferant A",
            articleNumber: "M-1",
            unitPrice: 92.88,
            totalPrice: 92.88
          },
          {
            documentId: "supplier-a",
            positionNumber: "2.1.730",
            description: "Manometerventil",
            quantity: 1,
            unit: "St",
            pageNumber: 1,
            lineIndex: 1,
            supplier: "Lieferant A",
            articleNumber: "MV-1",
            unitPrice: 213.84,
            totalPrice: 213.84
          }
        ]
      )
    });

    expect(snapshot.pilot.analysis?.supplierOptions).toHaveLength(1);
    expect(snapshot.pilot.analysis?.supplierOptions[0]).toMatchObject({
      matchedOfferLineIds: expect.arrayContaining([
        "supplier-line:supplier-a:2.1.730:0",
        "supplier-line:supplier-a:2.1.730:1"
      ]),
      pricedTotal: 306.72
    });
  });

  it("recalculates comparability after a human confirms or rejects a probable match without changing extraction", () => {
    const snapshot = buildBrowserAnalysis({
      projectId,
      documents,
      result: result(
        [
          {
            documentId: "basis-doc",
            positionNumber: "3.1.10",
            description: "Hocheffizienz Umwälzpumpe Heizkreis DN 25",
            quantity: 2,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            region: { x: 0.1, y: 0.1, width: 0.6, height: 0.08 }
          }
        ],
        [
          {
            documentId: "supplier-a",
            positionNumber: "4711",
            description: "Umwälzpumpe Heizkreis DN 25 Hocheffizienz",
            quantity: 2,
            unit: "St",
            pageNumber: 1,
            lineIndex: 0,
            supplier: "Lieferant A",
            articleNumber: "P-25",
            unitPrice: 100,
            totalPrice: 200,
            region: { x: 0.1, y: 0.2, width: 0.6, height: 0.08 }
          }
        ]
      )
    });
    const link = snapshot.pilot.analysis?.matchLinks[0];
    if (!link) throw new Error("Expected probable match link");
    const extractionBefore = structuredClone(snapshot.pilot.runs);

    const confirmed = applyBrowserMatchReview(snapshot, {
      projectId,
      analysisVersionId: snapshot.analysisVersionId,
      matchLinkId: link.id,
      positionId: link.basisPositionIds[0],
      decision: "CONFIRMED",
      operator: "Lokaler Benutzer",
      comment: "Technisch geprüft",
      updatedAt: "2026-08-31T12:30:00.000Z"
    });

    expect(confirmed.analysisVersionId).toBe(snapshot.analysisVersionId);
    expect(confirmed.pilot.runs).toEqual(extractionBefore);
    expect(confirmed.pilot.analysis?.matchLinks[0].confirmedByOperator).toBe(true);
    expect(confirmed.pilot.analysis?.supplierOptions[0]).toMatchObject({
      matchingAccepted: true,
      matchingReliable: true,
      pricedTotal: 200,
      comparableTotal: 200
    });
    expect(confirmed.pilot.projectReview.positions[0].liveStatus).toBe(
      "AUTO_SELECTED_LOWEST_PRICE"
    );

    const rejected = applyBrowserMatchReview(confirmed, {
      projectId,
      analysisVersionId: snapshot.analysisVersionId,
      matchLinkId: link.id,
      positionId: link.basisPositionIds[0],
      decision: "REJECTED",
      operator: "Lokaler Benutzer",
      comment: "Andere technische Ausführung",
      updatedAt: "2026-08-31T12:35:00.000Z"
    });
    expect(rejected.pilot.runs).toEqual(extractionBefore);
    expect(rejected.pilot.analysis?.matchLinks[0]).toMatchObject({
      status: "UNMATCHED",
      confirmedByOperator: false
    });
    expect(rejected.pilot.analysis?.supplierOptions[0].comparableTotal).toBeNull();
  });
});
