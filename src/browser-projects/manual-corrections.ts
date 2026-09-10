import type { BasisPosition, EvidenceReference, OfferLine } from "@/domain/contracts";
import {
  buildBasisRecommendations,
  buildSupplierOptions,
  proposeMatches,
  type OfferLineContext
} from "@/domain/matching";
import { buildProjectCompletenessInvariant } from "@/domain/project-invariant";
import { buildProjectReviewPositions } from "@/domain/project-review";
import type { BrowserAnalysisSnapshot, BrowserDocumentRecord } from "@/browser-projects/types";

export type ManualCorrectionEntityKind = "BASIS_POSITION" | "SUPPLIER_LINE";

export type ManualSourceCorrection = {
  pageNumber: number;
  region: { x: number; y: number; width: number; height: number } | null;
};

export type ManualCorrectionPatch = {
  positionNumber?: string;
  shortLabel?: string | null;
  description?: string;
  articleNumber?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  source?: ManualSourceCorrection;
};

export type BrowserManualCorrectionCommand =
  | {
      action: "CORRECT_FIELDS";
      target: {
        kind: ManualCorrectionEntityKind;
        entityId: string;
        evidenceId?: string;
      };
      patch: ManualCorrectionPatch;
    }
  | {
      action: "ADD_BASIS_POSITION";
      value: {
        documentId: string;
        positionNumber: string;
        shortLabel?: string;
        description: string;
        quantity?: number | null;
        unit?: string | null;
        source?: ManualSourceCorrection;
      };
    }
  | {
      action: "ADD_SUPPLIER_LINE";
      value: {
        documentId: string;
        positionNumber: string;
        supplierPositionNumber?: string | null;
        shortLabel?: string;
        description: string;
        articleNumber?: string | null;
        quantity?: number | null;
        unit?: string | null;
        unitPrice?: number | null;
        totalPrice?: number | null;
        source?: ManualSourceCorrection;
      };
    };

export type BrowserManualCorrectionAudit = {
  id: string;
  operatorId: string;
  operatorLabel: string;
  reasonCode: "OCR_CORRECTION" | "SOURCE_REGION_CORRECTION";
  comment: string;
  createdAt: string;
};

export type BrowserManualCorrectionRecord = BrowserManualCorrectionAudit & {
  projectId: string;
  baseAnalysisVersionId: string;
  revision: number;
  entityKind: ManualCorrectionEntityKind;
  entityId: string;
  command: BrowserManualCorrectionCommand;
  previousValues: Record<string, unknown>;
  supersedesIds: string[];
};

export type ManualCorrectionEvidenceState = "MISSING" | "VERIFIED_VISUAL";

export type ManualCorrectionMaterialization = {
  snapshot: BrowserAnalysisSnapshot;
  correctionRevision: number;
  appliedCorrectionIds: string[];
  displayLabels: Record<string, string>;
  evidenceStatusByEntity: Record<string, ManualCorrectionEvidenceState>;
  staleMatchReviewIds: string[];
};

type EntityLookup =
  | { kind: "BASIS_POSITION"; value: BasisPosition; documentId: string }
  | { kind: "SUPPLIER_LINE"; value: OfferLine; documentId: string };

const MAX_DESCRIPTION_LENGTH = 64_000;
const MAX_SHORT_LABEL_LENGTH = 200;
const MAX_ARTICLE_LENGTH = 200;
const MAX_UNIT_LENGTH = 32;
const MAX_NUMERIC_VALUE = 1_000_000_000_000;

const allowedPatchFields: Record<
  ManualCorrectionEntityKind,
  ReadonlySet<keyof ManualCorrectionPatch>
> = {
  BASIS_POSITION: new Set([
    "positionNumber",
    "shortLabel",
    "description",
    "quantity",
    "unit",
    "source"
  ]),
  SUPPLIER_LINE: new Set([
    "positionNumber",
    "shortLabel",
    "description",
    "articleNumber",
    "quantity",
    "unit",
    "unitPrice",
    "totalPrice",
    "source"
  ])
};

function fail(code: string): never {
  throw new Error(code);
}

function validateAudit(audit: BrowserManualCorrectionAudit): void {
  if (
    typeof audit.id !== "string" ||
    !audit.id.trim() ||
    audit.id.length > 300 ||
    typeof audit.operatorId !== "string" ||
    !audit.operatorId.trim() ||
    audit.operatorId.length > 300 ||
    typeof audit.operatorLabel !== "string" ||
    !audit.operatorLabel.trim() ||
    audit.operatorLabel.length > 300 ||
    !["OCR_CORRECTION", "SOURCE_REGION_CORRECTION"].includes(audit.reasonCode) ||
    typeof audit.comment !== "string" ||
    audit.comment.length > 2_000 ||
    typeof audit.createdAt !== "string" ||
    !Number.isFinite(Date.parse(audit.createdAt))
  ) {
    fail("MANUAL_CORRECTION_AUDIT_INVALID");
  }
}

