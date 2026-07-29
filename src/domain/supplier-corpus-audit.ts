import type {
  OfferLine,
  SupplierDecisionV2,
  SupplierOption
} from "@/domain/contracts";
import type { PilotState } from "@/storage/document-storage";
import {
  classifySupplierOption,
  isSelectableSupplierOption,
  primarySupplierLine,
  supplierDisplayRole,
  supplierOptionLines,
  supplierPriceDisplay,
  validateSupplierSourceTarget,
  type SupplierOptionValidity,
  type SupplierPriceState
} from "@/domain/supplier-option-read-model";
import {
  BASIS_STRUCTURE_INTERPRETATION_VERSION,
  OPERATOR_SUPPLIER_OPTION_READ_MODEL_VERSION,
  buildBasisStructureInterpretation,
  buildOperatorSupplierOptionReadModel,
  buildPositionSelectionMode,
  type BasisStructureType,
  type PackageCompleteness,
  type PriceProvenance,
  type SelectionMode
} from "@/domain/operator-supplier-option-read-model";

export type PriceDiscrepancyCode =
  | "SOURCE_GP_PRESENT_UI_MISSING"
  | "SOURCE_EP_PRESENT_UI_MISSING"
  | "GP_PRESENT_MARKED_NO_PRICE"
  | "PRICE_WITHOUT_SOURCE"
  | "WRONG_TOTAL_AGGREGATION"
  | "DUPLICATED_COMPONENT_PRICE"
  | "OPTIONAL_INCLUDED_IN_TOTAL"
  | "REQUIRED_COMPONENT_EXCLUDED"
  | "QUANTITY_MULTIPLIED_TWICE"
  | "CURRENCY_UNKNOWN"
  | "SOURCE_LINE_NOT_LINKED"
  | "OPTION_WITHOUT_REAL_LINE";

export type SupplierPriceAuditRow = {
  basisPosition: string;
  basisPositionId: string;
  supplier: string;
  supplierOptionId: string;
  supplierLineId: string | null;
  sourceDocument: string;
  sourcePage: number | null;
  sourceEp: number | null;
  sourceGp: number | null;
  extractedEp: number | null;
  extractedGp: number | null;
  optionPricedTotal: number | null;
  optionComparableTotal: number | null;
  displayedPrimaryPrice: number | null;
  displayedSecondaryPrice: number | null;
  displayedPriceStatus: string;
  displayedPriceScope: string;
  sourceAvailability: string;
  optionValidity: SupplierOptionValidity;
  selectable: boolean;
  rawRole: string | null;
  correctedRole: string | null;
  discrepancyCodes: PriceDiscrepancyCode[];
};

export type SupplierCorpusAuditMetrics = {
  basisPositions: number;
  supplierLines: number;
  supplierOptions: number;
  bundles: number;
  supplierDocuments: number;
  activeRevisions: number;
  positionsWithRealOffer: number;
  positionsWithoutRealOffer: number;
  optionsWithConfirmedGp: number;
  optionsWithOnlyEp: number;
  optionsWithCalculatedGp: number;
  optionsWithNoPrice: number;
  selectableRealOptions: number;
  invalidPlaceholderOptions: number;
  explicitNoOfferOptions: number;
  sourceLinksValid: number;
  sourceLinksPageContext: number;
  sourceLinksMissing: number;
  sourceLinksWrongPage: number;
  duplicateSupplierLines: number;
  duplicateSidebarItems: number;
  roleClassificationAnomalies: number;
  orphanSupplierOptionLines: number;
  orphanEvidenceReferences: number;
  gpPresentButUiNoPrice: number;
  criticalInconsistencies: number;
};

export type SupplierCorpusAudit = {
  generatedAt: string;
  rows: SupplierPriceAuditRow[];
  before: SupplierCorpusAuditMetrics;
  after: SupplierCorpusAuditMetrics;
  operatorWorkspace: OperatorWorkspaceAuditMetrics;
};

