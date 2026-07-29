import { z } from "zod";

export const DocumentTypeSchema = z.enum([
  "BASIS_LV",
  "SUPPLIER_OFFER",
  "SPECIALIZED_SUPPLIER_OFFER",
  "FINAL_INTERNAL_CALCULATION",
  "FINAL_CUSTOMER_OFFER",
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
  "MANDATORY_COMPONENT",
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

export const OfferCompletenessStatusSchema = z.enum([
  "PRICED_OFFER",
  "OFFER_WITHOUT_PRICE",
  "PRICE_ON_REQUEST",
  "UNPRICED_TEMPLATE",
  "EMPTY_LINE",
  "NOT_OFFERED",
  "PRICE_UNCLEAR"
]);
export type OfferCompletenessStatus = z.infer<typeof OfferCompletenessStatusSchema>;

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
  "UNMATCHED_OFFER_LINE",
  "AI_FALLBACK_CANDIDATE"
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
  lockedFields: z.array(z.string()),
  completenessStatus: OfferCompletenessStatusSchema.optional(),
  completenessReason: z.string().optional()
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
export type ExtractedSection = z.infer<typeof ExtractedSectionSchema>;

export const BasisScopeRequirementCategorySchema = z.enum([
  "MATERIAL",
  "INSTALLATION",
  "EXECUTION"
]);
export type BasisScopeRequirementCategory = z.infer<
  typeof BasisScopeRequirementCategorySchema
>;

export const BasisScopeRequirementSchema = z.object({
  code: z.string(),
  label: z.string(),
  category: BasisScopeRequirementCategorySchema,
  inherited: z.boolean(),
  evidence: z.array(EvidenceReferenceSchema)
});
export type BasisScopeRequirement = z.infer<
  typeof BasisScopeRequirementSchema
>;

export const BasisScopeProfileSchema = z.object({
  directLeafDescription: z.string(),
  directLeafEvidence: z.array(EvidenceReferenceSchema),
  inheritedExecutionDescription: z.array(z.string()),
  inheritedMaterialRequirements: z.array(BasisScopeRequirementSchema),
  inheritedInstallationRequirements: z.array(BasisScopeRequirementSchema),
  fullLvExecutionScope: z.array(BasisScopeRequirementSchema),
  procurementMaterialScope: z.array(BasisScopeRequirementSchema),
  referenceResolved: z.boolean()
});
export type BasisScopeProfile = z.infer<typeof BasisScopeProfileSchema>;

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
  evidence: z.array(EvidenceReferenceSchema),
  hierarchyPath: z.array(z.string()).optional(),
  continuationEvidence: z.array(EvidenceReferenceSchema).optional(),
  scopeProfile: BasisScopeProfileSchema.optional(),
  verificationStatus: VerificationStatusSchema.optional()
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

const CompactStringValueSchema = z.array(z.string()).max(1);
const CompactNumberValueSchema = z.array(z.number()).max(1);
const CompactPriceBasisValueSchema = z
  .array(z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]))
  .max(1);

export const CompactMetadataCandidateSchema = z.object({
  field: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  textItemIds: z.array(z.string()).min(1)
});

export const CompactSectionSchema = z.object({
  key: z.string(),
  parentKey: CompactStringValueSchema,
  label: z.string(),
  kind: z.enum(["HEADING", "TABLE", "OFFER_GROUP", "BASIS_GROUP", "NOTE", "UNKNOWN"]),
  textItemIds: z.array(z.string()).min(1)
});

export const CompactMoneyCandidateSchema = z.object({
  kind: z.enum([
    "UNIT_PRICE",
    "TOTAL_PRICE",
    "SUBTOTAL",
    "DISCOUNT",
    "SURCHARGE",
    "OTHER"
  ]),
  rawValue: z.string(),
  amount: CompactNumberValueSchema,
  currency: CompactStringValueSchema,
  priceBasis: CompactPriceBasisValueSchema,
  textItemIds: z.array(z.string()).min(1)
});

export const CompactFinancialAdjustmentSchema = z.object({
  kind: z.enum(["DISCOUNT", "SURCHARGE"]),
  label: z.string(),
  percentage: CompactNumberValueSchema,
  amount: CompactNumberValueSchema,
  textItemIds: z.array(z.string()).min(1)
});