function entityKey(kind: ManualCorrectionEntityKind, entityId: string): string {
  return `${kind}:${entityId}`;
}

function normalizedPositionNumber(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[.,;:]+$/u, "");
}

function validatePositionNumber(value: string): string {
  const normalized = normalizedPositionNumber(value);
  if (!/^\d+(?:\.\d+){2,}$/u.test(normalized)) {
    fail("MANUAL_CORRECTION_VALUE_INVALID");
  }
  return normalized;
}

function nonEmptyString(value: unknown, maximum: number): string {
  if (typeof value !== "string") fail("MANUAL_CORRECTION_VALUE_INVALID");
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > maximum) {
    fail("MANUAL_CORRECTION_VALUE_INVALID");
  }
  return normalized;
}

function optionalString(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  return nonEmptyString(value, maximum);
}

function optionalNumber(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_NUMERIC_VALUE
  ) {
    fail("MANUAL_CORRECTION_VALUE_INVALID");
  }
  return value;
}

function validateSource(
  source: ManualSourceCorrection,
  document: BrowserDocumentRecord
): ManualSourceCorrection {
  if (
    !Number.isInteger(source.pageNumber) ||
    source.pageNumber < 1 ||
    source.pageNumber > document.pageCount
  ) {
    fail("MANUAL_CORRECTION_SOURCE_INVALID");
  }
  if (source.region === null) {
    return { pageNumber: source.pageNumber, region: null };
  }
  const { x, y, width, height } = source.region;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 ||
    y + height > 1
  ) {
    fail("MANUAL_CORRECTION_SOURCE_INVALID");
  }
  return {
    pageNumber: source.pageNumber,
    region: { x, y, width, height }
  };
}

function documentFor(
  documents: readonly BrowserDocumentRecord[],
  projectId: string,
  documentId: string
): BrowserDocumentRecord {
  const document = documents.find(
    (candidate) => candidate.projectId === projectId && candidate.documentId === documentId
  );
  if (!document) fail("MANUAL_CORRECTION_DOCUMENT_NOT_FOUND");
  return document;
}

function normalizePatch(
  patch: ManualCorrectionPatch,
  kind: ManualCorrectionEntityKind,
  document: BrowserDocumentRecord
): ManualCorrectionPatch {
  const fields = Object.keys(patch) as Array<keyof ManualCorrectionPatch>;
  if (fields.length === 0) fail("MANUAL_CORRECTION_VALUE_INVALID");
  if (fields.some((field) => !allowedPatchFields[kind].has(field))) {
    fail("MANUAL_CORRECTION_FIELD_NOT_ALLOWED");
  }
  const normalized: ManualCorrectionPatch = {};
  if ("positionNumber" in patch) {
    if (typeof patch.positionNumber !== "string") {
      fail("MANUAL_CORRECTION_VALUE_INVALID");
    }
    normalized.positionNumber = validatePositionNumber(patch.positionNumber);
  }
  if ("shortLabel" in patch) {
    normalized.shortLabel =
      patch.shortLabel === null ? null : nonEmptyString(patch.shortLabel, MAX_SHORT_LABEL_LENGTH);
  }
  if ("description" in patch) {
    normalized.description = nonEmptyString(patch.description, MAX_DESCRIPTION_LENGTH);
  }
  if ("articleNumber" in patch) {
    normalized.articleNumber = optionalString(patch.articleNumber, MAX_ARTICLE_LENGTH);
  }
  if ("quantity" in patch) normalized.quantity = optionalNumber(patch.quantity);
  if ("unit" in patch) {
    normalized.unit = optionalString(patch.unit, MAX_UNIT_LENGTH);
  }
  if ("unitPrice" in patch) {
    normalized.unitPrice = optionalNumber(patch.unitPrice);
  }
  if ("totalPrice" in patch) {
    normalized.totalPrice = optionalNumber(patch.totalPrice);
  }
  if ("source" in patch) {
    if (!patch.source || typeof patch.source !== "object") {
      fail("MANUAL_CORRECTION_SOURCE_INVALID");
    }
    normalized.source = validateSource(patch.source, document);
  }
  return normalized;
}

function findBasis(snapshot: BrowserAnalysisSnapshot, entityId: string): BasisPosition | undefined {
  return snapshot.pilot.analysis?.basisPositions.find((position) => position.id === entityId);
}

