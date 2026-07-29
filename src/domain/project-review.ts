import { z } from "zod";
import type {
  BasisPosition,
  Discipline,
  SupplierDecision,
  SupplierOption
} from "@/domain/contracts";

export const ProjectDocumentRoleSchema = z.enum([
  "BASIS_LV",
  "SUPPLIER_OFFER",
  "SPECIALIZED_SUPPLIER_OFFER",
  "MANUFACTURER_CALCULATION",
  "FINAL_INTERNAL_CALCULATION",
  "FINAL_CUSTOMER_OFFER",
  "UNKNOWN"
]);
export type ProjectDocumentRole = z.infer<typeof ProjectDocumentRoleSchema>;

export const ProjectDocumentDescriptorSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  role: ProjectDocumentRoleSchema,
  projectKey: z.string(),
  projectNumber: z.string().nullable(),
  projectName: z.string(),
  discipline: z.enum(["SANITAER", "HEIZUNG", "MIXED", "UNKNOWN"]),
  lvNumber: z.string().nullable(),
  supplier: z.string().nullable(),
  offerNumber: z.string().nullable(),
  documentDate: z.string().date().nullable(),
  revision: z.number().int().nonnegative(),
  documentFamily: z.string(),
  relevantBasisPositionIds: z.array(z.string()),
  pageContext: z.array(z.number().int().positive())
}).strict();
export type ProjectDocumentDescriptor = z.infer<
  typeof ProjectDocumentDescriptorSchema
>;

export interface ActiveRevisionSelection {
  active: ProjectDocumentDescriptor[];
  superseded: ProjectDocumentDescriptor[];
  excluded: Array<{
    document: ProjectDocumentDescriptor;
    reason:
      | "PROJECT_MISMATCH"
      | "DISCIPLINE_MISMATCH"
      | "ROLE_NOT_SUPPLIER"
      | "AFTER_HISTORICAL_CUTOFF";
  }>;
}

const normalizedKey = (value: string) =>
  value
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function revisionFamily(document: ProjectDocumentDescriptor): string {
  return [
    normalizedKey(document.projectKey),
    document.discipline,
    normalizedKey(document.supplier ?? ""),
    normalizedKey(document.offerNumber ?? document.documentFamily)
  ].join("|");
}

function compareRevisions(
  left: ProjectDocumentDescriptor,
  right: ProjectDocumentDescriptor
): number {
  const dateDelta = (left.documentDate ?? "").localeCompare(
    right.documentDate ?? ""
  );
  if (dateDelta !== 0) return dateDelta;
  if (left.revision !== right.revision) return left.revision - right.revision;
  return left.revisionId.localeCompare(right.revisionId);
}

export function selectActiveSupplierRevisions(input: {
  documents: readonly ProjectDocumentDescriptor[];
  projectKey: string;
  discipline: Discipline;
  historicalCutoff: string | null;
}): ActiveRevisionSelection {
  const eligible: ProjectDocumentDescriptor[] = [];
  const excluded: ActiveRevisionSelection["excluded"] = [];
  for (const document of input.documents) {
    if (normalizedKey(document.projectKey) !== normalizedKey(input.projectKey)) {
      excluded.push({ document, reason: "PROJECT_MISMATCH" });
      continue;
    }
    if (
      document.discipline !== input.discipline &&
      document.discipline !== "MIXED"
    ) {
      excluded.push({ document, reason: "DISCIPLINE_MISMATCH" });
      continue;
    }
    if (
      !["SUPPLIER_OFFER", "SPECIALIZED_SUPPLIER_OFFER"].includes(document.role)
    ) {
      excluded.push({ document, reason: "ROLE_NOT_SUPPLIER" });
      continue;
    }
    if (
      input.historicalCutoff &&
      document.documentDate &&
      document.documentDate > input.historicalCutoff
    ) {
      excluded.push({ document, reason: "AFTER_HISTORICAL_CUTOFF" });
      continue;
    }
    eligible.push(document);
  }

  const active: ProjectDocumentDescriptor[] = [];
  const superseded: ProjectDocumentDescriptor[] = [];
  const families = new Map<string, ProjectDocumentDescriptor[]>();
  for (const document of eligible) {
    const key = revisionFamily(document);
    families.set(key, [...(families.get(key) ?? []), document]);
  }
  for (const revisions of families.values()) {
    const sorted = [...revisions].sort(compareRevisions);
    const latest = sorted.at(-1);
    if (latest) active.push(latest);
    superseded.push(...sorted.slice(0, -1));
  }
  return { active, superseded, excluded };
}