export type OperatorWorkspaceAuditMetrics = {
  basisStructureVersion: string;
  optionReadModelVersion: string;
  basisStructureCounts: Record<BasisStructureType, number>;
  packageCompletenessCounts: Record<PackageCompleteness, number>;
  priceProvenanceCounts: Record<PriceProvenance, number>;
  selectionModeCounts: Record<SelectionMode, number>;
  multiComponentPositions: number;
  positionsRequiringComponentSelection: number;
  legacySelectedDecisionsAudited: number;
  potentialFalseSingleLineSelections: number;
  existingPartialSelections: number;
  continuationPagePositions: number;
  unclearStructurePositions: number;
};

function countRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function uniqueOfferLines(
  state: PilotState,
  supplierDocumentIds: ReadonlySet<string>
): {
  lines: Map<string, OfferLine>;
  occurrences: Map<string, number>;
} {
  const lines = new Map<string, OfferLine>();
  const occurrences = new Map<string, number>();
  for (const run of state.runs) {
    if (!supplierDocumentIds.has(run.document.id)) continue;
    for (const group of run.result.envelope.extraction.offerGroups) {
      for (const line of group.lines) {
        occurrences.set(line.id, (occurrences.get(line.id) ?? 0) + 1);
        const current = lines.get(line.id);
        if (!current || current.evidence.length < line.evidence.length) {
          lines.set(line.id, line);
        }
      }
    }
  }
  return { lines, occurrences };
}

function emptyMetrics(input: {
  state: PilotState;
  lineCount: number;
  optionCount: number;
  bundleCount: number;
  supplierDocumentCount: number;
  activeRevisionCount: number;
}): SupplierCorpusAuditMetrics {
  return {
    basisPositions: input.state.analysis?.basisPositions.length ?? 0,
    supplierLines: input.lineCount,
    supplierOptions: input.optionCount,
    bundles: input.bundleCount,
    supplierDocuments: input.supplierDocumentCount,
    activeRevisions: input.activeRevisionCount,
    positionsWithRealOffer: 0,
    positionsWithoutRealOffer: 0,
    optionsWithConfirmedGp: 0,
    optionsWithOnlyEp: 0,
    optionsWithCalculatedGp: 0,
    optionsWithNoPrice: 0,
    selectableRealOptions: 0,
    invalidPlaceholderOptions: 0,
    explicitNoOfferOptions: 0,
    sourceLinksValid: 0,
    sourceLinksPageContext: 0,
    sourceLinksMissing: 0,
    sourceLinksWrongPage: 0,
    duplicateSupplierLines: 0,
    duplicateSidebarItems: 0,
    roleClassificationAnomalies: 0,
    orphanSupplierOptionLines: 0,
    orphanEvidenceReferences: 0,
    gpPresentButUiNoPrice: 0,
    criticalInconsistencies: 0
  };
}

function incrementPriceState(
  metrics: SupplierCorpusAuditMetrics,
  state: SupplierPriceState
) {
  if (state === "SOURCE_CONFIRMED_TOTAL") metrics.optionsWithConfirmedGp += 1;
  else if (state === "SYSTEM_CALCULATED_TOTAL") {
    metrics.optionsWithCalculatedGp += 1;
  } else if (state === "UNIT_PRICE_ONLY") metrics.optionsWithOnlyEp += 1;
  else metrics.optionsWithNoPrice += 1;
}

function requiredSourceTotal(lines: readonly OfferLine[]): number | null {
  const required = lines.filter((line) =>
    [
      "PRIMARY",
      "REQUIRED_COMPONENT",
      "MANDATORY_COMPONENT",
      "INCLUDED_ACCESSORY"
    ].includes(line.role)
  );
  if (
    !required.length ||
    required.some((line) => line.interpretedTotalPrice === null)
  ) {
    return null;
  }
  return (
    Math.round(
      required.reduce(
        (sum, line) => sum + (line.interpretedTotalPrice ?? 0),
        0
      ) * 100
    ) / 100
  );
}

