import type {
  BasisPosition,
  EvidenceReference,
  OfferLine,
  PilotAnalysis,
  SupplierOption
} from "@/domain/contracts";
import { buildSupplierOptions, proposeMatches, type OfferLineContext } from "@/domain/matching";
import {
  selectUniqueLowestComparableOption,
  type PositionSupplierCoverage,
  type ProjectReviewPosition
} from "@/domain/project-review";
import type { PilotStateView } from "@/components/lv/types";
import { applyFullRunDocumentClassification } from "@/browser-projects/document-classification";
import type {
  BrowserLineReviewReason,
  BrowserWorkerResult
} from "@/browser-projects/processing-protocol";
import type {
  BrowserAnalysisSnapshot,
  BrowserDocumentRecord,
  BrowserMatchReviewRecord
} from "@/browser-projects/types";

function stableId(...parts: string[]): string {
  return parts.join(":").replace(/[^\p{L}\p{N}:._-]/gu, "-");
}

function explicitManufacturer(description: string): string | null {
  const value = description.match(/\b(?:Fabrikat|Hersteller)\s*:\s*([^\n]+?)(?=\s+(?:Typ|Art\.?\s*-?\s*Nr\.?|Komplett|Menge|Einheit)\s*:?|\n|$)/iu)?.[1]?.trim();
  return value && value.length <= 80 && !/gleichwertig|nach\s+wahl/i.test(value) ? value : null;
}

function supplierRole(description: string): OfferLine["role"] {
  const text = description.replace(/\s+/g, " ").trim();
  if (/\b(?:nicht\s+(?:im\s+Lieferprogramm|angeboten|lieferbar)|kein\s+Angebot)\b/i.test(text)) return "NOT_OFFERED";
  if (/^(?:bauseits|durch\s+andere)\b/i.test(text)) return "PROVIDED_BY_OTHERS";
  if (/^(?:wahlweise|alternativ(?:e|es|er)?)\b/i.test(text)) return "ALTERNATIVE";
  if (/^(?:optional(?:e|es|er)?|auf\s+Wunsch)\b/i.test(text)) return "OPTIONAL";
  if (/\b(?:Preis\s+auf\s+Anfrage|auf\s+Anfrage\s+lieferbar)\b/i.test(text)) return "PRICE_ON_REQUEST";
  return "PRIMARY";
}

function basisTechnicalAttributes(description: string): BasisPosition["technicalAttributes"] {
  const diameters = [...new Set([...description.matchAll(/\bDN\s*(\d{1,3})\b/gi)].map(match => match[1]))];
  // More than one DN can describe different connections; do not invent one requirement.
  return diameters.length === 1 ? [{ name: "Nennweite", value: `DN ${diameters[0]}` }] : [];
}

function fullyReadDocumentIds(documents: readonly BrowserDocumentRecord[], result: BrowserWorkerResult): Set<string> {
  return new Set(documents.filter(document => {
    if (["UNKNOWN", "SCAN_OCR_REQUIRED"].includes(document.documentType)) return false;
    const diagnostic = result.diagnostics.documents.find(item => item.documentId === document.documentId);
    return diagnostic && diagnostic.pagesInspected >= document.pageCount &&
      diagnostic.ocrFailedPages === 0 && diagnostic.ocrRequiredPages === 0 &&
      diagnostic.extractedPositions >= diagnostic.candidatePositions &&
      !result.processingIssues?.some(issue => issue.documentId === document.documentId);
  }).map(document => document.documentId));
}

function evidence(input: {
  documentId: string;
  positionNumber: string;
  description: string;
  lineIndex: number;
  pageNumber?: number;
  region?: { x: number; y: number; width: number; height: number };
  reviewReasons?: BrowserLineReviewReason[];
}): EvidenceReference {
  const hasMeasuredRegion = Boolean(
    input.region && input.region.width > 0 && input.region.height > 0
  );
  const requiresStructuralReview = (input.reviewReasons?.length ?? 0) > 0;
  const geometrySource = !hasMeasuredRegion
    ? "line"
    : input.reviewReasons?.includes("OCR_SOURCE")
      ? "ocr-word"
      : "pdf-text";
  return {
    id: stableId("evidence", input.documentId, input.positionNumber, String(input.lineIndex)),
    documentId: input.documentId,
    pageNumber: input.pageNumber ?? 1,
    // Legacy `line:<n>` IDs denoted placeholder geometry and are deliberately
    // ignored by the viewer. Measured PDF/OCR boxes use explicit provenance so
    // an image-only PDF can safely reuse its stored OCR frame when the original
    // document has no native text layer.
    textItemIds: [stableId(geometrySource, String(input.lineIndex)), ...(input.reviewReasons ?? []).map(reason => `review:${reason}`)],
    sourceText: input.description,
    region: hasMeasuredRegion ? input.region! : { x: 0, y: 0, width: 0, height: 0 },
    cropPath: null,
    status: !hasMeasuredRegion
      ? "MISSING"
      : requiresStructuralReview
        ? "VISUAL_ONLY_UNCONFIRMED"
        : "VERIFIED_NATIVE"
  };
}