export const IndependentDecisionStatusSchema = z.enum([
  "AUTO_SELECTED_LOWEST_PRICE",
  "MANAGER_EXPLANATION_REQUIRED"
]);
export type IndependentDecisionStatus = z.infer<
  typeof IndependentDecisionStatusSchema
>;

export const BacktestClassificationSchema = z.enum([
  "AUTO_CONFIRMED_BY_HISTORY",
  "AUTO_LOWEST_BUT_HISTORY_DIFFERS",
  "NOT_COMPARABLE",
  "INSUFFICIENT_COVERAGE",
  "HISTORICAL_EK_UNRESOLVED",
  "NO_OFFER",
  "MANAGER_COMPLETED",
  "MANAGER_PENDING"
]);
export type BacktestClassification = z.infer<
  typeof BacktestClassificationSchema
>;

export const PositionCoverageStatusSchema = z.enum([
  "SUFFICIENT",
  "PARTIAL",
  "UNKNOWN"
]);
export type PositionCoverageStatus = z.infer<
  typeof PositionCoverageStatusSchema
>;

export const LiveProjectPositionStatusSchema = z.enum([
  "AUTO_SELECTED_LOWEST_PRICE",
  "MANUAL_DECISION_REQUIRED",
  "MANUAL_DECIDED",
  "DEFERRED",
  "NO_COMPARABLE_OFFER",
  "PROCESSING_PENDING",
  "PROCESSING_ERROR"
]);
export type LiveProjectPositionStatus = z.infer<
  typeof LiveProjectPositionStatusSchema
>;

export interface PositionSupplierCoverage {
  basisPositionId: string;
  relevantSuppliers: string[];
  processedRelevantSuppliers: string[];
  irrelevantSpecializedSuppliers: string[];
  explicitNoOfferSuppliers: string[];
  missingExpectedSuppliers: string[];
  missingSources: Array<{
    supplierDocumentId: string;
    pages: number[];
  }>;
  coverageStatus: PositionCoverageStatus;
}

export interface SupplierCoverageDocument {
  id: string;
  role: "SUPPLIER_OFFER" | "SPECIALIZED_SUPPLIER_OFFER";
  processed: boolean;
  scope:
    | { status: "ALL" }
    | { status: "LISTED"; basisPositionIds: readonly string[] }
    | { status: "UNKNOWN" };
}

