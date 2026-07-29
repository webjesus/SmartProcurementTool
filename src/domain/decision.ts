import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CURRENT_DECISION_REASON_CATALOG,
  type DecisionReasonCatalog
} from "@/domain/decision-catalog";
import type {
  BasisPosition,
  EvidenceReference,
  OfferLine,
  SupplierDecisionV2,
  SupplierOption
} from "@/domain/contracts";
import { SupplierDecisionV2Schema } from "@/domain/contracts";
import type { PersistedPilotRun, PilotState } from "@/storage/document-storage";

export const SupplierDecisionDraftSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("SELECTED"),
    basisPositionId: z.string().min(1),
    selectedSupplierOptionId: z.string().min(1),
    selectedSupplierLineIds: z.array(z.string().min(1)).min(1).optional(),
    reasonCodes: z.array(z.string().min(1)).min(1),
    comment: z.string(),
    decidedBy: z.string().min(1),
    decisionType: z.enum(["MANUAL_SELECTION", "AUTOMATIC_OVERRIDE"]).optional()
  }).strict(),
  z.object({
    status: z.literal("DEFERRED"),
    basisPositionId: z.string().min(1),
    selectedSupplierOptionId: z.null(),
    reasonCodes: z.array(z.string()).max(0),
    comment: z.string(),
    decidedBy: z.string().min(1)
  }).strict(),
  z.object({
    status: z.literal("NONE_CORRECT"),
    basisPositionId: z.string().min(1),
    selectedSupplierOptionId: z.null(),
    selectedSupplierLineIds: z.array(z.string()).max(0),
    reasonCodes: z.array(z.string().min(1)).min(1),
    comment: z.string().min(1),
    decidedBy: z.string().min(1)
  }).strict(),
  z.object({
    status: z.literal("ADDITIONAL_CHECK_REQUESTED"),
    basisPositionId: z.string().min(1),
    selectedSupplierOptionId: z.null(),
    selectedSupplierLineIds: z.array(z.string()).max(0),
    reasonCodes: z.array(z.string()).max(0),
    comment: z.string(),
    decidedBy: z.string().min(1)
  }).strict()
]);
export type SupplierDecisionDraft = z.infer<typeof SupplierDecisionDraftSchema>;

export interface DecisionValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManagerDecisionComment(input: {
  status: "SELECTED" | "DEFERRED" | "NONE_CORRECT" | "ADDITIONAL_CHECK_REQUESTED";
  decisionType?: "MANUAL_SELECTION" | "AUTOMATIC_OVERRIDE";
  comment: string;
}): DecisionValidationResult {
  const required =
    input.status === "DEFERRED" ||
    input.status === "NONE_CORRECT" ||
    input.status === "ADDITIONAL_CHECK_REQUESTED" ||
    input.decisionType === "AUTOMATIC_OVERRIDE";
  if (!required) return { valid: true, errors: [] };
  const comment = input.comment.trim();
  if (comment.length === 0) {
    return { valid: false, errors: ["DECISION_COMMENT_REQUIRED"] };
  }
  if (comment.length < 40 || comment.split(/\s+/).filter(Boolean).length < 5) {
    return { valid: false, errors: ["DECISION_COMMENT_TOO_SHORT"] };
  }
  return { valid: true, errors: [] };
}

export function validateDecisionReasons(
  reasonCodes: readonly string[],
  comment: string,
  catalog: DecisionReasonCatalog = CURRENT_DECISION_REASON_CATALOG
): DecisionValidationResult {
  const errors: string[] = [];
  if (reasonCodes.length === 0) errors.push("DECISION_REASON_REQUIRED");
  const uniqueCodes = Array.from(new Set(reasonCodes));
  if (uniqueCodes.length !== reasonCodes.length) {
    errors.push("DUPLICATE_DECISION_REASON");
  }
  const selected = uniqueCodes.map((code) =>
    catalog.reasons.find((reason) => reason.code === code)
  );
  if (selected.some((reason) => !reason)) errors.push("DECISION_REASON_UNKNOWN");
  if (selected.some((reason) => reason && !reason.active)) {
    errors.push("DECISION_REASON_INACTIVE");
  }
  if (
    selected.length > 1 &&
    selected.some((reason) => reason && !reason.allowsMultiple)
  ) {
    errors.push("DECISION_REASON_MULTIPLE_NOT_ALLOWED");
  }
  if (
    selected.some((reason) => reason?.requiresComment) &&
    comment.trim().length === 0
  ) {
    errors.push("DECISION_COMMENT_REQUIRED");
  }
  return { valid: errors.length === 0, errors };
}