function optionDiscrepancies(input: {
  option: SupplierOption;
  lines: readonly OfferLine[];
  sourceValid: boolean;
  displayedTotal: number | null;
  displayedUnitPrice: number | null;
  displayedState: SupplierPriceState;
}): PriceDiscrepancyCode[] {
  const codes = new Set<PriceDiscrepancyCode>();
  const primary = primarySupplierLine(input.lines);
  if (
    primary &&
    primary.interpretedTotalPrice !== null &&
    input.displayedTotal === null
  ) {
    codes.add("SOURCE_GP_PRESENT_UI_MISSING");
  }
  if (
    primary &&
    primary.interpretedUnitPrice !== null &&
    input.displayedUnitPrice === null
  ) {
    codes.add("SOURCE_EP_PRESENT_UI_MISSING");
  }
  if (
    primary &&
    primary.interpretedTotalPrice !== null &&
    input.displayedState === "MISSING"
  ) {
    codes.add("GP_PRESENT_MARKED_NO_PRICE");
  }
  if (input.displayedTotal !== null && !input.sourceValid) {
    codes.add("PRICE_WITHOUT_SOURCE");
  }
  if (!input.lines.length) codes.add("OPTION_WITHOUT_REAL_LINE");
  if (
    input.lines.some(
      (line, index) =>
        input.lines.findIndex((candidate) => candidate.id === line.id) !== index
    )
  ) {
    codes.add("DUPLICATED_COMPONENT_PRICE");
  }
  const requiredTotal = requiredSourceTotal(input.lines);
  const optionTotal = input.option.comparableTotal ?? input.option.pricedTotal;
  if (
    requiredTotal !== null &&
    optionTotal !== null &&
    Math.abs(requiredTotal - optionTotal) > 0.02
  ) {
    codes.add("WRONG_TOTAL_AGGREGATION");
    if (
      input.lines.some(
        (line) => line.role === "OPTIONAL" || line.role === "ALTERNATIVE"
      )
    ) {
      codes.add("OPTIONAL_INCLUDED_IN_TOTAL");
    }
    if (
      input.lines.some(
        (line) =>
          line.role === "REQUIRED_COMPONENT" ||
          line.role === "MANDATORY_COMPONENT"
      )
    ) {
      codes.add("REQUIRED_COMPONENT_EXCLUDED");
    }
  }
  if (
    primary &&
    primary.interpretedTotalPrice !== null &&
    primary.interpretedUnitPrice !== null &&
    primary.quantity !== null &&
    Math.abs(primary.quantity) > 1.001 &&
    Math.abs(
      primary.interpretedTotalPrice -
        primary.interpretedUnitPrice * primary.quantity * primary.quantity
    ) <= 0.02
  ) {
    codes.add("QUANTITY_MULTIPLIED_TWICE");
  }
  if (
    input.lines.some(
      (line) =>
        (line.interpretedUnitPrice !== null ||
          line.interpretedTotalPrice !== null) &&
        !line.currency
    )
  ) {
    codes.add("CURRENCY_UNKNOWN");
  }
  return [...codes];
}