export function buildPositionSupplierCoverage(input: {
  basisPositionId: string;
  documents: readonly SupplierCoverageDocument[];
  options: readonly SupplierOption[];
}): PositionSupplierCoverage {
  const relevant: SupplierCoverageDocument[] = [];
  const irrelevantSpecialized: string[] = [];
  for (const document of input.documents) {
    if (document.role === "SUPPLIER_OFFER") {
      relevant.push(document);
      continue;
    }
    const covered =
      document.scope.status === "ALL" ||
      (document.scope.status === "LISTED" &&
        document.scope.basisPositionIds.includes(input.basisPositionId));
    if (covered) relevant.push(document);
    else irrelevantSpecialized.push(document.id);
  }
  const explicitNoOfferSuppliers = relevant
    .filter((document) =>
      input.options.some(
        (option) =>
          option.supplierDocumentId === document.id &&
          option.offerAvailability === "EXPLICIT_NO_OFFER"
      )
    )
    .map((document) => document.id);
  const hasPositionSourceCoverage = (documentId: string) =>
    input.options.some(
      (option) =>
        option.supplierDocumentId === documentId &&
        option.basisPositionIds.includes(input.basisPositionId) &&
        option.offerAvailability !== "NOT_COVERED"
    );
  const processedRelevantSuppliers = relevant
    .filter(
      (document) =>
        document.processed && hasPositionSourceCoverage(document.id)
    )
    .map((document) => document.id);
  const missingExpectedSuppliers = relevant
    .filter(
      (document) =>
        (!document.processed || !hasPositionSourceCoverage(document.id)) &&
        !explicitNoOfferSuppliers.includes(document.id)
    )
    .map((document) => document.id);
  return {
    basisPositionId: input.basisPositionId,
    relevantSuppliers: relevant.map((document) => document.id),
    processedRelevantSuppliers,
    irrelevantSpecializedSuppliers: irrelevantSpecialized,
    explicitNoOfferSuppliers,
    missingExpectedSuppliers,
    missingSources: [],
    coverageStatus:
      relevant.length === 0
        ? "UNKNOWN"
        : missingExpectedSuppliers.length > 0
          ? "PARTIAL"
          : "SUFFICIENT"
  };
}

export interface SupplierCoverageContext {
  activeSupplierDocumentIds: ReadonlySet<string>;
  allRelevantOffersProcessed: boolean;
  supplierCoverageSufficient: boolean;
  projectContextConfirmed: boolean;
  disciplineContextConfirmed: boolean;
  materialUncertainty: boolean;
}

export interface IndependentPositionResult {
  basisPositionId: string;
  status: IndependentDecisionStatus;
  selectedSupplierOptionId: string | null;
  fullyComparableOptionIds: string[];
  systemCheapestOptionId: string | null;
  nextComparableOptionId: string | null;
  comparableTotal: number | null;
  nextComparableTotal: number | null;
  saving: number | null;
  reasons: string[];
  calculatedAt: string;
}

export function isFullyComparableSupplierOption(
  option: SupplierOption,
  context: SupplierCoverageContext
): boolean {
  return (
    context.activeSupplierDocumentIds.has(option.supplierDocumentId) &&
    context.projectContextConfirmed &&
    context.disciplineContextConfirmed &&
    (option.matchingAccepted || option.matchingReliable) &&
    option.quantityCompatible &&
    option.unitCompatible &&
    option.technicalCompatible &&
    (option.technicalComparisonStatus ??
      (option.technicalCompatible
        ? "CONFIRMED_COMPATIBLE"
        : "CONFIRMED_DEVIATION")) === "CONFIRMED_COMPATIBLE" &&
    option.requiredScopeComplete &&
    option.missingComponents.length === 0 &&
    option.optionalSeparated &&
    option.bundleCompatible &&
    option.materialScopeStatus === "COMPLETE_MATERIAL_SCOPE" &&
    option.comparableTotal !== null &&
    option.extractionValidated &&
    option.evidenceSufficient &&
    option.validationIssueIds.length === 0 &&
    option.offerAvailability === "PRESENT"
  );
}