export const CompactOfferLineSchema = z.object({
  sourcePositionNumber: CompactStringValueSchema,
  supplierPositionNumber: CompactStringValueSchema,
  description: z.string(),
  manufacturer: CompactStringValueSchema,
  articleNumber: CompactStringValueSchema,
  quantity: CompactNumberValueSchema,
  unit: CompactStringValueSchema,
  priceBasis: CompactPriceBasisValueSchema,
  currency: CompactStringValueSchema,
  moneyCandidates: z.array(CompactMoneyCandidateSchema),
  interpretedUnitPrice: CompactNumberValueSchema,
  interpretedTotalPrice: CompactNumberValueSchema,
  role: OfferLineRoleSchema,
  groupKey: CompactStringValueSchema,
  continuation: z.boolean(),
  completenessStatus: OfferCompletenessStatusSchema,
  completenessReason: CompactStringValueSchema,
  textItemIds: z.array(z.string()).min(1)
});

export const CompactOfferGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  lines: z.array(CompactOfferLineSchema),
  adjustments: z.array(CompactFinancialAdjustmentSchema),
  textItemIds: z.array(z.string())
});

export const CompactBasisPositionSchema = z.object({
  parentKey: CompactStringValueSchema,
  positionNumber: z.string(),
  description: z.string(),
  quantity: CompactNumberValueSchema,
  unit: CompactStringValueSchema,
  technicalAttributes: z.array(z.object({ name: z.string(), value: z.string() })),
  manufacturerRequirements: z.array(z.string()),
  requiredScope: z.array(z.string()),
  notes: z.array(z.string()),
  optional: z.boolean(),
  alternative: z.boolean(),
  heading: z.boolean(),
  textItemIds: z.array(z.string()).min(1)
});

export const CompactNativeExtractionSchema = z.object({
  metadataCandidates: z.array(CompactMetadataCandidateSchema),
  sections: z.array(CompactSectionSchema),
  offerGroups: z.array(CompactOfferGroupSchema),
  basisPositions: z.array(CompactBasisPositionSchema),
  unresolvedFlags: z.array(z.string())
});
export type CompactNativeExtraction = z.infer<typeof CompactNativeExtractionSchema>;

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

export const OfferAvailabilitySchema = z.enum([
  "PRESENT",
  "EXPLICIT_NO_OFFER",
  "COVERED_WITHOUT_OFFER",
  "NOT_COVERED"
]);
export type OfferAvailability = z.infer<typeof OfferAvailabilitySchema>;

export const SupplierMaterialScopeStatusSchema = z.enum([
  "COMPLETE_MATERIAL_SCOPE",
  "PARTIAL_MATERIAL_SCOPE",
  "TECHNICALLY_DEVIATING",
  "EXPLICIT_NO_OFFER",
  "NOT_COVERED",
  "UNKNOWN"
]);
export type SupplierMaterialScopeStatus = z.infer<
  typeof SupplierMaterialScopeStatusSchema
>;

export const TechnicalComparisonStatusSchema = z.enum([
  "CONFIRMED_COMPATIBLE",
  "CONFIRMED_DEVIATION",
  "UNRESOLVED"
]);
export type TechnicalComparisonStatus = z.infer<
  typeof TechnicalComparisonStatusSchema
>;

export const SupplierOptionSchema = z.object({
  id: z.string(),
  basisPositionIds: z.array(z.string()).min(1),
  supplierDocumentId: z.string(),
  supplierLabel: z.string(),
  matchedOfferLineIds: z.array(z.string()),
  matchLinkIds: z.array(z.string()),
  primaryPrice: z.number().nullable(),
  mandatoryComponentPrices: z.array(z.number()),
  optionalPrices: z.array(z.number()),
  pricedTotal: z.number().nullable(),
  comparableTotal: z.number().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  scopeOfSupply: z.array(z.string()),
  technicalDeviations: z.array(z.string()),
  missingComponents: z.array(z.string()),
  validationIssueIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  quantityCompatible: z.boolean(),
  unitCompatible: z.boolean(),
  technicalCompatible: z.boolean(),
  technicalComparisonStatus: TechnicalComparisonStatusSchema.optional(),
  unresolvedTechnicalAttributes: z.array(z.string()).optional(),
  requiredScopeComplete: z.boolean(),
  optionalSeparated: z.boolean(),
  bundleCompatible: z.boolean(),
  evidenceSufficient: z.boolean(),
  extractionValidated: z.boolean(),
  matchingAccepted: z.boolean(),
  matchingReliable: z.boolean(),
  offerAvailability: OfferAvailabilitySchema,
  materialScopeStatus: SupplierMaterialScopeStatusSchema,
  reasons: z.array(z.string()),
  status: RecommendationStatusSchema
});
export type SupplierOption = z.infer<typeof SupplierOptionSchema>;