function findSupplier(
  snapshot: BrowserAnalysisSnapshot,
  entityId: string
): { line: OfferLine; documentId: string } | undefined {
  for (const run of snapshot.pilot.runs) {
    const line = run.result.envelope.extraction.offerGroups
      .flatMap((group) => group.lines)
      .find((candidate) => candidate.id === entityId);
    if (line) return { line, documentId: run.document.id };
  }
  return undefined;
}

function findEntity(
  snapshot: BrowserAnalysisSnapshot,
  kind: ManualCorrectionEntityKind,
  entityId: string
): EntityLookup | undefined {
  if (kind === "BASIS_POSITION") {
    const value = findBasis(snapshot, entityId);
    return value ? { kind, value, documentId: value.documentId } : undefined;
  }
  const supplier = findSupplier(snapshot, entityId);
  return supplier ? { kind, value: supplier.line, documentId: supplier.documentId } : undefined;
}

function evidenceForTarget(
  entity: EntityLookup,
  evidenceId?: string
): EvidenceReference | undefined {
  const evidence =
    entity.kind === "BASIS_POSITION"
      ? [...entity.value.evidence, ...(entity.value.continuationEvidence ?? [])]
      : entity.value.evidence;
  if (evidenceId) {
    const selected = evidence.find((candidate) => candidate.id === evidenceId);
    if (!selected) fail("MANUAL_CORRECTION_EVIDENCE_NOT_FOUND");
    return selected;
  }
  if (evidence.length > 1) fail("MANUAL_CORRECTION_EVIDENCE_AMBIGUOUS");
  return evidence[0];
}

function patchKeys(command: BrowserManualCorrectionCommand): string[] {
  return command.action === "CORRECT_FIELDS" ? Object.keys(command.patch) : [];
}

function recordTargetsSameEntity(
  record: BrowserManualCorrectionRecord,
  kind: ManualCorrectionEntityKind,
  id: string
): boolean {
  return record.entityKind === kind && record.entityId === id;
}

function latestSupersededIds(
  history: readonly BrowserManualCorrectionRecord[],
  kind: ManualCorrectionEntityKind,
  id: string,
  keys: readonly string[]
): string[] {
  const remaining = new Set(keys);
  const superseded: string[] = [];
  for (const record of [...history].sort((a, b) => b.revision - a.revision)) {
    if (!recordTargetsSameEntity(record, kind, id)) continue;
    const overlaps = patchKeys(record.command).some((key) => remaining.has(key));
    if (!overlaps) continue;
    superseded.push(record.id);
    for (const key of patchKeys(record.command)) remaining.delete(key);
    if (remaining.size === 0) break;
  }
  return superseded;
}

function previousValues(
  entity: EntityLookup,
  command: Extract<BrowserManualCorrectionCommand, { action: "CORRECT_FIELDS" }>,
  displayLabels: Readonly<Record<string, string>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const targetKey = entityKey(entity.kind, command.target.entityId);
  const line = entity.value;
  for (const field of Object.keys(command.patch) as Array<keyof ManualCorrectionPatch>) {
    switch (field) {
      case "shortLabel":
        result.shortLabel = displayLabels[targetKey] ?? null;
        break;
      case "description":
      case "quantity":
      case "unit":
        result[field] = line[field];
        break;
      case "positionNumber":
        result.positionNumber =
          entity.kind === "BASIS_POSITION"
            ? entity.value.positionNumber
            : entity.value.sourcePositionNumber;
        break;
      case "articleNumber":
        result.articleNumber = entity.kind === "SUPPLIER_LINE" ? entity.value.articleNumber : null;
        break;
      case "unitPrice":
        result.unitPrice =
          entity.kind === "SUPPLIER_LINE" ? entity.value.interpretedUnitPrice : null;
        break;
      case "totalPrice":
        result.totalPrice =
          entity.kind === "SUPPLIER_LINE" ? entity.value.interpretedTotalPrice : null;
        break;
      case "source": {
        const evidence = evidenceForTarget(entity, command.target.evidenceId);
        result.source = evidence
          ? {
              pageNumber: evidence.pageNumber,
              region:
                evidence.region.width > 0 && evidence.region.height > 0
                  ? structuredClone(evidence.region)
                  : null,
              status: evidence.status
            }
          : null;
        break;
      }
    }
  }
  return result;
}