export function selectUniqueLowestComparableOption(input: {
  basisPositionId: string;
  options: readonly SupplierOption[];
  coverage: SupplierCoverageContext;
  calculatedAt?: string;
  equalityTolerance?: number;
}): IndependentPositionResult {
  const tolerance = input.equalityTolerance ?? 0.005;
  const fullyComparable = input.options.filter((option) =>
    isFullyComparableSupplierOption(option, input.coverage)
  );
  const sorted = [...fullyComparable].sort(
    (left, right) => left.comparableTotal! - right.comparableTotal!
  );
  const cheapest = sorted[0] ?? null;
  const next = sorted[1] ?? null;
  const uniqueMinimum = Boolean(
    cheapest &&
      (!next ||
        Math.abs(next.comparableTotal! - cheapest.comparableTotal!) > tolerance)
  );
  const coverageReady =
    input.coverage.allRelevantOffersProcessed &&
    input.coverage.supplierCoverageSufficient;
  const alternativesResolved = input.options
    .filter((option) =>
      input.coverage.activeSupplierDocumentIds.has(option.supplierDocumentId)
    )
    .every((option) =>
      [
        "COMPLETE_MATERIAL_SCOPE",
        "PARTIAL_MATERIAL_SCOPE",
        "TECHNICALLY_DEVIATING",
        "EXPLICIT_NO_OFFER"
      ].includes(option.materialScopeStatus)
    );
  const automatic =
    Boolean(cheapest) &&
    uniqueMinimum &&
    coverageReady &&
    alternativesResolved &&
    !input.coverage.materialUncertainty;
  const reasons: string[] = [];
  if (fullyComparable.length === 0) {
    reasons.push("Keine vollständig vergleichbare Supplier-Option verfügbar");
  }
  if (!input.coverage.allRelevantOffersProcessed) {
    reasons.push("Nicht alle relevanten Supplier-Angebote wurden verarbeitet");
  }
  if (!input.coverage.supplierCoverageSufficient) {
    reasons.push("Supplier-Abdeckung ist für eine automatische Auswahl unvollständig");
  }
  if (cheapest && !uniqueMinimum) {
    reasons.push("Kein eindeutiges Preisminimum; mindestens zwei Optionen sind gleich günstig");
  }
  if (input.coverage.materialUncertainty) {
    reasons.push("Materielle technische, Scope- oder Matching-Unsicherheit bleibt offen");
  }
  if (!alternativesResolved) {
    reasons.push(
      "Mindestens eine Supplier-Antwort ist nicht eindeutig als vollständig, teilweise, technisch abweichend oder nicht angeboten belegt"
    );
  }
  if (automatic) {
    reasons.push(
      fullyComparable.length === 1
        ? "Einziges vollständig vergleichbares Angebot"
        : "Eindeutig niedrigste vollständig vergleichbare Option"
    );
  }
  return {
    basisPositionId: input.basisPositionId,
    status: automatic
      ? "AUTO_SELECTED_LOWEST_PRICE"
      : "MANAGER_EXPLANATION_REQUIRED",
    selectedSupplierOptionId: automatic ? cheapest!.id : null,
    fullyComparableOptionIds: fullyComparable.map((option) => option.id),
    systemCheapestOptionId: cheapest?.id ?? null,
    nextComparableOptionId: next?.id ?? null,
    comparableTotal: cheapest?.comparableTotal ?? null,
    nextComparableTotal: next?.comparableTotal ?? null,
    saving:
      cheapest?.comparableTotal !== null &&
      cheapest?.comparableTotal !== undefined &&
      next?.comparableTotal !== null &&
      next?.comparableTotal !== undefined
        ? Math.round((next.comparableTotal - cheapest.comparableTotal) * 100) / 100
        : null,
    reasons,
    calculatedAt: input.calculatedAt ?? new Date().toISOString()
  };
}

export interface HistoricalPositionEvaluation {
  basisPositionId: string;
  classification: BacktestClassification;
  historicalMaterialEk: number | null;
  historicalMatchedOptionId: string | null;
  independentSelectedOptionId: string | null;
  reasons: string[];
}

function latestDecisionFor(
  decisions: readonly SupplierDecision[],
  basisPositionId: string
): SupplierDecision | null {
  return (
    decisions
      .filter((decision) => decision.basisPositionId === basisPositionId)
      .at(-1) ?? null
  );
}