export function buildSupplierCorpusAudit(input: {
  state: PilotState;
  documentRevisions: Readonly<Record<string, string>>;
}): SupplierCorpusAudit {
  if (!input.state.analysis) {
    throw new Error("Supplier corpus audit requires a persisted analysis.");
  }
  const analysis = input.state.analysis;
  const supplierDocumentIds = new Set(
    analysis.supplierOptions.map((option) => option.supplierDocumentId)
  );
  const { lines: offerLines, occurrences } = uniqueOfferLines(
    input.state,
    supplierDocumentIds
  );
  const basis = new Map(
    analysis.basisPositions.map((position) => [position.id, position] as const)
  );
  const pageCounts = new Map<string, number>();
  const documentLabels = new Map<string, string>();
  for (const run of input.state.runs) {
    pageCounts.set(run.document.id, run.document.pageCount);
    documentLabels.set(run.document.id, run.document.relativePath);
  }
  const bundleIds = new Set(
    [...offerLines.values()].map((line) => line.groupId).filter(Boolean)
  );
  const base = {
    state: input.state,
    lineCount: offerLines.size,
    optionCount: analysis.supplierOptions.length,
    bundleCount: bundleIds.size,
    supplierDocumentCount: supplierDocumentIds.size,
    activeRevisionCount: Object.keys(input.documentRevisions).length
  };
  const before = emptyMetrics(base);
  const after = emptyMetrics(base);
  before.duplicateSupplierLines = [...occurrences.values()].filter(
    (count) => count > 1
  ).length;
  after.duplicateSupplierLines = before.duplicateSupplierLines;
  const linkedLineIds = new Set(
    analysis.supplierOptions.flatMap((option) => option.matchedOfferLineIds)
  );
  const rows: SupplierPriceAuditRow[] = [];
  const afterPositions = new Set<string>();
  const beforePositions = new Set<string>();

  for (const option of analysis.supplierOptions) {
    const lines = supplierOptionLines(option, offerLines);
    const price = supplierPriceDisplay(option, lines);
    const sourceValidations = lines.map((line) =>
      validateSupplierSourceTarget({
        option,
        line,
        activeRevisionId:
          input.documentRevisions[option.supplierDocumentId] ?? null,
        pageCount: pageCounts.get(option.supplierDocumentId) ?? null
      })
    );
    const sourceValid = sourceValidations.some(
      (source) => source.status !== "INVALID"
    );
    const validity = classifySupplierOption({ option, lines, sourceValid });
    const selectable = isSelectableSupplierOption(validity);
    const beforeSelectable =
      option.offerAvailability !== "EXPLICIT_NO_OFFER" &&
      option.materialScopeStatus !== "EXPLICIT_NO_OFFER";
    if (beforeSelectable) before.selectableRealOptions += 1;
    if (selectable) after.selectableRealOptions += 1;
    if (beforeSelectable && !lines.length) before.invalidPlaceholderOptions += 1;
    if (!selectable && !lines.length) after.invalidPlaceholderOptions += 1;
    if (validity === "EXPLICIT_NO_OFFER") {
      before.explicitNoOfferOptions += 1;
      after.explicitNoOfferOptions += 1;
    }
    const oldState: SupplierPriceState =
      option.comparableTotal !== null || option.pricedTotal !== null
        ? "SOURCE_CONFIRMED_TOTAL"
        : option.primaryPrice !== null
          ? "UNIT_PRICE_ONLY"
          : "MISSING";
    incrementPriceState(before, oldState);
    incrementPriceState(after, price.state);
    for (const positionId of option.basisPositionIds) {
      if (beforeSelectable && lines.length) beforePositions.add(positionId);
      if (selectable) afterPositions.add(positionId);
    }
    const rawAllAlternative =
      lines.length > 1 && lines.every((line) => line.role === "ALTERNATIVE");
    if (rawAllAlternative) {
      const corrected = lines.some(
        (line) => supplierDisplayRole(line, lines) !== "ALTERNATIVE"
      );
      if (corrected) {
        before.roleClassificationAnomalies += lines.length;
        after.roleClassificationAnomalies += 0;
      }
    }
    const sidebarKeys = lines.map((line) => line.id);
    const duplicateSidebar =
      sidebarKeys.length - new Set(sidebarKeys).size;
    before.duplicateSidebarItems += duplicateSidebar;
    after.duplicateSidebarItems += 0;
    const lineIdsMissing = option.matchedOfferLineIds.filter(
      (lineId) => !offerLines.has(lineId)
    );
    before.orphanSupplierOptionLines += lineIdsMissing.length;
    after.orphanSupplierOptionLines += lineIdsMissing.length;

    const rowLines: Array<OfferLine | null> = lines.length ? lines : [null];
    for (const line of rowLines) {
      const sourceIndex = line ? lines.indexOf(line) : -1;
      const source =
        sourceIndex >= 0 ? sourceValidations[sourceIndex] : undefined;
      const discrepancies = optionDiscrepancies({
        option,
        lines,
        sourceValid,
        displayedTotal: price.total,
        displayedUnitPrice: price.unitPrice,
        displayedState: price.state
      });
      if (!line) discrepancies.push("OPTION_WITHOUT_REAL_LINE");
      const evidence = line?.evidence[0];
      rows.push({
        basisPosition: option.basisPositionIds
          .map((id) => basis.get(id)?.positionNumber ?? id)
          .join(", "),
        basisPositionId: option.basisPositionIds.join(","),
        supplier: option.supplierLabel,
        supplierOptionId: option.id,
        supplierLineId: line?.id ?? null,
        sourceDocument:
          documentLabels.get(option.supplierDocumentId) ??
          option.supplierDocumentId,
        sourcePage: source?.pageNumber ?? evidence?.pageNumber ?? null,
        sourceEp: line?.interpretedUnitPrice ?? null,
        sourceGp: line?.interpretedTotalPrice ?? null,
        extractedEp: line?.interpretedUnitPrice ?? null,
        extractedGp: line?.interpretedTotalPrice ?? null,
        optionPricedTotal: option.pricedTotal,
        optionComparableTotal: option.comparableTotal,
        displayedPrimaryPrice: price.total,
        displayedSecondaryPrice: price.unitPrice,
        displayedPriceStatus: price.labelDe,
        displayedPriceScope: price.scope,
        sourceAvailability: source?.status ?? "INVALID",
        optionValidity: validity,
        selectable,
        rawRole: line?.role ?? null,
        correctedRole: line ? supplierDisplayRole(line, lines) : null,
        discrepancyCodes: [...new Set(discrepancies)]
      });
      if (!line) {
        before.sourceLinksMissing += 1;
      } else if (source?.status === "EXACT") {
        before.sourceLinksValid += 1;
        after.sourceLinksValid += 1;
      } else if (source?.status === "PAGE_CONTEXT") {
        before.sourceLinksPageContext += 1;
        after.sourceLinksPageContext += 1;
      } else {
        before.sourceLinksMissing += 1;
        after.sourceLinksMissing += 1;
        if (evidence) {
          before.sourceLinksWrongPage += 1;
          after.sourceLinksWrongPage += 1;
        }
      }
      if (
        line?.interpretedTotalPrice !== null &&
        line?.interpretedTotalPrice !== undefined &&
        oldState === "MISSING"
      ) {
        before.gpPresentButUiNoPrice += 1;
      }
      if (
        line?.interpretedTotalPrice !== null &&
        line?.interpretedTotalPrice !== undefined &&
        price.state === "MISSING"
      ) {
        after.gpPresentButUiNoPrice += 1;
      }
    }
  }

  for (const line of offerLines.values()) {
    if (!linkedLineIds.has(line.id)) {
      rows.push({
        basisPosition: "—",
        basisPositionId: "",
        supplier: "—",
        supplierOptionId: "",
        supplierLineId: line.id,
        sourceDocument: line.evidence[0]?.documentId ?? "—",
        sourcePage: line.evidence[0]?.pageNumber ?? null,
        sourceEp: line.interpretedUnitPrice,
        sourceGp: line.interpretedTotalPrice,
        extractedEp: line.interpretedUnitPrice,
        extractedGp: line.interpretedTotalPrice,
        optionPricedTotal: null,
        optionComparableTotal: null,
        displayedPrimaryPrice: null,
        displayedSecondaryPrice: null,
        displayedPriceStatus: "Nicht zugeordnet",
        displayedPriceScope: "UNKNOWN",
        sourceAvailability: line.evidence.length ? "EXACT" : "INVALID",
        optionValidity: "UNASSIGNED_SUPPLIER",
        selectable: false,
        rawRole: line.role,
        correctedRole: line.role,
        discrepancyCodes: ["SOURCE_LINE_NOT_LINKED"]
      });
    }
    for (const evidence of line.evidence) {
      const pageCount = pageCounts.get(evidence.documentId);
      if (!pageCount || evidence.pageNumber < 1 || evidence.pageNumber > pageCount) {
        before.orphanEvidenceReferences += 1;
        after.orphanEvidenceReferences += 1;
      }
    }
  }

  before.positionsWithRealOffer = beforePositions.size;
  after.positionsWithRealOffer = afterPositions.size;
  before.positionsWithoutRealOffer =
    analysis.basisPositions.length - beforePositions.size;
  after.positionsWithoutRealOffer =
    analysis.basisPositions.length - afterPositions.size;
  before.criticalInconsistencies =
    before.gpPresentButUiNoPrice +
    before.orphanSupplierOptionLines +
    before.sourceLinksWrongPage;
  after.criticalInconsistencies =
    after.gpPresentButUiNoPrice +
    after.orphanSupplierOptionLines +
    after.sourceLinksWrongPage;

  const basisStructureCounts = countRecord<BasisStructureType>([
    "SINGLE_ITEM",
    "MULTI_COMPONENT_REQUIREMENT",
    "PACKAGE_REQUIREMENT",
    "ALTERNATIVE_REQUIREMENT",
    "DESCRIPTION_ONLY",
    "UNCLEAR_STRUCTURE"
  ]);
  const packageCompletenessCounts = countRecord<PackageCompleteness>([
    "COMPLETE",
    "PARTIAL",
    "PRIMARY_ONLY",
    "UNKNOWN"
  ]);
  const priceProvenanceCounts = countRecord<PriceProvenance>([
    "SOURCE_GP",
    "SOURCE_EP_ONLY",
    "CALCULATED_EP_X_QUANTITY",
    "BUNDLE_SUM",
    "PARTIAL_BUNDLE_SUM",
    "NO_PRICE"
  ]);
  const selectionModeCounts = countRecord<SelectionMode>([
    "COMPLETE_OPTION_SELECTION",
    "MULTI_LINE_SELECTION",
    "MIXED_SUPPLIER_SELECTION",
    "PARTIAL_SELECTION"
  ]);
  const optionModels = new Map<
    string,
    ReturnType<typeof buildOperatorSupplierOptionReadModel>
  >();
  const structureByPosition = new Map<
    string,
    ReturnType<typeof buildBasisStructureInterpretation>
  >();
  for (const position of analysis.basisPositions) {
    const structure = buildBasisStructureInterpretation(position);
    structureByPosition.set(position.id, structure);
    basisStructureCounts[structure.type] += 1;
    const models = analysis.supplierOptions
      .filter((option) => option.basisPositionIds.includes(position.id))
      .map((option) => {
        const model = buildOperatorSupplierOptionReadModel({
          basis: position,
          option,
          offerLines
        });
        optionModels.set(option.id, model);
        packageCompletenessCounts[model.packageCompleteness] += 1;
        priceProvenanceCounts[model.priceProvenance] += 1;
        return model;
      });
    selectionModeCounts[buildPositionSelectionMode(position, models)] += 1;
  }
  const selectedLegacyDecisions = input.state.supplierDecisions.filter(
    (decision): decision is SupplierDecisionV2 =>
      "selectedSupplierOptionId" in decision &&
      decision.status === "SELECTED"
  );
  const potentialFalseSingleLineSelections = selectedLegacyDecisions.filter(
    (decision) => {
      const structure = structureByPosition.get(decision.basisPositionId);
      return (
        Boolean(structure?.requiresComponentSelection) &&
        decision.selectedSupplierLineIds.length === 1
      );
    }
  ).length;
  const existingPartialSelections = selectedLegacyDecisions.filter(
    (decision) => {
      const model = decision.selectedSupplierOptionId
        ? optionModels.get(decision.selectedSupplierOptionId)
        : undefined;
      return Boolean(model && model.packageCompleteness !== "COMPLETE");
    }
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    rows,
    before,
    after,
    operatorWorkspace: {
      basisStructureVersion: BASIS_STRUCTURE_INTERPRETATION_VERSION,
      optionReadModelVersion: OPERATOR_SUPPLIER_OPTION_READ_MODEL_VERSION,
      basisStructureCounts,
      packageCompletenessCounts,
      priceProvenanceCounts,
      selectionModeCounts,
      multiComponentPositions:
        basisStructureCounts.MULTI_COMPONENT_REQUIREMENT +
        basisStructureCounts.PACKAGE_REQUIREMENT,
      positionsRequiringComponentSelection: [...structureByPosition.values()].filter(
        (structure) => structure.requiresComponentSelection
      ).length,
      legacySelectedDecisionsAudited: selectedLegacyDecisions.length,
      potentialFalseSingleLineSelections,
      existingPartialSelections,
      continuationPagePositions: [...structureByPosition.values()].filter(
        (structure) => structure.continuationPages.length > 1
      ).length,
      unclearStructurePositions: basisStructureCounts.UNCLEAR_STRUCTURE
    }
  };
}