function normalizeCommand(
  snapshot: BrowserAnalysisSnapshot,
  documents: readonly BrowserDocumentRecord[],
  effective: ManualCorrectionMaterialization,
  command: BrowserManualCorrectionCommand,
  correctionId: string
): {
  command: BrowserManualCorrectionCommand;
  entityKind: ManualCorrectionEntityKind;
  entityId: string;
  previousValues: Record<string, unknown>;
} {
  if (command.action === "CORRECT_FIELDS") {
    const entity = findEntity(effective.snapshot, command.target.kind, command.target.entityId);
    if (!entity) fail("MANUAL_CORRECTION_TARGET_NOT_FOUND");
    const document = documentFor(documents, snapshot.projectId, entity.documentId);
    if (command.target.evidenceId) {
      evidenceForTarget(entity, command.target.evidenceId);
    }
    const normalizedPatch = normalizePatch(command.patch, command.target.kind, document);
    if (
      command.target.kind === "BASIS_POSITION" &&
      normalizedPatch.positionNumber !== undefined &&
      effective.snapshot.pilot.analysis?.basisPositions.some(
        (position) =>
          position.id !== command.target.entityId &&
          normalizedPositionNumber(position.positionNumber) === normalizedPatch.positionNumber
      )
    ) {
      fail("MANUAL_CORRECTION_POSITION_ALREADY_EXISTS");
    }
    const normalizedCommand: BrowserManualCorrectionCommand = {
      action: "CORRECT_FIELDS",
      target: {
        kind: command.target.kind,
        entityId: command.target.entityId,
        ...(command.target.evidenceId ? { evidenceId: command.target.evidenceId } : {})
      },
      patch: normalizedPatch
    };
    return {
      command: normalizedCommand,
      entityKind: command.target.kind,
      entityId: command.target.entityId,
      previousValues: previousValues(entity, normalizedCommand, effective.displayLabels)
    };
  }

  const value = command.value;
  const document = documentFor(documents, snapshot.projectId, value.documentId);
  const positionNumber = validatePositionNumber(value.positionNumber);
  const description = nonEmptyString(value.description, MAX_DESCRIPTION_LENGTH);
  const shortLabel =
    value.shortLabel === undefined
      ? undefined
      : nonEmptyString(value.shortLabel, MAX_SHORT_LABEL_LENGTH);
  const source = value.source ? validateSource(value.source, document) : undefined;

  if (command.action === "ADD_BASIS_POSITION") {
    if (document.documentType !== "BASIS_LV") {
      fail("MANUAL_CORRECTION_DOCUMENT_TYPE_INVALID");
    }
    if (
      effective.snapshot.pilot.analysis?.basisPositions.some(
        (position) => normalizedPositionNumber(position.positionNumber) === positionNumber
      )
    ) {
      fail("MANUAL_CORRECTION_POSITION_ALREADY_EXISTS");
    }
    const entityId = `manual-basis:${correctionId}`;
    return {
      command: {
        action: "ADD_BASIS_POSITION",
        value: {
          documentId: document.documentId,
          positionNumber,
          ...(shortLabel ? { shortLabel } : {}),
          description,
          quantity: value.quantity === undefined ? null : optionalNumber(value.quantity),
          unit: value.unit === undefined ? null : optionalString(value.unit, MAX_UNIT_LENGTH),
          ...(source ? { source } : {})
        }
      },
      entityKind: "BASIS_POSITION",
      entityId,
      previousValues: {}
    };
  }

  if (!["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(document.documentType)) {
    fail("MANUAL_CORRECTION_DOCUMENT_TYPE_INVALID");
  }
  const supplierValue = command.value;
  const entityId = `manual-supplier-line:${correctionId}`;
  return {
    command: {
      action: "ADD_SUPPLIER_LINE",
      value: {
        documentId: document.documentId,
        positionNumber,
        supplierPositionNumber:
          supplierValue.supplierPositionNumber === undefined
            ? null
            : optionalString(supplierValue.supplierPositionNumber, MAX_ARTICLE_LENGTH),
        ...(shortLabel ? { shortLabel } : {}),
        description,
        articleNumber:
          supplierValue.articleNumber === undefined
            ? null
            : optionalString(supplierValue.articleNumber, MAX_ARTICLE_LENGTH),
        quantity:
          supplierValue.quantity === undefined ? null : optionalNumber(supplierValue.quantity),
        unit:
          supplierValue.unit === undefined
            ? null
            : optionalString(supplierValue.unit, MAX_UNIT_LENGTH),
        unitPrice:
          supplierValue.unitPrice === undefined ? null : optionalNumber(supplierValue.unitPrice),
        totalPrice:
          supplierValue.totalPrice === undefined ? null : optionalNumber(supplierValue.totalPrice),
        ...(source ? { source } : {})
      }
    },
    entityKind: "SUPPLIER_LINE",
    entityId,
    previousValues: {}
  };
}

export function appendManualCorrection(input: {
  snapshot: BrowserAnalysisSnapshot;
  documents: readonly BrowserDocumentRecord[];
  history: readonly BrowserManualCorrectionRecord[];
  expectedRevision: number;
  command: BrowserManualCorrectionCommand;
  audit: BrowserManualCorrectionAudit;
}): {
  record: BrowserManualCorrectionRecord;
  history: BrowserManualCorrectionRecord[];
} {
  const currentRevision = input.history.reduce(
    (maximum, record) => Math.max(maximum, record.revision),
    0
  );
  if (input.expectedRevision !== currentRevision) {
    fail("MANUAL_CORRECTION_REVISION_CONFLICT");
  }
  if (!input.audit.id || input.history.some((record) => record.id === input.audit.id)) {
    fail("MANUAL_CORRECTION_ID_CONFLICT");
  }
  validateAudit(input.audit);
  const effective = materializeManualCorrections({
    snapshot: input.snapshot,
    documents: input.documents,
    history: input.history
  });
  const normalized = normalizeCommand(
    input.snapshot,
    input.documents,
    effective,
    input.command,
    input.audit.id
  );
  const supersedesIds = latestSupersededIds(
    input.history,
    normalized.entityKind,
    normalized.entityId,
    patchKeys(normalized.command)
  );
  const record: BrowserManualCorrectionRecord = {
    ...structuredClone(input.audit),
    projectId: input.snapshot.projectId,
    baseAnalysisVersionId: input.snapshot.analysisVersionId,
    revision: currentRevision + 1,
    entityKind: normalized.entityKind,
    entityId: normalized.entityId,
    command: normalized.command,
    previousValues: normalized.previousValues,
    supersedesIds
  };
  return {
    record,
    history: [...input.history.map((item) => structuredClone(item)), record]
  };
}

function manualEvidence(
  record: BrowserManualCorrectionRecord,
  documentId: string,
  source: ManualSourceCorrection,
  sourceText = ""
): EvidenceReference {
  return {
    id: `manual-evidence:${record.id}`,
    documentId,
    pageNumber: source.pageNumber,
    textItemIds: source.region ? [`manual-region:${record.id}`] : [],
    sourceText,
    region: source.region ?? { x: 0, y: 0, width: 0, height: 0 },
    cropPath: null,
    status: source.region ? "VERIFIED_VISUAL" : "MISSING"
  };
}

function replaceEvidence(
  evidence: readonly EvidenceReference[],
  record: BrowserManualCorrectionRecord,
  documentId: string,
  source: ManualSourceCorrection,
  evidenceId?: string
): EvidenceReference[] {
  if (evidence.length === 0) {
    return [manualEvidence(record, documentId, source)];
  }
  const selectedId = evidenceId ?? (evidence.length === 1 ? evidence[0].id : null);
  if (!selectedId) fail("MANUAL_CORRECTION_EVIDENCE_AMBIGUOUS");
  let replaced = false;
  const result = evidence.map((item) => {
    if (item.id !== selectedId) return item;
    replaced = true;
    return {
      ...item,
      pageNumber: source.pageNumber,
      region: source.region ?? { x: 0, y: 0, width: 0, height: 0 },
      status: source.region ? ("VERIFIED_VISUAL" as const) : ("MISSING" as const)
    };
  });
  if (!replaced) fail("MANUAL_CORRECTION_EVIDENCE_NOT_FOUND");
  return result;
}

function patchBasis(
  position: BasisPosition,
  record: BrowserManualCorrectionRecord,
  command: Extract<BrowserManualCorrectionCommand, { action: "CORRECT_FIELDS" }>
): BasisPosition {
  const patch = command.patch;
  let evidence = position.evidence;
  let continuationEvidence = position.continuationEvidence;
  if (patch.source) {
    const primaryHasTarget =
      !command.target.evidenceId || evidence.some((item) => item.id === command.target.evidenceId);
    if (primaryHasTarget) {
      evidence = replaceEvidence(
        evidence,
        record,
        position.documentId,
        patch.source,
        command.target.evidenceId
      );
    } else {
      continuationEvidence = replaceEvidence(
        continuationEvidence ?? [],
        record,
        position.documentId,
        patch.source,
        command.target.evidenceId
      );
    }
  }
  return {
    ...position,
    ...(patch.positionNumber !== undefined ? { positionNumber: patch.positionNumber } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
    ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
    evidence,
    ...(continuationEvidence ? { continuationEvidence } : {}),
    verificationStatus: "HUMAN_CORRECTED"
  };
}

function patchSupplier(
  line: OfferLine,
  record: BrowserManualCorrectionRecord,
  command: Extract<BrowserManualCorrectionCommand, { action: "CORRECT_FIELDS" }>,
  documentId: string
): OfferLine {
  const patch = command.patch;
  const lockedFields = new Set(line.lockedFields);
  if (patch.description !== undefined) lockedFields.add("description");
  if (patch.positionNumber !== undefined) lockedFields.add("sourcePositionNumber");
  if (patch.articleNumber !== undefined) lockedFields.add("articleNumber");
  if (patch.quantity !== undefined) lockedFields.add("quantity");
  if (patch.unit !== undefined) lockedFields.add("unit");
  if (patch.unitPrice !== undefined) lockedFields.add("interpretedUnitPrice");
  if (patch.totalPrice !== undefined) lockedFields.add("interpretedTotalPrice");
  if (patch.source !== undefined) lockedFields.add("evidence");
  const interpretedUnitPrice =
    patch.unitPrice !== undefined ? patch.unitPrice : line.interpretedUnitPrice;
  const interpretedTotalPrice =
    patch.totalPrice !== undefined ? patch.totalPrice : line.interpretedTotalPrice;
  return {
    ...line,
    ...(patch.positionNumber !== undefined ? { sourcePositionNumber: patch.positionNumber } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.articleNumber !== undefined ? { articleNumber: patch.articleNumber } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
    ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
    interpretedUnitPrice,
    interpretedTotalPrice,
    evidence: patch.source
      ? replaceEvidence(line.evidence, record, documentId, patch.source, command.target.evidenceId)
      : line.evidence,
    verificationStatus: "HUMAN_CORRECTED",
    lockedFields: [...lockedFields],
    completenessStatus:
      interpretedUnitPrice !== null || interpretedTotalPrice !== null
        ? "PRICED_OFFER"
        : "OFFER_WITHOUT_PRICE"
  };
}

function evidenceState(source: ManualSourceCorrection | undefined): ManualCorrectionEvidenceState {
  return source?.region ? "VERIFIED_VISUAL" : "MISSING";
}

function addBasis(
  snapshot: BrowserAnalysisSnapshot,
  record: BrowserManualCorrectionRecord,
  command: Extract<BrowserManualCorrectionCommand, { action: "ADD_BASIS_POSITION" }>
): BasisPosition {
  const value = command.value;
  const position: BasisPosition = {
    id: record.entityId,
    documentId: value.documentId,
    parentId: null,
    positionNumber: value.positionNumber,
    description: value.description,
    quantity: value.quantity ?? null,
    unit: value.unit ?? null,
    technicalAttributes: [],
    manufacturerRequirements: [],
    requiredScope: [],
    notes: [],
    optional: false,
    alternative: false,
    heading: false,
    evidence: value.source ? [manualEvidence(record, value.documentId, value.source)] : [],
    hierarchyPath: ["Manuell ergänzt"],
    continuationEvidence: [],
    verificationStatus: "HUMAN_CORRECTED"
  };
  const run = snapshot.pilot.runs.find((candidate) => candidate.document.id === value.documentId);
  if (!run) fail("MANUAL_CORRECTION_DOCUMENT_NOT_FOUND");
  run.result.envelope.extraction.basisPositions.push(structuredClone(position));
  snapshot.pilot.analysis?.basisPositions.push(position);
  return position;
}

function addSupplier(
  snapshot: BrowserAnalysisSnapshot,
  record: BrowserManualCorrectionRecord,
  command: Extract<BrowserManualCorrectionCommand, { action: "ADD_SUPPLIER_LINE" }>
): OfferLine {
  const value = command.value;
  const line: OfferLine = {
    id: record.entityId,
    sourcePositionNumber: value.positionNumber,
    supplierPositionNumber: value.supplierPositionNumber ?? null,
    description: value.description,
    manufacturer: null,
    articleNumber: value.articleNumber ?? null,
    quantity: value.quantity ?? null,
    unit: value.unit ?? null,
    priceBasis: 1,
    currency: "EUR",
    moneyCandidates: [],
    interpretedUnitPrice: value.unitPrice ?? null,
    interpretedTotalPrice: value.totalPrice ?? null,
    role: "PRIMARY",
    groupId: `manual-group:${record.id}`,
    continuation: false,
    evidence: value.source ? [manualEvidence(record, value.documentId, value.source)] : [],
    verificationStatus: "HUMAN_CORRECTED",
    lockedFields: [
      "description",
      ...(value.articleNumber !== undefined ? ["articleNumber"] : []),
      ...(value.quantity !== undefined ? ["quantity"] : []),
      ...(value.unit !== undefined ? ["unit"] : []),
      ...(value.unitPrice !== undefined ? ["interpretedUnitPrice"] : []),
      ...(value.totalPrice !== undefined ? ["interpretedTotalPrice"] : []),
      ...(value.source !== undefined ? ["evidence"] : [])
    ],
    completenessStatus:
      value.unitPrice !== null || value.totalPrice !== null ? "PRICED_OFFER" : "OFFER_WITHOUT_PRICE"
  };
  const run = snapshot.pilot.runs.find((candidate) => candidate.document.id === value.documentId);
  if (!run) fail("MANUAL_CORRECTION_DOCUMENT_NOT_FOUND");
  run.result.envelope.extraction.offerGroups.push({ lines: [line] });
  return line;
}

function applyRecord(
  snapshot: BrowserAnalysisSnapshot,
  record: BrowserManualCorrectionRecord,
  displayLabels: Record<string, string>,
  evidenceStatusByEntity: Record<string, ManualCorrectionEvidenceState>
): void {
  const command = record.command;
  const key = entityKey(record.entityKind, record.entityId);
  if (command.action === "ADD_BASIS_POSITION") {
    addBasis(snapshot, record, command);
    if (command.value.shortLabel) displayLabels[key] = command.value.shortLabel;
    evidenceStatusByEntity[key] = evidenceState(command.value.source);
    return;
  }
  if (command.action === "ADD_SUPPLIER_LINE") {
    addSupplier(snapshot, record, command);
    if (command.value.shortLabel) displayLabels[key] = command.value.shortLabel;
    evidenceStatusByEntity[key] = evidenceState(command.value.source);
    return;
  }

  if (command.patch.shortLabel !== undefined) {
    if (command.patch.shortLabel === null) delete displayLabels[key];
    else displayLabels[key] = command.patch.shortLabel;
  }
  if (command.target.kind === "BASIS_POSITION") {
    const analysis = snapshot.pilot.analysis;
    const index = analysis?.basisPositions.findIndex(
      (position) => position.id === command.target.entityId
    );
    if (analysis && index !== undefined && index >= 0) {
      analysis.basisPositions[index] = patchBasis(analysis.basisPositions[index], record, command);
    } else {
      fail("MANUAL_CORRECTION_TARGET_NOT_FOUND");
    }
    for (const run of snapshot.pilot.runs) {
      run.result.envelope.extraction.basisPositions =
        run.result.envelope.extraction.basisPositions.map((position) =>
          position.id === command.target.entityId ? patchBasis(position, record, command) : position
        );
    }
  } else {
    let found = false;
    for (const run of snapshot.pilot.runs) {
      run.result.envelope.extraction.offerGroups = run.result.envelope.extraction.offerGroups.map(
        (group) => ({
          ...group,
          lines: group.lines.map((line) => {
            if (line.id !== command.target.entityId) return line;
            found = true;
            return patchSupplier(line, record, command, run.document.id);
          })
        })
      );
    }
    if (!found) fail("MANUAL_CORRECTION_TARGET_NOT_FOUND");
  }
  if (command.patch.source) {
    evidenceStatusByEntity[key] = evidenceState(command.patch.source);
  }
}

function rebuildDerivedAnalysis(snapshot: BrowserAnalysisSnapshot, generatedAt: string): void {
  const analysis = snapshot.pilot.analysis;
  if (!analysis) fail("MANUAL_CORRECTION_ANALYSIS_REQUIRED");
  const basisPositions = analysis.basisPositions;
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
        line:
          line.lockedFields.includes("interpretedTotalPrice") && line.interpretedTotalPrice === null
            ? {
                ...line,
                moneyCandidates: line.moneyCandidates.filter(
                  (candidate) => candidate.kind !== "TOTAL_PRICE"
                )
              }
            : line
      }))
    )
  );
  const matchLinks = proposeMatches(basisPositions, offerContexts);
  const activeSupplierDocumentIds = new Set(
    analysis.supplierDocuments.map((document) => document.id)
  );
  const supplierOptions = buildSupplierOptions({
    basisPositions,
    offers: offerContexts,
    links: matchLinks,
    fullyProcessedSupplierDocumentIds: activeSupplierDocumentIds
  });
  const previousCoverageByBasisId = Object.fromEntries(
    snapshot.pilot.projectReview.positions.map((position) => [position.basis.id, position.coverage])
  );
  const allRelevantOffersProcessed =
    snapshot.pilot.projectReview.coverage.allRelevantOffersProcessed;
  const projectContextConfirmed = snapshot.pilot.projectReview.coverage.projectContextConfirmed;
  const positions = buildProjectReviewPositions({
    basisPositions,
    options: supplierOptions,
    coverage: {
      activeSupplierDocumentIds,
      allRelevantOffersProcessed,
      supplierCoverageSufficient:
        allRelevantOffersProcessed &&
        snapshot.pilot.projectReview.coverage.missingSupplierDocuments.length === 0,
      projectContextConfirmed,
      disciplineContextConfirmed: true,
      materialUncertainty: false
    },
    coverageByBasisId: previousCoverageByBasisId,
    decisions: snapshot.pilot.supplierDecisions,
    calculatedAt: generatedAt
  });
  const invariantResult = buildProjectCompletenessInvariant({
    basisPositions,
    reviewPositions: positions,
    supplierOptions,
    decisions: snapshot.pilot.supplierDecisions
  });
  const { statusCounts: _statusCounts, ...invariant } = invariantResult;
  void _statusCounts;
  snapshot.pilot.analysis = {
    ...analysis,
    basisPositions,
    basisPositionFrom: basisPositions[0]?.positionNumber ?? "",
    basisPositionTo: basisPositions.at(-1)?.positionNumber ?? "",
    matchLinks,
    supplierOptions,
    recommendations: buildBasisRecommendations(basisPositions, supplierOptions),
    generatedAt
  };
  snapshot.pilot.projectReview = {
    ...snapshot.pilot.projectReview,
    positions,
    invariant
  };
  snapshot.summary = {
    ...snapshot.summary,
    basisPositions: basisPositions.filter((position) => !position.heading).length,
    positionsWithOffers: positions.filter((position) =>
      position.options.some((option) => option.offerAvailability === "PRESENT")
    ).length,
    positionsWithoutOffers: positions.filter(
      (position) => !position.options.some((option) => option.offerAvailability === "PRESENT")
    ).length
  };
}