export function evaluateHistoricalMaterialEk(input: {
  independent: IndependentPositionResult;
  options: readonly SupplierOption[];
  historicalMaterialEk: number | null;
  decisions?: readonly SupplierDecision[];
  roundingTolerance?: number;
}): HistoricalPositionEvaluation {
  const tolerance = input.roundingTolerance ?? 0.01;
  const latestDecision = latestDecisionFor(
    input.decisions ?? [],
    input.independent.basisPositionId
  );
  if (latestDecision) {
    const completed = ["SELECTED", "NONE_CORRECT"].includes(latestDecision.status);
    return {
      basisPositionId: input.independent.basisPositionId,
      classification: completed ? "MANAGER_COMPLETED" : "MANAGER_PENDING",
      historicalMaterialEk: input.historicalMaterialEk,
      historicalMatchedOptionId: null,
      independentSelectedOptionId: input.independent.selectedSupplierOptionId,
      reasons: [
        completed
          ? "Managerentscheidung gespeichert"
          : "Managerentscheidung zurückgestellt oder zusätzliche Prüfung angefordert"
      ]
    };
  }

  const presentOptions = input.options.filter(
    (option) => option.offerAvailability === "PRESENT"
  );
  if (presentOptions.length === 0) {
    return {
      basisPositionId: input.independent.basisPositionId,
      classification: "NO_OFFER",
      historicalMaterialEk: input.historicalMaterialEk,
      historicalMatchedOptionId: null,
      independentSelectedOptionId: input.independent.selectedSupplierOptionId,
      reasons: ["Kein Supplier-Angebot für diese Position vorhanden"]
    };
  }
  const historyMatch =
    input.historicalMaterialEk === null
      ? null
      : input.options.find(
          (option) =>
            option.comparableTotal !== null &&
            Math.abs(option.comparableTotal - input.historicalMaterialEk!) <= tolerance
        ) ?? null;
  if (
    input.independent.status === "AUTO_SELECTED_LOWEST_PRICE" &&
    input.historicalMaterialEk !== null
  ) {
    if (historyMatch?.id === input.independent.selectedSupplierOptionId) {
      return {
        basisPositionId: input.independent.basisPositionId,
        classification: "AUTO_CONFIRMED_BY_HISTORY",
        historicalMaterialEk: input.historicalMaterialEk,
        historicalMatchedOptionId: historyMatch.id,
        independentSelectedOptionId: input.independent.selectedSupplierOptionId,
        reasons: ["Historischer Material EK bestätigt die unabhängige niedrigste Option"]
      };
    }
    return {
      basisPositionId: input.independent.basisPositionId,
      classification: "AUTO_LOWEST_BUT_HISTORY_DIFFERS",
      historicalMaterialEk: input.historicalMaterialEk,
      historicalMatchedOptionId: historyMatch?.id ?? null,
      independentSelectedOptionId: input.independent.selectedSupplierOptionId,
      reasons: [
        historyMatch
          ? "Historischer Material EK entspricht einer teureren Supplier-Option"
          : "Historischer Material EK stimmt mit keiner Supplier-Option überein"
      ]
    };
  }
  if (input.historicalMaterialEk === null) {
    return {
      basisPositionId: input.independent.basisPositionId,
      classification: "HISTORICAL_EK_UNRESOLVED",
      historicalMaterialEk: null,
      historicalMatchedOptionId: null,
      independentSelectedOptionId: input.independent.selectedSupplierOptionId,
      reasons: ["Historischer Material EK ist nicht verfügbar"]
    };
  }
  if (
    presentOptions.some(
      (option) =>
        option.comparableTotal === null &&
        !option.quantityCompatible &&
        option.pricedTotal !== null
    )
  ) {
    return {
      basisPositionId: input.independent.basisPositionId,
      classification: "INSUFFICIENT_COVERAGE",
      historicalMaterialEk: input.historicalMaterialEk,
      historicalMatchedOptionId: historyMatch?.id ?? null,
      independentSelectedOptionId: input.independent.selectedSupplierOptionId,
      reasons: ["Mindestens eine preislich relevante Option deckt die Basis-Menge nicht"]
    };
  }
  return {
    basisPositionId: input.independent.basisPositionId,
    classification: "NOT_COMPARABLE",
    historicalMaterialEk: input.historicalMaterialEk,
    historicalMatchedOptionId: historyMatch?.id ?? null,
    independentSelectedOptionId: input.independent.selectedSupplierOptionId,
    reasons: [
      ...input.independent.reasons,
      "Technik, Scope, Bundle, Matching oder Preis ist nicht vollständig vergleichbar"
    ]
  };
}

