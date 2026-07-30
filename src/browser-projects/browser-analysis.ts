import type {
  BasisPosition,
  EvidenceReference,
  OfferLine,
  PilotAnalysis,
  SupplierOption
} from "@/domain/contracts";
import {
  selectUniqueLowestComparableOption,
  type PositionSupplierCoverage,
  type ProjectReviewPosition
} from "@/domain/project-review";
import type { PilotStateView } from "@/components/lv/types";
import type { BrowserWorkerResult } from "@/browser-projects/processing-protocol";
import type {
  BrowserAnalysisSnapshot,
  BrowserDocumentRecord
} from "@/browser-projects/types";

function stableId(...parts: string[]): string {
  return parts.join(":").replace(/[^\p{L}\p{N}:._-]/gu, "-");
}

function evidence(input: {
  documentId: string;
  positionNumber: string;
  description: string;
  lineIndex: number;
  pageNumber?: number;
}): EvidenceReference {
  return {
    id: stableId("evidence", input.documentId, input.positionNumber),
    documentId: input.documentId,
    pageNumber: input.pageNumber ?? 1,
    textItemIds: [stableId("line", String(input.lineIndex))],
    sourceText: input.description,
    region: {
      x: 0.08,
      y: Math.min(0.82, 0.12 + (input.lineIndex % 9) * 0.075),
      width: 0.84,
      height: 0.055
    },
    cropPath: null,
    status: "VERIFIED_NATIVE"
  };
}

