import { z } from "zod";

export const DocumentTypeSchema = z.enum([
  "BASIS_LV",
  "SUPPLIER_OFFER",
  "FINAL_DECISION",
  "HISTORICAL_CALCULATION",
  "MANUFACTURER_CALCULATION",
  "MANUAL_PRICE_TABLE",
  "UNKNOWN"
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DisciplineSchema = z.enum(["SANITAER", "HEIZUNG", "MIXED", "UNKNOWN"]);
export type Discipline = z.infer<typeof DisciplineSchema>;

export const PageModeSchema = z.enum(["DIGITAL", "SCAN", "HYBRID", "UNREADABLE"]);
export type PageMode = z.infer<typeof PageModeSchema>;

export const OfferLineRoleSchema = z.enum([
  "PRIMARY",
  "REQUIRED_COMPONENT",
  "OPTIONAL",
  "ALTERNATIVE",
  "INCLUDED_ACCESSORY",
  "NOT_OFFERED",
  "PRICE_ON_REQUEST",
  "PROVIDED_BY_OTHERS",
  "NOTE",
  "UNKNOWN"
]);
export type OfferLineRole = z.infer<typeof OfferLineRoleSchema>;

export const EvidenceStatusSchema = z.enum([
  "VERIFIED_NATIVE",
  "VERIFIED_VISUAL",
  "VISUAL_ONLY_UNCONFIRMED",
  "MISSING",
  "CONFLICTING"
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const VerificationStatusSchema = z.enum([
  "MACHINE_VALIDATED",
  "NEEDS_REVIEW",
  "REVIEW_REQUIRED",
  "HUMAN_CONFIRMED",
  "HUMAN_CORRECTED"
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const IssueCodeSchema = z.enum([
  "EVIDENCE_MISSING",
  "EVIDENCE_CONFLICTING",
  "PRICE_COLUMN_CONFLICT",
  "PRICE_ARITHMETIC_MISMATCH",
  "PRICE_BASIS_UNCLEAR",
  "OPTIONAL_PRIMARY_AMBIGUOUS",
  "ALTERNATIVE_DIRECT_CONFLICT",
  "ROW_BOUNDARY_AMBIGUOUS",
  "PAGE_CONTINUATION_AMBIGUOUS",
  "BUNDLE_COMPOSITION_DIFFERENCE",
  "QUANTITY_MISMATCH",
  "UNIT_MISMATCH",
  "TECHNICAL_DEVIATION",
  "PROJECT_CONTEXT_CONFLICT",
  "DOCUMENT_TYPE_UNCLEAR",
  "UNMATCHED_OFFER_LINE"
]);
export type IssueCode = z.infer<typeof IssueCodeSchema>;

export const NormalizedRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1)
});

export const EvidenceReferenceSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  pageNumber: z.number().int().positive(),
  textItemIds: z.array(z.string()),
  sourceText: z.string(),
  region: NormalizedRegionSchema,
  cropPath: z.string().nullable(),
  status: EvidenceStatusSchema
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const MoneyCandidateSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "UNIT_PRICE",
    "TOTAL_PRICE",
    "SUBTOTAL",
    "DISCOUNT",
    "SURCHARGE",
    "OTHER"
  ]),
  rawValue: z.string(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  priceBasis: z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]).nullable(),
  evidence: z.array(EvidenceReferenceSchema)
});
export type MoneyCandidate = z.infer<typeof MoneyCandidateSchema>;

export const FinancialAdjustmentSchema = z.object({
  id: z.string(),
  kind: z.enum(["DISCOUNT", "SURCHARGE"]),
  label: z.string(),
  percentage: z.number().nullable(),
  amount: z.number().nullable(),
  evidence: z.array(EvidenceReferenceSchema)
});

export const OfferLineSchema = z.object({
  id: z.string(),
  sourcePositionNumber: z.string().nullable(),
  supplierPositionNumber: z.string().nullable(),
  description: z.string(),
  manufacturer: z.string().nullable(),
  articleNumber: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  priceBasis: z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]).nullable(),
  currency: z.string().nullable(),
  moneyCandidates: z.array(MoneyCandidateSchema),
  interpretedUnitPrice: z.number().nullable(),
  interpretedTotalPrice: z.number().nullable(),
  role: OfferLineRoleSchema,
  groupId: z.string().nullable(),
  continuation: z.boolean(),
  evidence: z.array(EvidenceReferenceSchema),
  verificationStatus: VerificationStatusSchema,
  lockedFields: z.array(z.string())
});
export type OfferLine = z.infer<typeof OfferLineSchema>;

export const OfferGroupSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  label: z.string(),
  lines: z.array(OfferLineSchema),
  adjustments: z.array(FinancialAdjustmentSchema),
  evidence: z.array(EvidenceReferenceSchema)
});