export interface ProjectReviewPosition {
  basis: BasisPosition;
  options: SupplierOption[];
  coverage: PositionSupplierCoverage;
  independent: IndependentPositionResult;
  historical: HistoricalPositionEvaluation;
  liveStatus: LiveProjectPositionStatus;
  reviewQueue?: ManualReviewQueue | null;
  primaryReasonCategory?: ManualPrimaryReasonCategory | null;
  primaryReasonDe?: string | null;
}

export const MANUAL_PRIMARY_REASON_CATEGORIES = [
  "MATCHING_AMBIGUOUS",
  "BUNDLE_AMBIGUOUS",
  "MANDATORY_SCOPE_UNCLEAR",
  "TECHNICAL_EQUIVALENCE_UNCLEAR",
  "QUANTITY_OR_UNIT_UNCLEAR",
  "PRICE_OR_ARITHMETIC_UNCLEAR",
  "EVIDENCE_INSUFFICIENT",
  "EQUAL_MINIMUM",
  "ALTERNATIVE_REQUIRES_SELECTION",
  "RELEVANT_SUPPLIER_STATUS_UNKNOWN",
  "OTHER"
] as const;
export type ManualPrimaryReasonCategory =
  (typeof MANUAL_PRIMARY_REASON_CATEGORIES)[number];
export type ManualReviewQueue = "SYSTEM_REVIEW" | "MANAGER_DECISION";

const MANUAL_REASON_LABELS: Record<ManualPrimaryReasonCategory, string> = {
  MATCHING_AMBIGUOUS: "Zuordnung der Angebotsposition ist nicht eindeutig",
  BUNDLE_AMBIGUOUS: "Zusammensetzung des Pflicht-Bundles ist nicht eindeutig",
  MANDATORY_SCOPE_UNCLEAR: "Pflicht-Lieferumfang ist nicht vollständig belegt",
  TECHNICAL_EQUIVALENCE_UNCLEAR:
    "Technische Gleichwertigkeit ist aus den vorhandenen Quellen nicht vollständig belegt",
  QUANTITY_OR_UNIT_UNCLEAR: "Menge oder Einheit ist nicht eindeutig vergleichbar",
  PRICE_OR_ARITHMETIC_UNCLEAR:
    "Preis oder Preisarithmetik ist nicht vollständig bestätigt",
  EVIDENCE_INSUFFICIENT: "Source evidence ist nicht ausreichend",
  EQUAL_MINIMUM: "Mehrere vollständige Angebote haben denselben Mindestpreis",
  ALTERNATIVE_REQUIRES_SELECTION:
    "Eine echte Angebotsalternative erfordert eine fachliche Auswahl",
  RELEVANT_SUPPLIER_STATUS_UNKNOWN:
    "Status eines relevanten Lieferantenangebots ist nicht eindeutig",
  OTHER: "Systemprüfung der Vergleichsgrundlage erforderlich"
};