function continuationEvidence(input: {
  documentId: string;
  positionNumber: string;
  lineIndex: number;
  reviewReasons?: BrowserLineReviewReason[];
  continuationEvidence?: Array<{
    pageNumber: number;
    sourceText: string;
    region?: { x: number; y: number; width: number; height: number };
  }>;
}): EvidenceReference[] {
  return (input.continuationEvidence ?? []).map((continuation, index) =>
    evidence({
      documentId: input.documentId,
      positionNumber: input.positionNumber,
      description: continuation.sourceText,
      lineIndex: input.lineIndex * 1_000 + index + 1,
      pageNumber: continuation.pageNumber,
      region: continuation.region,
      reviewReasons: input.reviewReasons
    })
  );
}

function buildReviewPositions(input: {
  projectId: string;
  analysisVersionId: string;
  basisPositions: BasisPosition[];
  supplierOptions: SupplierOption[];
  supplierDocuments: Array<Pick<BrowserDocumentRecord, "documentId">>;
  fullyProcessedDocumentIds: ReadonlySet<string>;
  calculatedAt: string;
}): ProjectReviewPosition[] {
  return input.basisPositions.map((basis) => {
    const options = input.supplierOptions.filter((option) =>
      option.basisPositionIds.includes(basis.id)
    );
    const explicitNoOfferSuppliers = options.filter(option => option.offerAvailability === "EXPLICIT_NO_OFFER").map(option => option.supplierDocumentId);
    const missingSuppliers = input.supplierDocuments.filter(document => !input.fullyProcessedDocumentIds.has(document.documentId));
    const allRelevantOffersProcessed = missingSuppliers.length === 0;
    const coverage: PositionSupplierCoverage = {
      basisPositionId: basis.id,
      relevantSuppliers: input.supplierDocuments.map((document) => document.documentId),
      processedRelevantSuppliers: input.supplierDocuments.filter(document => input.fullyProcessedDocumentIds.has(document.documentId)).map((document) => document.documentId),
      irrelevantSpecializedSuppliers: [],
      explicitNoOfferSuppliers,
      missingExpectedSuppliers: missingSuppliers.map(document => document.documentId),
      missingSources: missingSuppliers.map(document => ({ supplierDocumentId: document.documentId, pages: [] })),
      coverageStatus: allRelevantOffersProcessed ? "SUFFICIENT" : "PARTIAL"
    };
    const independent = selectUniqueLowestComparableOption({
      basisPositionId: basis.id,
      options,
      coverage: {
        activeSupplierDocumentIds: new Set(
          input.supplierDocuments.map((document) => document.documentId)
        ),
        allRelevantOffersProcessed,
        supplierCoverageSufficient: allRelevantOffersProcessed,
        projectContextConfirmed: true,
        disciplineContextConfirmed: true,
        materialUncertainty: false
      },
      calculatedAt: input.calculatedAt
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
      reviewQueue: independent.status === "AUTO_SELECTED_LOWEST_PRICE" ? null : "MANAGER_DECISION",
      primaryReasonCategory: independent.status === "AUTO_SELECTED_LOWEST_PRICE" ? null : "OTHER",
      primaryReasonDe:
        independent.status === "AUTO_SELECTED_LOWEST_PRICE"
          ? null
          : "Angebotsauswahl erfordert eine Entscheidung"
    };
  });
}

function recommendationsFor(positions: ProjectReviewPosition[]): PilotAnalysis["recommendations"] {
  return positions.map((position) => ({
    basisPositionId: position.basis.id,
    status:
      position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE"
        ? "CLEAR_RECOMMENDATION"
        : position.options.some((option) => option.offerAvailability === "PRESENT")
          ? "DECISION_REQUIRED"
          : "NO_OFFER",
    recommendedSupplierDocumentId: position.independent.selectedSupplierOptionId
      ? (position.options.find(
          (option) => option.id === position.independent.selectedSupplierOptionId
        )?.supplierDocumentId ?? null)
      : null,
    reasons: position.independent.reasons,
    requiresOperatorConfirmation: position.liveStatus !== "AUTO_SELECTED_LOWEST_PRICE"
  }));
}

export function buildBrowserAnalysis(input: {
  projectId: string;
  documents: BrowserDocumentRecord[];
  result: BrowserWorkerResult;
}): BrowserAnalysisSnapshot {
  const classifications = new Map(input.result.documentClassifications?.map(item => [item.documentId, item.classification]) ?? []);
  input = { ...input, documents: input.documents.map(document => {
    const classification = classifications.get(document.documentId);
    return classification ? applyFullRunDocumentClassification(document, classification) : document;
  }) };
  const createdAt = new Date().toISOString();
  const analysisVersionId = crypto.randomUUID();
  const basisDocument = input.documents.find(
    (document) => document.documentType === "BASIS_LV" && document.activeBasis
  );
  if (!basisDocument) throw new Error("BASIS_DOCUMENT_REQUIRED");
  if (input.result.basisLines.length === 0) {
    throw new Error("FAILED_NO_BASIS_POSITIONS");
  }
  const allSupplierDocuments = input.documents.filter(document =>
    !document.excludedFromProcessing && ["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(document.documentType));
  const supplierIds = new Set(allSupplierDocuments.map(document => document.documentId));
  if (input.documents.some(document => document.projectId !== input.projectId) ||
    input.result.basisLines.some(line => line.documentId !== basisDocument.documentId) ||
    input.result.supplierLines.some(line => !supplierIds.has(line.documentId))) {
    throw new Error("EXTRACTION_DOCUMENT_MISMATCH");
  }
  const inDiscipline = (document: BrowserDocumentRecord) => document.discipline === "UNKNOWN" ||
    basisDocument.discipline === "UNKNOWN" || document.discipline === basisDocument.discipline ||
    (basisDocument.discipline === "SANITAER" && document.discipline === "INSTALLATIONSSYSTEME");
  const supplierDocuments = allSupplierDocuments.filter(inDiscipline);
  const relevantIds = new Set(supplierDocuments.map(document => document.documentId));
  const fullyProcessedDocumentIds = fullyReadDocumentIds(input.documents, input.result);
  const relevantSupplierDocuments = input.documents.filter(document => !document.excludedFromProcessing && inDiscipline(document) &&
    ["SUPPLIER_OFFER", "MANUFACTURER_OFFER", "UNKNOWN", "SCAN_OCR_REQUIRED"].includes(document.documentType));
  const basisPositions: BasisPosition[] = input.result.basisLines.map((line) => {
    const lineEvidence = evidence(line);
    const continuation = continuationEvidence(line);
    return {
      id: stableId("basis", line.documentId, line.positionNumber),
      documentId: line.documentId,
      parentId: null,
      positionNumber: line.positionNumber,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      technicalAttributes: basisTechnicalAttributes(line.description),
      manufacturerRequirements: explicitManufacturer(line.description) ? [explicitManufacturer(line.description)!] : [],
      requiredScope: [],
      notes: [],
      optional: false,
      alternative: false,
      heading: false,
      evidence: [lineEvidence],
      continuationEvidence: continuation,
      hierarchyPath: ["Browser-lokales Leistungsverzeichnis"],
      verificationStatus:
        lineEvidence.status === "VERIFIED_NATIVE" ? "MACHINE_VALIDATED" : "NEEDS_REVIEW"
    };
  });
  const offerLines = new Map<string, OfferLine>();
  for (const line of input.result.supplierLines) {
    if (!relevantIds.has(line.documentId)) continue;
    const lineEvidence = evidence(line);
    const lineContinuationEvidence = continuationEvidence(line);
    const allLineEvidence = [lineEvidence, ...lineContinuationEvidence];
    const role = supplierRole(line.description);
    const id = stableId(
      "supplier-line",
      line.documentId,
      line.positionNumber,
      String(line.lineIndex)
    );
    offerLines.set(id, {
      id,
      sourcePositionNumber: line.positionNumber,
      supplierPositionNumber: line.supplierPositionNumber ?? line.positionNumber,
      description: line.description,
      manufacturer: explicitManufacturer(line.description),
      articleNumber: line.articleNumber,
      quantity: line.quantity,
      unit: line.unit,
      priceBasis: line.priceBasis === undefined ? 1 : line.priceBasis === 1 || line.priceBasis === 10 || line.priceBasis === 100 || line.priceBasis === 1000 ? line.priceBasis : null,
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
                evidence: allLineEvidence
              }
            ],
      interpretedUnitPrice: line.unitPrice,
      interpretedTotalPrice: line.totalPrice,
      role,
      groupId: stableId("group", line.documentId),
      continuation: false,
      evidence: allLineEvidence,
      verificationStatus:
        lineEvidence.status === "VERIFIED_NATIVE" ? "MACHINE_VALIDATED" : "NEEDS_REVIEW",
      lockedFields: [],
      completenessStatus: ["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(role) ? "NOT_OFFERED" : role === "PRICE_ON_REQUEST" ? "PRICE_ON_REQUEST" : line.totalPrice === null ? "OFFER_WITHOUT_PRICE" : "PRICED_OFFER"
    });
  }
  const supplierLabels = new Map(
    input.result.supplierLines.map((line) => [line.documentId, line.supplier])
  );
  const supplierDocumentLabels = new Map(
    supplierDocuments.map((document) => [
      document.documentId,
      document.supplierName ?? document.originalFileName
    ])
  );
  const offerContexts: OfferLineContext[] = [...offerLines.values()].map((line) => {
    const documentId = line.evidence[0]?.documentId ?? "";
    return {
      documentId,
      documentLabel:
        supplierLabels.get(documentId) ?? supplierDocumentLabels.get(documentId) ?? documentId,
      line
    };
  });
  const matchLinks = proposeMatches(basisPositions, offerContexts);
  const supplierOptions = buildSupplierOptions({
    basisPositions,
    offers: offerContexts,
    links: matchLinks,
    fullyProcessedSupplierDocumentIds: fullyProcessedDocumentIds
  });
  const reviewPositions = buildReviewPositions({
    projectId: input.projectId,
    analysisVersionId,
    basisPositions,
    supplierOptions,
    supplierDocuments: relevantSupplierDocuments,
    fullyProcessedDocumentIds,
    calculatedAt: createdAt
  });
  const analysis: PilotAnalysis = {
    id: analysisVersionId,
    basisDocumentId: basisDocument.documentId,
    basisDocumentLabel: basisDocument.originalFileName,
    basisPages: Array.from({ length: basisDocument.pageCount }, (_, index) => index + 1),
    basisPositionFrom: basisPositions[0]?.positionNumber ?? "",
    basisPositionTo: basisPositions.at(-1)?.positionNumber ?? "",
    supplierDocuments: supplierDocuments.map((document) => ({
      id: document.documentId,
      label: document.originalFileName,
      pages: Array.from({ length: document.pageCount }, (_, index) => index + 1)
    })),
    basisPositions,
    matchLinks,
    supplierOptions,
    recommendations: recommendationsFor(reviewPositions),
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
                      line.evidence[0]?.documentId === document.documentId
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
        relevantSupplierDocumentIds: relevantSupplierDocuments.map((document) => document.documentId),
        relevantSupplierDocuments: relevantSupplierDocuments.map((document) => ({
          id: document.documentId,
          label: document.originalFileName,
          supplier: document.supplierName ?? document.originalFileName,
          revision: document.revision ?? 0
        })),
        processedSupplierDocumentIds: supplierDocuments.filter(document => fullyProcessedDocumentIds.has(document.documentId)).map((document) => document.documentId),
        missingSupplierDocuments: relevantSupplierDocuments.filter(document => !fullyProcessedDocumentIds.has(document.documentId)).map(document => ({ id: document.documentId, label: document.originalFileName })),
        allRelevantOffersProcessed: relevantSupplierDocuments.every(document => fullyProcessedDocumentIds.has(document.documentId)),
        projectContextConfirmed: true,
        historicalCalculationAvailable: false
      }
    }
  };
  return {
    projectId: input.projectId,
    analysisVersionId,
    createdAt,
    matchReviews: [],
    pilot,
    summary: {
      basisPositions: basisPositions.length,
      supplierOffers: supplierDocuments.length,
      positionsWithOffers: reviewPositions.filter((position) => position.options.length > 0).length,
      positionsWithoutOffers: reviewPositions.filter((position) => position.options.length === 0)
        .length,
      warnings: input.result.warnings.length,
      pagesInspected: input.result.diagnostics.pagesInspected,
      pagesParsed: input.result.diagnostics.pagesParsed,
      ocrRequiredPages: input.result.diagnostics.ocrRequiredPages,
      ocrProcessedPages: input.result.diagnostics.ocrProcessedPages ?? 0,
      ocrFailedPages: input.result.diagnostics.ocrFailedPages ?? 0,
      documentDiagnostics: structuredClone(input.result.diagnostics.documents)
    }
  };
}