export function deriveDocumentRevisionId(
  documentId: string,
  runs: readonly PersistedPilotRun[]
): string | null {
  const revisionRuns = runs
    .filter((run) => run.document.id === documentId)
    .sort((left, right) => left.document.pageNumber - right.document.pageNumber);
  if (revisionRuns.length === 0) return null;
  const revisionFingerprint = revisionRuns.map((run) => ({
    pageNumber: run.document.pageNumber,
    cacheKey: run.result.metadata.cacheKey,
    responseId: run.result.metadata.responseId,
    preprocessingVersion: run.result.metadata.preprocessingVersion
  }));
  return `local-revision-${createHash("sha256")
    .update(JSON.stringify(revisionFingerprint))
    .digest("hex")
    .slice(0, 20)}`;
}

export function buildDocumentRevisionIndex(
  runs: readonly PersistedPilotRun[]
): Record<string, string> {
  return Object.fromEntries(
    Array.from(new Set(runs.map((run) => run.document.id))).flatMap((documentId) => {
      const revisionId = deriveDocumentRevisionId(documentId, runs);
      return revisionId ? [[documentId, revisionId]] : [];
    })
  );
}

function evidencePage(
  evidence: EvidenceReference,
  runs: readonly PersistedPilotRun[],
  revisions: Record<string, string>
) {
  const run = runs.find(
    (item) =>
      item.document.id === evidence.documentId &&
      item.document.pageNumber === evidence.pageNumber
  );
  const documentRevisionId = revisions[evidence.documentId];
  if (!run || !documentRevisionId) return null;
  return {
    evidenceId: evidence.id,
    documentId: evidence.documentId,
    documentRevisionId,
    pageNumber: evidence.pageNumber,
    region: evidence.region,
    assetKey: run.pageImageAsset
  };
}

function lineSnapshot(
  line: OfferLine,
  runs: readonly PersistedPilotRun[],
  revisions: Record<string, string>
) {
  const sources = line.evidence
    .map((evidence) => evidencePage(evidence, runs, revisions))
    .filter((source): source is NonNullable<typeof source> => source !== null);
  return {
    lineId: line.id,
    role: line.role,
    description: line.description,
    manufacturer: line.manufacturer,
    articleNumber: line.articleNumber,
    quantity: line.quantity,
    unit: line.unit,
    continuation: line.continuation,
    sources
  };
}

function basisSnapshot(
  position: BasisPosition,
  runs: readonly PersistedPilotRun[],
  revisions: Record<string, string>
) {
  return {
    id: position.id,
    positionNumber: position.positionNumber,
    description: position.description,
    quantity: position.quantity,
    unit: position.unit,
    sources: position.evidence
      .map((evidence) => evidencePage(evidence, runs, revisions))
      .filter((source): source is NonNullable<typeof source> => source !== null)
  };
}

function allOfferLines(state: PilotState): OfferLine[] {
  return state.runs.flatMap((run) =>
    run.result.envelope.extraction.offerGroups.flatMap((group) => group.lines)
  );
}