export function classifyManualReview(input: {
  liveStatus: LiveProjectPositionStatus;
  independent: IndependentPositionResult;
  coverage: PositionSupplierCoverage;
  options: readonly SupplierOption[];
}): {
  reviewQueue: ManualReviewQueue | null;
  primaryReasonCategory: ManualPrimaryReasonCategory | null;
  primaryReasonDe: string | null;
} {
  if (input.liveStatus !== "MANUAL_DECISION_REQUIRED") {
    return {
      reviewQueue: null,
      primaryReasonCategory: null,
      primaryReasonDe: null
    };
  }
  const present = input.options.filter(
    (option) => option.offerAvailability === "PRESENT"
  );
  let category: ManualPrimaryReasonCategory;
  if (present.some((option) => !option.matchingReliable && !option.matchingAccepted)) {
    category = "MATCHING_AMBIGUOUS";
  } else if (present.some((option) => !option.bundleCompatible)) {
    category = "BUNDLE_AMBIGUOUS";
  } else if (
    present.some(
      (option) =>
        option.materialScopeStatus === "UNKNOWN" &&
        (!option.requiredScopeComplete || option.missingComponents.length > 0)
    )
  ) {
    category = "MANDATORY_SCOPE_UNCLEAR";
  } else if (
    present.some(
      (option) => option.technicalComparisonStatus === "UNRESOLVED"
    )
  ) {
    category = "TECHNICAL_EQUIVALENCE_UNCLEAR";
  } else if (
    present.some(
      (option) =>
        option.materialScopeStatus === "UNKNOWN" &&
        (!option.quantityCompatible || !option.unitCompatible)
    )
  ) {
    category = "QUANTITY_OR_UNIT_UNCLEAR";
  } else if (
    present.some(
      (option) =>
        option.materialScopeStatus === "UNKNOWN" &&
        option.pricedTotal === null
    )
  ) {
    category = "PRICE_OR_ARITHMETIC_UNCLEAR";
  } else if (
    present.some(
      (option) => !option.evidenceSufficient || !option.extractionValidated
    )
  ) {
    category = "EVIDENCE_INSUFFICIENT";
  } else if (
    input.options.some(
      (option) =>
        option.offerAvailability === "COVERED_WITHOUT_OFFER" ||
        ["UNKNOWN", "NOT_COVERED"].includes(option.materialScopeStatus)
    ) ||
    input.coverage.missingExpectedSuppliers.length > 0
  ) {
    category = "RELEVANT_SUPPLIER_STATUS_UNKNOWN";
  } else if (
    input.independent.fullyComparableOptionIds.length > 1 &&
    input.independent.comparableTotal !== null &&
    input.independent.nextComparableTotal !== null &&
    Math.abs(
      input.independent.nextComparableTotal -
        input.independent.comparableTotal
    ) <= 0.005
  ) {
    category = "EQUAL_MINIMUM";
  } else if (
    input.options.some(
      (option) =>
        option.optionalPrices.length > 0 &&
        option.materialScopeStatus === "COMPLETE_MATERIAL_SCOPE"
    )
  ) {
    category = "ALTERNATIVE_REQUIRES_SELECTION";
  } else {
    category = "OTHER";
  }
  const reviewQueue: ManualReviewQueue = [
    "EQUAL_MINIMUM",
    "ALTERNATIVE_REQUIRES_SELECTION"
  ].includes(category)
    ? "MANAGER_DECISION"
    : "SYSTEM_REVIEW";
  return {
    reviewQueue,
    primaryReasonCategory: category,
    primaryReasonDe: MANUAL_REASON_LABELS[category]
  };
}