export const BasisRecommendationSchema = z.object({
  basisPositionId: z.string(),
  status: RecommendationStatusSchema,
  recommendedSupplierDocumentId: z.string().nullable(),
  reasons: z.array(z.string()),
  requiresOperatorConfirmation: z.boolean()
});
export type BasisRecommendation = z.infer<typeof BasisRecommendationSchema>;

export const DecisionEvidenceSourceSchema = z.object({
  evidenceId: z.string(),
  documentId: z.string(),
  documentRevisionId: z.string(),
  pageNumber: z.number().int().positive(),
  region: NormalizedRegionSchema,
  assetKey: z.string()
}).strict();
export type DecisionEvidenceSource = z.infer<typeof DecisionEvidenceSourceSchema>;

export const DecisionLineSnapshotSchema = z.object({
  lineId: z.string(),
  role: OfferLineRoleSchema,
  description: z.string(),
  manufacturer: z.string().nullable(),
  articleNumber: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  continuation: z.boolean(),
  sources: z.array(DecisionEvidenceSourceSchema)
}).strict();

export const DecisionBasisSnapshotSchema = z.object({
  id: z.string(),
  positionNumber: z.string(),
  description: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  sources: z.array(DecisionEvidenceSourceSchema)
}).strict();

export const DecisionOptionSnapshotSchema = z.object({
  optionId: z.string(),
  supplierDocumentId: z.string(),
  supplierLabel: z.string(),
  comparableTotal: z.number().nullable(),
  status: RecommendationStatusSchema,
  reasons: z.array(z.string()),
  lines: z.array(DecisionLineSnapshotSchema)
}).strict();

export const DecisionEvidenceSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  basisPosition: DecisionBasisSnapshotSchema,
  basisContext: z.array(DecisionBasisSnapshotSchema),
  supplierOptionId: z.string().nullable(),
  supplierDocumentId: z.string().nullable(),
  selectedLines: z.array(DecisionLineSnapshotSchema),
  visibleSupplierOptions: z.array(DecisionOptionSnapshotSchema).optional(),
  supplierContextLines: z.array(DecisionLineSnapshotSchema),
  includedRequiredComponents: z.array(DecisionLineSnapshotSchema),
  excludedOptionalComponents: z.array(DecisionLineSnapshotSchema),
  continuationPages: z.array(DecisionEvidenceSourceSchema),
  documentRevisionIds: z.array(z.string())
}).strict();
export type DecisionEvidenceSnapshot = z.infer<typeof DecisionEvidenceSnapshotSchema>;

export const LegacySupplierDecisionSchema = z.object({
  id: z.string(),
  basisPositionId: z.string(),
  supplierDocumentId: z.string().nullable(),
  status: z.enum(["SELECTED", "DEFERRED"]),
  comment: z.string(),
  operator: z.string(),
  timestamp: z.string().datetime()
}).strict();

export const SupplierDecisionV2Schema = z.object({
  id: z.string(),
  basisPositionId: z.string(),
  supplierDocumentId: z.string().nullable(),
  status: z.enum([
    "SELECTED",
    "DEFERRED",
    "NONE_CORRECT",
    "ADDITIONAL_CHECK_REQUESTED"
  ]),
  selectedSupplierOptionId: z.string().nullable(),
  selectedSupplierLineIds: z.array(z.string()),
  reasonCodes: z.array(z.string()),
  comment: z.string(),
  evidenceSnapshot: DecisionEvidenceSnapshotSchema.nullable(),
  documentRevisionIds: z.array(z.string()),
  decidedBy: z.string(),
  decidedAt: z.string().datetime(),
  catalogVersion: z.string(),
  previousDecisionId: z.string().nullable(),
  decisionType: z.enum([
    "MANUAL_SELECTION",
    "AUTOMATIC_LOWEST_PRICE",
    "AUTOMATIC_OVERRIDE",
    "DEFERRED",
    "NONE_CORRECT",
    "ADDITIONAL_CHECK_REQUESTED"
  ]).optional()
}).strict().superRefine((decision, context) => {
  if (decision.status === "SELECTED") {
    if (!decision.selectedSupplierOptionId) {
      context.addIssue({ code: "custom", message: "Selected supplier option is required." });
    }
    if (decision.selectedSupplierLineIds.length === 0) {
      context.addIssue({ code: "custom", message: "Selected supplier lines are required." });
    }
    if (!decision.evidenceSnapshot) {
      context.addIssue({ code: "custom", message: "Decision evidence snapshot is required." });
    }
  }
});