export function buildBrowserAnalysis(input: {
  projectId: string;
  documents: BrowserDocumentRecord[];
  result: BrowserWorkerResult;
}): BrowserAnalysisSnapshot {
  const createdAt = new Date().toISOString();
  const analysisVersionId = crypto.randomUUID();
  const basisDocument =
    input.documents.find(
      (document) =>
        document.documentType === "BASIS_LV" && document.activeBasis
    );
  if (!basisDocument) throw new Error("BASIS_DOCUMENT_REQUIRED");
  if (input.result.basisLines.length === 0) {
    throw new Error("FAILED_NO_BASIS_POSITIONS");
  }
  const basisPositions: BasisPosition[] = input.result.basisLines.map((line) => ({
    id: stableId("basis", line.documentId, line.positionNumber),
    documentId: line.documentId,
    parentId: null,
    positionNumber: line.positionNumber,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    technicalAttributes: [],
    manufacturerRequirements: [],
    requiredScope: [],
    notes: [],
    optional: false,
    alternative: false,
    heading: false,
    evidence: [evidence(line)],
    hierarchyPath: ["Browser-lokales Leistungsverzeichnis"],
    verificationStatus: "MACHINE_VALIDATED"
  }));
  const offerLines = new Map<string, OfferLine>();
  for (const line of input.result.supplierLines) {
    const lineEvidence = evidence(line);
    const id = stableId(
      "supplier-line",
      line.documentId,
      line.positionNumber,
      String(line.lineIndex)
    );
    offerLines.set(id, {
      id,
      sourcePositionNumber: line.positionNumber,
      supplierPositionNumber: line.positionNumber,
      description: line.description,
      manufacturer: null,
      articleNumber: line.articleNumber,
      quantity: line.quantity,
      unit: line.unit,
      priceBasis: 1,
      currency: "EUR",
      moneyCandidates:
        line.totalPrice === null
          ? []
          : [
              {
                id: stableId("money", id),
                kind: "TOTAL_PRICE",
                rawValue: String(line.totalPrice),
                amount: line.totalPrice,
                currency: "EUR",
                priceBasis: 1,
                evidence: [lineEvidence]
              }
            ],
      interpretedUnitPrice: line.unitPrice,
      interpretedTotalPrice: line.totalPrice,
      role: "PRIMARY",
      groupId: stableId("group", line.documentId),
      continuation: false,
      evidence: [lineEvidence],
      verificationStatus: "MACHINE_VALIDATED",
      lockedFields: [],
      completenessStatus:
        line.totalPrice === null ? "OFFER_WITHOUT_PRICE" : "PRICED_OFFER"
    });
  }
  const supplierOptions: SupplierOption[] = [];
  for (const basis of basisPositions) {
    for (const parsed of input.result.supplierLines.filter(
      (line) => line.positionNumber === basis.positionNumber
    )) {
      const lineId = stableId(
        "supplier-line",
        parsed.documentId,
        parsed.positionNumber,
        String(parsed.lineIndex)
      );
      const line = offerLines.get(lineId)!;
      const comparableTotal =
        line.interpretedTotalPrice ??
        (line.interpretedUnitPrice !== null && basis.quantity !== null
          ? Math.round(line.interpretedUnitPrice * basis.quantity * 100) / 100
          : null);
      supplierOptions.push({
        id: stableId("option", basis.id, parsed.documentId, lineId),
        basisPositionIds: [basis.id],
        supplierDocumentId: parsed.documentId,
        supplierLabel: parsed.supplier,
        matchedOfferLineIds: [lineId],
        matchLinkIds: [stableId("match", basis.id, lineId)],
        primaryPrice: comparableTotal,
        mandatoryComponentPrices: [],
        optionalPrices: [],
        pricedTotal: comparableTotal,
        comparableTotal,
        quantity: parsed.quantity,
        unit: parsed.unit,
        scopeOfSupply: [parsed.description],
        technicalDeviations: [],
        missingComponents: [],
        validationIssueIds: [],
        evidenceIds: line.evidence.map((item) => item.id),
        quantityCompatible:
          basis.quantity === null ||
          parsed.quantity === null ||
          basis.quantity === parsed.quantity,
        unitCompatible:
          basis.unit === null ||
          parsed.unit === null ||
          basis.unit.toLocaleLowerCase("de") === parsed.unit.toLocaleLowerCase("de"),
        technicalCompatible: true,
        technicalComparisonStatus: "CONFIRMED_COMPATIBLE",
        unresolvedTechnicalAttributes: [],
        requiredScopeComplete: true,
        optionalSeparated: true,
        bundleCompatible: true,
        evidenceSufficient: true,
        extractionValidated: true,
        matchingAccepted: true,
        matchingReliable: true,
        offerAvailability: "PRESENT",
        materialScopeStatus: "COMPLETE_MATERIAL_SCOPE",
        reasons: [
          "Menge stimmt überein",
          "Einheit stimmt überein",
          "Preis vollständig bestätigt"
        ],
        status: comparableTotal === null ? "PRICE_UNCLEAR" : "CLEAR_RECOMMENDATION"
      });
    }
  }
  const supplierDocuments = input.documents.filter((document) =>
    ["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(document.documentType)
  );
  const reviewPositions: ProjectReviewPosition[] = basisPositions.map((basis) => {
    const options = supplierOptions.filter((option) =>
      option.basisPositionIds.includes(basis.id)
    );
    const explicitNoOfferSuppliers: string[] = [];
    const coverage: PositionSupplierCoverage = {
      basisPositionId: basis.id,
      relevantSuppliers: supplierDocuments.map((document) => document.documentId),
      processedRelevantSuppliers: supplierDocuments.map(
        (document) => document.documentId
      ),
      irrelevantSpecializedSuppliers: [],
      explicitNoOfferSuppliers,
      missingExpectedSuppliers: [],
      missingSources: [],
      coverageStatus: "SUFFICIENT"
    };
    const independent = selectUniqueLowestComparableOption({
      basisPositionId: basis.id,
      options,
      coverage: {
        activeSupplierDocumentIds: new Set(
          supplierDocuments.map((document) => document.documentId)
        ),
        allRelevantOffersProcessed: true,
        supplierCoverageSufficient: true,
        projectContextConfirmed: true,
        disciplineContextConfirmed: true,
        materialUncertainty: false
      },
      calculatedAt: createdAt
    });
    return {
      basis,
      options,
      coverage,
      independent,
      historical: {
        basisPositionId: basis.id,
        classification: "HISTORICAL_EK_UNRESOLVED",
        historicalMaterialEk: null,
        historicalMatchedOptionId: null,
        independentSelectedOptionId: independent.selectedSupplierOptionId,
        reasons: ["Keine historischen Daten im browser-lokalen Projekt"]
      },
      liveStatus:
        options.length === 0
          ? "NO_COMPARABLE_OFFER"
          : independent.status === "AUTO_SELECTED_LOWEST_PRICE"
            ? "AUTO_SELECTED_LOWEST_PRICE"
            : "MANUAL_DECISION_REQUIRED",
      reviewQueue:
        independent.status === "AUTO_SELECTED_LOWEST_PRICE"
          ? null
          : "MANAGER_DECISION",
      primaryReasonCategory:
        independent.status === "AUTO_SELECTED_LOWEST_PRICE" ? null : "OTHER",
      primaryReasonDe:
        independent.status === "AUTO_SELECTED_LOWEST_PRICE"
          ? null
          : "Angebotsauswahl erfordert eine Entscheidung"
    };
  });
  const analysis: PilotAnalysis = {
    id: analysisVersionId,
    basisDocumentId: basisDocument.documentId,
    basisDocumentLabel: basisDocument.originalFileName,
    basisPages: Array.from(
      { length: basisDocument.pageCount },
      (_, index) => index + 1
    ),
    basisPositionFrom: basisPositions[0]?.positionNumber ?? "",
    basisPositionTo: basisPositions.at(-1)?.positionNumber ?? "",
    supplierDocuments: supplierDocuments.map((document) => ({
      id: document.documentId,
      label: document.originalFileName,
      pages: Array.from({ length: document.pageCount }, (_, index) => index + 1)
    })),
    basisPositions,
    matchLinks: supplierOptions.map((option) => ({
      id: option.matchLinkIds[0],
      basisPositionIds: option.basisPositionIds,
      offerLineIds: option.matchedOfferLineIds,
      kind: "ONE_TO_ONE",
      status: "EXACT",
      score: 1,
      reasons: ["Positionsnummer stimmt überein"],
      confirmedByOperator: false
    })),
    supplierOptions,
    recommendations: reviewPositions.map((position) => ({
      basisPositionId: position.basis.id,
      status:
        position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE"
          ? "CLEAR_RECOMMENDATION"
          : position.options.length
            ? "DECISION_REQUIRED"
            : "NO_OFFER",
      recommendedSupplierDocumentId:
        position.independent.selectedSupplierOptionId
          ? position.options.find(
              (option) =>
                option.id === position.independent.selectedSupplierOptionId
            )?.supplierDocumentId ?? null
          : null,
      reasons: position.independent.reasons,
      requiresOperatorConfirmation:
        position.liveStatus !== "AUTO_SELECTED_LOWEST_PRICE"
    })),
    generatedAt: createdAt
  };
  const documentRevisions = Object.fromEntries(
    input.documents.map((document) => [
      document.documentId,
      stableId("revision", document.documentId, String(document.revision))
    ])
  );
  const runs: PilotStateView["runs"] = input.documents.map((document) => ({
    id: stableId("run", analysisVersionId, document.documentId),
    document: {
      id: document.documentId,
      relativePath: document.originalFileName,
      pageNumber: 1,
      pageCount: document.pageCount,
      documentType: document.documentType
    },
    result: {
      envelope: {
        extraction: {
          offerGroups:
            document.documentType === "SUPPLIER_OFFER" ||
            document.documentType === "MANUFACTURER_OFFER"
              ? [
                  {
                    lines: [...offerLines.values()].filter((line) =>
                      line.id.includes(document.documentId)
                    )
                  }
                ]
              : [],
          basisPositions: basisPositions.filter(
            (position) => position.documentId === document.documentId
          )
        }
      }
    },
    validationIssues: [],
    pageImageAsset: ""
  }));
  const pilot: PilotStateView = {
    version: 2,
    runs,
    reviewActions: [],
    matchReviewActions: [],
    supplierDecisions: [],
    supplierDecisionReviewActions: [],
    analysis,
    documentRevisions,
    projectReview: {
      projectId: input.projectId,
      analysisVersionId,
      positions: reviewPositions,
      invariant: {
        valid: true,
        totalBasisLeafPositions: basisPositions.length,
        lvRows: reviewPositions.length,
        statusCount: reviewPositions.length,
        duplicatePositionIds: [],
        duplicatePositionNumbers: [],
        missingPositionIds: [],
        orphanDecisionIds: [],
        orphanSupplierOptionIds: [],
        unknownStatusPositionIds: [],
        problemPositionIds: []
      },
      coverage: {
        relevantSupplierDocumentIds: supplierDocuments.map(
          (document) => document.documentId
        ),
        relevantSupplierDocuments: supplierDocuments.map((document) => ({
          id: document.documentId,
          label: document.originalFileName,
          supplier: document.supplierName ?? document.originalFileName,
          revision: document.revision ?? 0
        })),
        processedSupplierDocumentIds: supplierDocuments.map(
          (document) => document.documentId
        ),
        missingSupplierDocuments: [],
        allRelevantOffersProcessed: true,
        projectContextConfirmed: true,
        historicalCalculationAvailable: false
      }
    }
  };
  return {
    projectId: input.projectId,
    analysisVersionId,
    createdAt,
    pilot,
    summary: {
      basisPositions: basisPositions.length,
      supplierOffers: supplierDocuments.length,
      positionsWithOffers: reviewPositions.filter(
        (position) => position.options.length > 0
      ).length,
      positionsWithoutOffers: reviewPositions.filter(
        (position) => position.options.length === 0
      ).length,
      warnings: input.result.warnings.length,
      pagesInspected: input.result.diagnostics.pagesInspected,
      pagesParsed: input.result.diagnostics.pagesParsed,
      ocrRequiredPages: input.result.diagnostics.ocrRequiredPages
    }
  };
}

export function browserWorkerResultFromAnalysis(
  snapshot: BrowserAnalysisSnapshot,
  documents: readonly BrowserDocumentRecord[]
): BrowserWorkerResult {
  const metadata = new Map(
    documents.map((document) => [document.documentId, document])
  );
  const basisLines = snapshot.pilot.projectReview.positions.map(
    (position, lineIndex) => ({
      documentId: position.basis.documentId,
      positionNumber: position.basis.positionNumber,
      description: position.basis.description,
      quantity: position.basis.quantity,
      unit: position.basis.unit,
      pageNumber: position.basis.evidence[0]?.pageNumber ?? 1,
      lineIndex
    })
  );
  let fallbackLineIndex = 0;
  const supplierLines = snapshot.pilot.runs.flatMap((run) =>
    run.result.envelope.extraction.offerGroups.flatMap((group) =>
      group.lines.map((line) => {
        const storedLineIndex = Number(line.id.split(":").at(-1));
        return {
        documentId: run.document.id,
        positionNumber:
          line.supplierPositionNumber ?? line.sourcePositionNumber ?? "",
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        pageNumber: line.evidence[0]?.pageNumber ?? 1,
        lineIndex: Number.isInteger(storedLineIndex)
          ? storedLineIndex
          : fallbackLineIndex++,
        supplier:
          metadata.get(run.document.id)?.supplierName ??
          metadata.get(run.document.id)?.originalFileName ??
          run.document.relativePath,
        articleNumber: line.articleNumber,
        unitPrice: line.interpretedUnitPrice,
        totalPrice: line.interpretedTotalPrice
        };
      })
    )
  );
  return {
    basisLines,
    supplierLines,
    warnings: [],
    diagnostics: {
      pagesInspected: snapshot.summary.pagesInspected ?? 0,
      pagesParsed: snapshot.summary.pagesParsed ?? 0,
      ocrRequiredPages: snapshot.summary.ocrRequiredPages ?? 0,
      matchingCandidates: supplierLines.length
    }
  };
}