export function deriveLiveProjectStatus(input: {
  independent: IndependentPositionResult;
  coverage: PositionSupplierCoverage;
  options?: readonly SupplierOption[];
  decisions?: readonly SupplierDecision[];
  processingError?: boolean;
}): LiveProjectPositionStatus {
  const latestDecision = latestDecisionFor(
    input.decisions ?? [],
    input.independent.basisPositionId
  );
  if (latestDecision?.status === "SELECTED" || latestDecision?.status === "NONE_CORRECT") {
    return "MANUAL_DECIDED";
  }
  if (
    latestDecision?.status === "DEFERRED" ||
    latestDecision?.status === "ADDITIONAL_CHECK_REQUESTED"
  ) {
    return "DEFERRED";
  }
  if (input.processingError) return "PROCESSING_ERROR";
  if (input.coverage.coverageStatus !== "SUFFICIENT") {
    return "PROCESSING_PENDING";
  }
  if (input.independent.status === "AUTO_SELECTED_LOWEST_PRICE") {
    return "AUTO_SELECTED_LOWEST_PRICE";
  }
  if (input.independent.fullyComparableOptionIds.length === 0) {
    const unresolvedCouldChangeResult = input.options?.some(
      (option) =>
        ["UNKNOWN", "NOT_COVERED"].includes(
          option.materialScopeStatus ?? "UNKNOWN"
        ) ||
        (option.offerAvailability === "PRESENT" &&
          (option.technicalComparisonStatus === "UNRESOLVED" ||
            !option.matchingReliable ||
            !option.extractionValidated ||
            !option.evidenceSufficient))
    );
    return unresolvedCouldChangeResult
      ? "MANUAL_DECISION_REQUIRED"
      : "NO_COMPARABLE_OFFER";
  }
  return "MANUAL_DECISION_REQUIRED";
}

export function buildProjectReviewPositions(input: {
  basisPositions: readonly BasisPosition[];
  options: readonly SupplierOption[];
  coverage: SupplierCoverageContext;
  coverageByBasisId?: Readonly<Record<string, PositionSupplierCoverage>>;
  historicalMaterialEkByBasisId?: Readonly<Record<string, number>>;
  decisions?: readonly SupplierDecision[];
  processingErrorBasisIds?: ReadonlySet<string>;
  calculatedAt?: string;
}): ProjectReviewPosition[] {
  return input.basisPositions
    .filter((basis) => !basis.heading)
    .map((basis) => {
      const options = input.options.filter((option) =>
        option.basisPositionIds.includes(basis.id)
      );
      const coverage =
        input.coverageByBasisId?.[basis.id] ?? {
          basisPositionId: basis.id,
          relevantSuppliers: [...input.coverage.activeSupplierDocumentIds],
          processedRelevantSuppliers: [
            ...input.coverage.activeSupplierDocumentIds
          ],
          irrelevantSpecializedSuppliers: [],
          explicitNoOfferSuppliers: [],
          missingExpectedSuppliers:
            input.coverage.allRelevantOffersProcessed
              ? []
              : ["UNRESOLVED_SUPPLIER_COVERAGE"],
          missingSources: [],
          coverageStatus:
            input.coverage.allRelevantOffersProcessed &&
            input.coverage.supplierCoverageSufficient
              ? "SUFFICIENT" as const
              : "PARTIAL" as const
        };
      const positionCoverageContext: SupplierCoverageContext = {
        ...input.coverage,
        activeSupplierDocumentIds: new Set(
          coverage.processedRelevantSuppliers
        ),
        allRelevantOffersProcessed: coverage.coverageStatus === "SUFFICIENT",
        supplierCoverageSufficient: coverage.coverageStatus === "SUFFICIENT"
      };
      const independent = selectUniqueLowestComparableOption({
        basisPositionId: basis.id,
        options,
        coverage: positionCoverageContext,
        calculatedAt: input.calculatedAt
      });
      const historical = evaluateHistoricalMaterialEk({
        independent,
        options,
        historicalMaterialEk:
          input.historicalMaterialEkByBasisId?.[basis.id] ?? null,
        decisions: input.decisions
      });
      const liveStatus = deriveLiveProjectStatus({
        independent,
        coverage,
        options,
        decisions: input.decisions,
        processingError: input.processingErrorBasisIds?.has(basis.id)
      });
      const manualReview = classifyManualReview({
        liveStatus,
        independent,
        coverage,
        options
      });
      return {
        basis,
        options,
        coverage,
        independent,
        historical,
        liveStatus,
        ...manualReview
      };
    });
}