export const DocumentMetadataCandidateSchema = z.object({
  id: z.string(),
  field: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceReferenceSchema)
});

export const ExtractedSectionSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  label: z.string(),
  kind: z.enum(["HEADING", "TABLE", "OFFER_GROUP", "BASIS_GROUP", "NOTE", "UNKNOWN"]),
  evidence: z.array(EvidenceReferenceSchema)
});

export const BasisPositionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  parentId: z.string().nullable(),
  positionNumber: z.string(),
  description: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  technicalAttributes: z.array(
    z.object({
      name: z.string(),
      value: z.string()
    })
  ),
  manufacturerRequirements: z.array(z.string()),
  requiredScope: z.array(z.string()),
  notes: z.array(z.string()),
  optional: z.boolean(),
  alternative: z.boolean(),
  heading: z.boolean(),
  evidence: z.array(EvidenceReferenceSchema)
});
export type BasisPosition = z.infer<typeof BasisPositionSchema>;

export const PageExtractionSchema = z.object({
  documentId: z.string(),
  pageNumber: z.number().int().positive(),
  pageMode: PageModeSchema,
  documentType: DocumentTypeSchema,
  discipline: DisciplineSchema,
  documentMetadataCandidates: z.array(DocumentMetadataCandidateSchema),
  sections: z.array(ExtractedSectionSchema),
  offerGroups: z.array(OfferGroupSchema),
  basisPositions: z.array(BasisPositionSchema),
  unresolvedNotes: z.array(z.string())
});
export type PageExtraction = z.infer<typeof PageExtractionSchema>;

export const MatchKindSchema = z.enum([
  "ONE_TO_ONE",
  "ONE_TO_MANY",
  "MANY_TO_ONE",
  "MANY_TO_MANY"
]);
export const MatchStatusSchema = z.enum([
  "EXACT",
  "PROBABLE",
  "REQUIRED_COMPONENT",
  "OPTIONAL_COMPONENT",
  "ALTERNATIVE",
  "REPLACEMENT",
  "INCLUDED",
  "UNMATCHED",
  "NOT_OFFERED"
]);

export const MatchLinkSchema = z.object({
  id: z.string(),
  basisPositionIds: z.array(z.string()).min(1),
  offerLineIds: z.array(z.string()).min(1),
  kind: MatchKindSchema,
  status: MatchStatusSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  confirmedByOperator: z.boolean()
});
export type MatchLink = z.infer<typeof MatchLinkSchema>;

export const RecommendationStatusSchema = z.enum([
  "CLEAR_RECOMMENDATION",
  "DECISION_REQUIRED",
  "DIFFERENT_SCOPE_OF_SUPPLY",
  "TECHNICAL_DEVIATION",
  "PRICE_UNCLEAR",
  "MATCHING_UNCLEAR",
  "MANUALLY_ENTERED",
  "NOT_COMPARABLE",
  "NO_OFFER"
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatusSchema>;

export const RuleScopeSchema = z.enum([
  "GLOBAL",
  "COMPANY",
  "SUPPLIER",
  "DOCUMENT_FAMILY",
  "PROJECT"
]);

export const CompanyRuleSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  type: z.enum([
    "PREFERRED_MANUFACTURER",
    "ALLOWED_EQUIVALENT",
    "FORBIDDEN_EQUIVALENT",
    "MANDATORY_COMPONENT",
    "SUPPLIER_ARTICLE_MAPPING",
    "BUNDLE_COMPOSITION",
    "UNIT_CONVERSION",
    "COMPARISON_RULE",
    "SUPPLIER_HINT",
    "DOCUMENT_LAYOUT_HINT"
  ]),
  scope: RuleScopeSchema,
  scopeId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  approvedAt: z.string().datetime(),
  supersedesRuleId: z.string().nullable()
});

export const ExtractionEnvelopeSchema = z.object({
  promptVersion: z.string(),
  schemaVersion: z.string(),
  preprocessingVersion: z.string(),
  extraction: PageExtractionSchema
});
export type ExtractionEnvelope = z.infer<typeof ExtractionEnvelopeSchema>;

export const TargetedRecheckSchema = z.object({
  changes: z.array(
    z.object({
      field: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      evidence: z.array(EvidenceReferenceSchema)
    })
  ),
  unresolvedNotes: z.array(z.string()),
  humanReviewRequired: z.boolean()
});
export type TargetedRecheck = z.infer<typeof TargetedRecheckSchema>;

export const PROMPT_VERSION = "supplier-page-extraction-v1";
export const BASIS_PROMPT_VERSION = "basis-page-extraction-v1";
export const RECHECK_PROMPT_VERSION = "supplier-targeted-recheck-v1";
export const SCHEMA_VERSION = "extraction-contract-v1";
export const PREPROCESSING_VERSION = "pdf-page-v1";