export function buildDecisionEvidenceSnapshot(input: {
  state: PilotState;
  basis: BasisPosition;
  option: SupplierOption | null;
  selectedLineIds?: readonly string[];
  capturedAt: string;
}) {
  const revisions = buildDocumentRevisionIndex(input.state.runs);
  const basisPositions = input.state.analysis?.basisPositions ?? [input.basis];
  const basisIndex = basisPositions.findIndex(
    (position) => position.id === input.basis.id
  );
  const basisPositionSnapshot = basisSnapshot(
    input.basis,
    input.state.runs,
    revisions
  );
  const basisContext = basisPositions
    .slice(Math.max(0, basisIndex - 1), basisIndex + 2)
    .map((position) => basisSnapshot(position, input.state.runs, revisions));
  const offerLines = allOfferLines(input.state);
  const allowedSelectedLineIds = new Set(
    input.option?.matchedOfferLineIds ?? []
  );
  const selectedLineRecords = (
    input.selectedLineIds ??
    input.option?.matchedOfferLineIds ??
    []
  )
    .filter((lineId) => allowedSelectedLineIds.has(lineId))
    .map((lineId) => offerLines.find((line) => line.id === lineId))
    .filter((line): line is OfferLine => Boolean(line));
  const selectedLines = selectedLineRecords.map((line) =>
    lineSnapshot(line, input.state.runs, revisions)
  );
  const selectedLineIds = new Set(selectedLines.map((line) => line.lineId));
  const relevantGroupIds = new Set(
    selectedLineRecords
      .map((line) => line.groupId)
      .filter((groupId): groupId is string => Boolean(groupId))
  );
  const relevantPositions = new Set(
    selectedLineRecords
      .map((line) => line.sourcePositionNumber)
      .filter((position): position is string => Boolean(position))
  );
  const supplierLines = offerLines.filter((line) =>
    line.evidence.some(
      (evidence) => evidence.documentId === input.option?.supplierDocumentId
    )
  );
  const selectedIndexes = selectedLineRecords
    .map((line) => supplierLines.findIndex((candidate) => candidate.id === line.id))
    .filter((index) => index >= 0);
  const supplierContextLineIds = new Set(
    selectedIndexes.flatMap((index) =>
      supplierLines
        .slice(Math.max(0, index - 1), index + 2)
        .map((line) => line.id)
    )
  );
  const supplierContextLines = supplierLines
    .filter((line) => supplierContextLineIds.has(line.id))
    .map((line) => lineSnapshot(line, input.state.runs, revisions));
  const includedRequiredComponents = selectedLines.filter((line) =>
    [
      "REQUIRED_COMPONENT",
      "MANDATORY_COMPONENT",
      "INCLUDED_ACCESSORY"
    ].includes(line.role)
  );
  const excludedOptionalComponents = supplierLines
    .filter(
      (line) =>
        ["OPTIONAL", "ALTERNATIVE"].includes(line.role) &&
        !selectedLineIds.has(line.id) &&
        (
          (line.groupId !== null && relevantGroupIds.has(line.groupId)) ||
          (line.sourcePositionNumber !== null &&
            relevantPositions.has(line.sourcePositionNumber))
        )
    )
    .map((line) => lineSnapshot(line, input.state.runs, revisions));
  const continuationPages = supplierLines
    .filter(
      (line) =>
        line.continuation &&
        line.groupId !== null &&
        relevantGroupIds.has(line.groupId)
    )
    .flatMap((line) => lineSnapshot(line, input.state.runs, revisions).sources);
  const visibleSupplierOptions = (input.state.analysis?.supplierOptions ?? [])
    .filter((option) => option.basisPositionIds.includes(input.basis.id))
    .map((option) => ({
      optionId: option.id,
      supplierDocumentId: option.supplierDocumentId,
      supplierLabel: option.supplierLabel,
      comparableTotal: option.comparableTotal,
      status: option.status,
      reasons: option.reasons,
      lines: option.matchedOfferLineIds
        .map((lineId) => offerLines.find((line) => line.id === lineId))
        .filter((line): line is OfferLine => Boolean(line))
        .map((line) => lineSnapshot(line, input.state.runs, revisions))
    }));
  const documentRevisionIds = Array.from(
    new Set([
      ...basisPositionSnapshot.sources.map((source) => source.documentRevisionId),
      ...visibleSupplierOptions.flatMap((option) =>
        option.lines.flatMap((line) =>
          line.sources.map((source) => source.documentRevisionId)
        )
      )
    ])
  );
  return {
    capturedAt: input.capturedAt,
    basisPosition: basisPositionSnapshot,
    basisContext,
    supplierOptionId: input.option?.id ?? null,
    supplierDocumentId: input.option?.supplierDocumentId ?? null,
    selectedLines,
    visibleSupplierOptions,
    supplierContextLines,
    includedRequiredComponents,
    excludedOptionalComponents,
    continuationPages,
    documentRevisionIds
  };
}

export function validateDecisionEvidence(snapshot: {
  basisPosition: { sources: unknown[] };
  selectedLines: Array<{ sources: unknown[] }>;
}): DecisionValidationResult {
  const errors: string[] = [];
  if (snapshot.basisPosition.sources.length === 0) {
    errors.push("BASIS_EVIDENCE_REQUIRED");
  }
  if (
    snapshot.selectedLines.length === 0 ||
    snapshot.selectedLines.some((line) => line.sources.length === 0)
  ) {
    errors.push("SUPPLIER_EVIDENCE_REQUIRED");
  }
  return { valid: errors.length === 0, errors };
}

export function createAutomaticSupplierDecision(input: {
  id: string;
  state: PilotState;
  basis: BasisPosition;
  option: SupplierOption;
  decidedBy: string;
  decidedAt: string;
}): SupplierDecisionV2 {
  const evidenceSnapshot = buildDecisionEvidenceSnapshot({
    state: input.state,
    basis: input.basis,
    option: input.option,
    capturedAt: input.decidedAt
  });
  const evidenceValidation = validateDecisionEvidence(evidenceSnapshot);
  if (!evidenceValidation.valid) {
    throw new Error(evidenceValidation.errors.join(", "));
  }
  return SupplierDecisionV2Schema.parse({
    id: input.id,
    basisPositionId: input.basis.id,
    supplierDocumentId: input.option.supplierDocumentId,
    status: "SELECTED",
    selectedSupplierOptionId: input.option.id,
    selectedSupplierLineIds: evidenceSnapshot.selectedLines.map(
      (line) => line.lineId
    ),
    reasonCodes: [],
    comment: "AUTO_SELECTED_LOWEST_PRICE",
    evidenceSnapshot,
    documentRevisionIds: evidenceSnapshot.documentRevisionIds,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
    catalogVersion: CURRENT_DECISION_REASON_CATALOG.version,
    previousDecisionId: null,
    decisionType: "AUTOMATIC_LOWEST_PRICE"
  });
}