export function applyBrowserMatchReview(
  snapshot: BrowserAnalysisSnapshot,
  review: BrowserMatchReviewRecord
): BrowserAnalysisSnapshot {
  if (
    review.projectId !== snapshot.projectId ||
    review.analysisVersionId !== snapshot.analysisVersionId
  ) {
    throw new Error("MATCH_REVIEW_ANALYSIS_MISMATCH");
  }
  const analysis = snapshot.pilot.analysis;
  if (!analysis) throw new Error("MATCH_REVIEW_ANALYSIS_REQUIRED");
  const target = analysis.matchLinks.find(
    (link) => link.id === review.matchLinkId && link.basisPositionIds.includes(review.positionId)
  );
  if (!target) throw new Error("MATCH_LINK_NOT_FOUND");

  const manualReasons = new Set(["Zuordnung manuell bestätigt", "Zuordnung manuell abgelehnt"]);
  const matchLinks = analysis.matchLinks.map((link) => {
    if (link.id !== target.id) return link;
    const reasons = link.reasons.filter((reason) => !manualReasons.has(reason));
    const direct = reasons.includes("Direkter LV-Positionsbezug");
    return {
      ...link,
      status:
        review.decision === "REJECTED"
          ? ("UNMATCHED" as const)
          : link.status === "UNMATCHED"
            ? direct
              ? ("EXACT" as const)
              : ("PROBABLE" as const)
            : link.status,
      reasons: [
        ...reasons,
        review.decision === "CONFIRMED"
          ? "Zuordnung manuell bestätigt"
          : "Zuordnung manuell abgelehnt"
      ],
      confirmedByOperator: review.decision === "CONFIRMED"
    };
  });
  const supplierLabels = new Map(
    snapshot.pilot.projectReview.coverage.relevantSupplierDocuments.map((document) => [
      document.id,
      document.supplier
    ])
  );
  const offerContexts: OfferLineContext[] = snapshot.pilot.runs.flatMap((run) =>
    run.result.envelope.extraction.offerGroups.flatMap((group) =>
      group.lines.map((line) => ({
        documentId: run.document.id,
        documentLabel: supplierLabels.get(run.document.id) ?? run.document.relativePath,
        line
      }))
    )
  );
  const supplierOptions = buildSupplierOptions({
    basisPositions: analysis.basisPositions,
    offers: offerContexts,
    links: matchLinks,
    fullyProcessedSupplierDocumentIds: new Set(snapshot.pilot.projectReview.coverage.processedSupplierDocumentIds)
  });
  const positions = buildReviewPositions({
    projectId: snapshot.projectId,
    analysisVersionId: snapshot.analysisVersionId,
    basisPositions: analysis.basisPositions,
    supplierOptions,
    supplierDocuments: snapshot.pilot.projectReview.coverage.relevantSupplierDocumentIds.map(documentId => ({ documentId })),
    fullyProcessedDocumentIds: new Set(snapshot.pilot.projectReview.coverage.processedSupplierDocumentIds),
    calculatedAt: review.updatedAt
  });
  const nextAnalysis: PilotAnalysis = {
    ...analysis,
    matchLinks,
    supplierOptions,
    recommendations: recommendationsFor(positions),
    generatedAt: review.updatedAt
  };
  return {
    ...snapshot,
    matchReviews: [
      ...(snapshot.matchReviews ?? []).filter(
        (candidate) => candidate.matchLinkId !== review.matchLinkId
      ),
      review
    ],
    pilot: {
      ...snapshot.pilot,
      analysis: nextAnalysis,
      projectReview: {
        ...snapshot.pilot.projectReview,
        positions
      }
    },
    summary: {
      ...snapshot.summary,
      positionsWithOffers: positions.filter((position) =>
        position.options.some((option) => option.offerAvailability === "PRESENT")
      ).length,
      positionsWithoutOffers: positions.filter(
        (position) => !position.options.some((option) => option.offerAvailability === "PRESENT")
      ).length
    }
  };
}