function affectedMatchReviewIds(
  snapshot: BrowserAnalysisSnapshot,
  history: readonly BrowserManualCorrectionRecord[]
): string[] {
  if (history.length === 0) return [];
  const oldLinks = snapshot.pilot.analysis?.matchLinks ?? [];
  const affectedPositions = new Set<string>();
  for (const record of history) {
    if (record.entityKind === "BASIS_POSITION") {
      affectedPositions.add(record.entityId);
      continue;
    }
    for (const link of oldLinks) {
      if (link.offerLineIds.includes(record.entityId)) {
        link.basisPositionIds.forEach((id) => affectedPositions.add(id));
      }
    }
  }
  return snapshot.matchReviews
    .filter((review) => affectedPositions.has(review.positionId))
    .map((review) => review.matchLinkId);
}

export function materializeManualCorrections(input: {
  snapshot: BrowserAnalysisSnapshot;
  documents: readonly BrowserDocumentRecord[];
  history: readonly BrowserManualCorrectionRecord[];
}): ManualCorrectionMaterialization {
  if (!input.snapshot.pilot.analysis) {
    fail("MANUAL_CORRECTION_ANALYSIS_REQUIRED");
  }
  const ordered = [...input.history].sort((left, right) => left.revision - right.revision);
  const ids = new Set<string>();
  for (const [index, record] of ordered.entries()) {
    if (
      record.projectId !== input.snapshot.projectId ||
      record.baseAnalysisVersionId !== input.snapshot.analysisVersionId
    ) {
      fail("MANUAL_CORRECTION_ANALYSIS_MISMATCH");
    }
    if (record.revision !== index + 1) {
      fail("MANUAL_CORRECTION_HISTORY_INVALID");
    }
    if (ids.has(record.id)) fail("MANUAL_CORRECTION_HISTORY_INVALID");
    validateAudit(record);
    ids.add(record.id);
  }
  const snapshot = structuredClone(input.snapshot);
  const displayLabels: Record<string, string> = {};
  const evidenceStatusByEntity: Record<string, ManualCorrectionEvidenceState> = {};
  const replayed: BrowserManualCorrectionRecord[] = [];
  for (const record of ordered) {
    const normalized = normalizeCommand(
      input.snapshot,
      input.documents,
      {
        snapshot,
        correctionRevision: replayed.at(-1)?.revision ?? 0,
        appliedCorrectionIds: replayed.map((item) => item.id),
        displayLabels,
        evidenceStatusByEntity,
        staleMatchReviewIds: []
      },
      record.command,
      record.id
    );
    if (
      normalized.entityKind !== record.entityKind ||
      normalized.entityId !== record.entityId ||
      JSON.stringify(normalized.previousValues) !== JSON.stringify(record.previousValues)
    ) {
      fail("MANUAL_CORRECTION_HISTORY_INVALID");
    }
    const expectedSupersedes = latestSupersededIds(
      replayed,
      normalized.entityKind,
      normalized.entityId,
      patchKeys(normalized.command)
    );
    if (JSON.stringify(expectedSupersedes) !== JSON.stringify(record.supersedesIds)) {
      fail("MANUAL_CORRECTION_HISTORY_INVALID");
    }
    const validatedRecord = { ...record, command: normalized.command };
    applyRecord(snapshot, validatedRecord, displayLabels, evidenceStatusByEntity);
    replayed.push(validatedRecord);
  }
  if (ordered.length > 0) {
    rebuildDerivedAnalysis(snapshot, ordered.at(-1)!.createdAt);
  }
  return {
    snapshot,
    correctionRevision: ordered.at(-1)?.revision ?? 0,
    appliedCorrectionIds: ordered.map((record) => record.id),
    displayLabels,
    evidenceStatusByEntity,
    staleMatchReviewIds: affectedMatchReviewIds(input.snapshot, ordered)
  };
}