export const SupplierDecisionSchema = z.union([
  SupplierDecisionV2Schema,
  LegacySupplierDecisionSchema
]);
export type SupplierDecision = z.infer<typeof SupplierDecisionSchema>;
export type SupplierDecisionV2 = z.infer<typeof SupplierDecisionV2Schema>;

export const SupplierDecisionReviewActionSchema = z.object({
  id: z.string(),
  supplierDecisionId: z.string(),
  basisPositionId: z.string(),
  action: z.enum([
    "MANUAL_SELECTION",
    "AUTOMATIC_OVERRIDE",
    "DEFER",
    "NONE_CORRECT",
    "REQUEST_ADDITIONAL_CHECK"
  ]),
  previousDecisionId: z.string().nullable(),
  operator: z.string(),
  comment: z.string(),
  timestamp: z.string().datetime()
}).strict();
export type SupplierDecisionReviewAction = z.infer<
  typeof SupplierDecisionReviewActionSchema
>;

export const MatchReviewActionSchema = z.object({
  id: z.string(),
  action: z.enum([
    "CONFIRM_MATCH",
    "CHOOSE_BASIS",
    "COMBINE_LINES",
    "SPLIT_GROUP",
    "INCLUDE_REQUIRED_COMPONENT",
    "INCLUDE_OPTIONAL",
    "EXCLUDE_OPTIONAL",
    "CONFIRM_REPLACEMENT",
    "ADD_COMMENT"
  ]),
  basisPositionIds: z.array(z.string()),
  offerLineIds: z.array(z.string()),
  supplierDocumentId: z.string(),
  comment: z.string(),
  operator: z.string(),
  timestamp: z.string().datetime()
});
export type MatchReviewAction = z.infer<typeof MatchReviewActionSchema>;

export const PilotAnalysisSchema = z.object({
  id: z.string(),
  basisDocumentId: z.string(),
  basisDocumentLabel: z.string(),
  basisPages: z.array(z.number().int().positive()),
  basisPositionFrom: z.string(),
  basisPositionTo: z.string(),
  supplierDocuments: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      pages: z.array(z.number().int().positive())
    })
  ),
  basisPositions: z.array(BasisPositionSchema),
  matchLinks: z.array(MatchLinkSchema),
  supplierOptions: z.array(SupplierOptionSchema),
  recommendations: z.array(BasisRecommendationSchema),
  generatedAt: z.string().datetime()
});
export type PilotAnalysis = z.infer<typeof PilotAnalysisSchema>;

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

export const ExtractionMethodSchema = z.enum([
  "OPENAI_STRUCTURED",
  "DETERMINISTIC_TEXT_LAYER",
  "OCR_VISUAL"
]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

export const ExtractionRunProvenanceSchema = z.object({
  extractionMethod: ExtractionMethodSchema,
  documentRevisionId: z.string(),
  pageNumber: z.number().int().positive(),
  rawTextItemsHash: z.string(),
  parserVersion: z.string(),
  validationStatus: z.enum(["COMPLETED", "NEEDS_REVIEW", "FAILED"]),
  confidence: z.number().min(0).max(1),
  fallbackCandidateBlockIds: z.array(z.string()),
  createdAt: z.string().datetime()
});
export type ExtractionRunProvenance = z.infer<
  typeof ExtractionRunProvenanceSchema
>;

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

export const PROMPT_VERSION = "supplier-native-compact-v2";
export const BASIS_PROMPT_VERSION = "basis-native-compact-v2";
export const RECHECK_PROMPT_VERSION = "supplier-targeted-recheck-v1";
export const SCHEMA_VERSION = "native-compact-contract-v2";
export const PREPROCESSING_VERSION = "pdf-page-v1";