export function browserWorkerResultFromAnalysis(
  snapshot: BrowserAnalysisSnapshot,
  documents: readonly BrowserDocumentRecord[]
): BrowserWorkerResult {
  const metadata = new Map(documents.map((document) => [document.documentId, document]));
  const sourceFields = (sources: EvidenceReference[], quantity: number | null, unit: string | null) => {
    const knownReasons = new Set<string>(["PRIOR_REVIEW_REQUIRED", "BARE_POSITION_SINGLETON", "UNKNOWN_UNIT", "QUANTITY_MISSING", "QUANTITY_AMBIGUOUS", "PRICE_BASIS_UNCLEAR", "MULTI_PAGE_POSITION", "DESCRIPTION_LIMIT_REACHED", "OCR_SOURCE", "SOURCE_REGION_MISSING"]);
    const reviewReasons: BrowserLineReviewReason[] = sources.flatMap(source => source.textItemIds.filter(id => id.startsWith("review:")).map(id => id.slice(7))).filter((reason): reason is BrowserLineReviewReason => knownReasons.has(reason));
    if (sources.some(source => ["VISUAL_ONLY_UNCONFIRMED", "CONFLICTING"].includes(source.status)) && reviewReasons.length === 0) reviewReasons.push("PRIOR_REVIEW_REQUIRED");
    if (sources.some(source => source.textItemIds.some(id => id.startsWith("ocr-word:")))) reviewReasons.push("OCR_SOURCE");
    if (quantity === null) reviewReasons.push("QUANTITY_MISSING");
    if (unit === null) reviewReasons.push("UNKNOWN_UNIT");
    if (sources.length > 1) reviewReasons.push("MULTI_PAGE_POSITION");
    if (!sources[0]?.region.width || !sources[0]?.region.height) reviewReasons.push("SOURCE_REGION_MISSING");
    return {
      region: sources[0]?.region,
      reviewReasons,
      continuationEvidence: sources.slice(1).map(source => ({ pageNumber: source.pageNumber, sourceText: source.sourceText, region: source.region }))
    };
  };
  const basisLines = snapshot.pilot.projectReview.positions.map((position, lineIndex) => ({
    documentId: position.basis.documentId,
    positionNumber: position.basis.positionNumber,
    description: position.basis.description,
    quantity: position.basis.quantity,
    unit: position.basis.unit,
    pageNumber: position.basis.evidence[0]?.pageNumber ?? 1,
    lineIndex,
    ...sourceFields([...position.basis.evidence, ...(position.basis.continuationEvidence ?? [])], position.basis.quantity, position.basis.unit)
  }));
  let fallbackLineIndex = 0;
  const supplierLines = snapshot.pilot.runs.flatMap((run) =>
    run.result.envelope.extraction.offerGroups.flatMap((group) =>
      group.lines.map((line) => {
        const storedLineIndex = Number(line.id.split(":").at(-1));
        return {
          documentId: run.document.id,
          positionNumber: line.sourcePositionNumber ?? line.supplierPositionNumber ?? "",
          supplierPositionNumber: line.supplierPositionNumber,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          priceBasis: line.priceBasis,
          ...sourceFields(line.evidence, line.quantity, line.unit),
          pageNumber: line.evidence[0]?.pageNumber ?? 1,
          lineIndex: Number.isInteger(storedLineIndex) ? storedLineIndex : fallbackLineIndex++,
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
      ocrProcessedPages: snapshot.summary.ocrProcessedPages ?? 0,
      ocrFailedPages: snapshot.summary.ocrFailedPages ?? 0,
      matchingCandidates: supplierLines.length,
      documents: structuredClone(snapshot.summary.documentDiagnostics ?? [])
    }
  };
}
