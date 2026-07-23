import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const documentType = pgEnum("document_type", [
  "BASIS_LV",
  "SUPPLIER_OFFER",
  "FINAL_DECISION",
  "HISTORICAL_CALCULATION",
  "MANUFACTURER_CALCULATION",
  "MANUAL_PRICE_TABLE",
  "UNKNOWN"
]);
export const discipline = pgEnum("discipline", ["SANITAER", "HEIZUNG", "MIXED", "UNKNOWN"]);
export const pageMode = pgEnum("page_mode", ["DIGITAL", "SCAN", "HYBRID", "UNREADABLE"]);
export const verificationStatus = pgEnum("verification_status", [
  "MACHINE_VALIDATED",
  "NEEDS_REVIEW",
  "HUMAN_CONFIRMED",
  "HUMAN_CORRECTED"
]);
export const jobStatus = pgEnum("job_status", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED"
]);
export const ruleScope = pgEnum("rule_scope", [
  "GLOBAL",
  "COMPANY",
  "SUPPLIER",
  "DOCUMENT_FAMILY",
  "PROJECT"
]);

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  externalReference: text("external_reference"),
  discipline: discipline("discipline").notNull().default("UNKNOWN"),
  status: text("status").notNull().default("DRAFT"),
  ...auditColumns
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    sha256: text("sha256").notNull(),
    type: documentType("type").notNull().default("UNKNOWN"),
    discipline: discipline("discipline").notNull().default("UNKNOWN"),
    supplierName: text("supplier_name"),
    activeRevisionId: uuid("active_revision_id"),
    ...auditColumns
  },
  (table) => [uniqueIndex("documents_sha256_idx").on(table.sha256)]
);

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("document_revision_number_idx").on(table.documentId, table.revisionNumber)
  ]
);

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentRevisionId: uuid("document_revision_id")
      .notNull()
      .references(() => documentRevisions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    mode: pageMode("mode").notNull(),
    width: numeric("width", { precision: 12, scale: 4 }).notNull(),
    height: numeric("height", { precision: 12, scale: 4 }).notNull(),
    renderStorageKey: text("render_storage_key"),
    textLayerHash: text("text_layer_hash"),
    ...auditColumns
  },
  (table) => [uniqueIndex("page_revision_number_idx").on(table.documentRevisionId, table.pageNumber)]
);

export const textItems = pgTable(
  "text_items",
  {
    id: text("id").primaryKey(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    sourceOrder: integer("source_order").notNull(),
    rawText: text("raw_text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    region: jsonb("region").notNull()
  },
  (table) => [uniqueIndex("text_item_order_idx").on(table.pageId, table.sourceOrder)]
);

export const extractionRuns = pgTable("extraction_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentRevisionId: uuid("document_revision_id")
    .notNull()
    .references(() => documentRevisions.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  responseId: text("response_id"),
  promptVersion: text("prompt_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  preprocessingVersion: text("preprocessing_version").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cachedTokens: integer("cached_tokens"),
  durationMs: integer("duration_ms"),
  attempt: integer("attempt").notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 12, scale: 6 }),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
});

export const extractionPageRuns = pgTable(
  "extraction_page_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    extractionRunId: uuid("extraction_run_id")
      .notNull()
      .references(() => extractionRuns.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    immutableResult: jsonb("immutable_result").notNull(),
    resultHash: text("result_hash").notNull(),
    semanticRecheckCount: integer("semantic_recheck_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("extraction_page_once_idx").on(table.extractionRunId, table.pageId)]
);

export const offerGroups = pgTable("offer_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  extractionPageRunId: uuid("extraction_page_run_id")
    .notNull()
    .references(() => extractionPageRuns.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const offerLines = pgTable("offer_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerGroupId: uuid("offer_group_id")
    .notNull()
    .references(() => offerGroups.id, { onDelete: "cascade" }),
  supplierPositionNumber: text("supplier_position_number"),
  sourcePositionNumber: text("source_position_number"),
  description: text("description").notNull(),
  manufacturer: text("manufacturer"),
  articleNumber: text("article_number"),
  quantity: numeric("quantity", { precision: 18, scale: 6 }),
  unit: text("unit"),
  role: text("role").notNull(),
  verificationStatus: verificationStatus("verification_status").notNull().default("NEEDS_REVIEW"),
  immutableExtraction: jsonb("immutable_extraction").notNull(),
  reviewedValue: jsonb("reviewed_value"),
  lockedFields: jsonb("locked_fields").notNull().default([]),
  ...auditColumns
});

export const moneyCandidates = pgTable("money_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerLineId: uuid("offer_line_id")
    .notNull()
    .references(() => offerLines.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  rawValue: text("raw_value").notNull(),
  amount: numeric("amount", { precision: 18, scale: 4 }),
  currency: text("currency"),
  priceBasis: integer("price_basis"),
  evidence: jsonb("evidence").notNull().default([])
});

export const basisPositions = pgTable("basis_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  extractionPageRunId: uuid("extraction_page_run_id")
    .notNull()
    .references(() => extractionPageRuns.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  positionNumber: text("position_number").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }),
  unit: text("unit"),
  heading: boolean("heading").notNull().default(false),
  optional: boolean("optional").notNull().default(false),
  alternative: boolean("alternative").notNull().default(false),
  payload: jsonb("payload").notNull(),
  ...auditColumns
});

export const evidenceReferences = pgTable("evidence_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  pageId: uuid("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  sourceText: text("source_text").notNull(),
  region: jsonb("region").notNull(),
  cropStorageKey: text("crop_storage_key"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const evidenceTextItems = pgTable(
  "evidence_text_items",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceReferences.id, { onDelete: "cascade" }),
    textItemId: text("text_item_id")
      .notNull()
      .references(() => textItems.id, { onDelete: "cascade" })
  },
  (table) => [primaryKey({ columns: [table.evidenceId, table.textItemId] })]
);

export const matchLinks = pgTable("match_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  score: numeric("score", { precision: 5, scale: 4 }).notNull(),
  basisPositionIds: jsonb("basis_position_ids").notNull(),
  offerLineIds: jsonb("offer_line_ids").notNull(),
  reasons: jsonb("reasons").notNull().default([]),
  confirmedByOperator: boolean("confirmed_by_operator").notNull().default(false),
  ...auditColumns
});

export const reviewIssues = pgTable("review_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  code: text("code").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("OPEN"),
  message: text("message").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  ...auditColumns
});

export const reviewActions = pgTable("review_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  issueId: uuid("issue_id")
    .notNull()
    .references(() => reviewIssues.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const supplierRecommendations = pgTable("supplier_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  basisPositionId: uuid("basis_position_id")
    .notNull()
    .references(() => basisPositions.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  supplierOptions: jsonb("supplier_options").notNull(),
  reason: text("reason").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow()
});

export const supplierDecisions = pgTable("supplier_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  recommendationId: uuid("recommendation_id")
    .notNull()
    .references(() => supplierRecommendations.id, { onDelete: "cascade" }),
  selectedSupplierId: text("selected_supplier_id"),
  status: text("status").notNull(),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const companyRules = pgTable(
  "company_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    scope: ruleScope("scope").notNull(),
    scopeId: text("scope_id"),
    payload: jsonb("payload").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    supersedesRuleId: uuid("supersedes_rule_id"),
    active: boolean("active").notNull().default(true)
  },
  (table) => [uniqueIndex("company_rule_version_idx").on(table.id, table.version)]
);

export const ruleCandidates = pgTable("rule_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceReviewActionId: uuid("source_review_action_id")
    .notNull()
    .references(() => reviewActions.id, { onDelete: "cascade" }),
  proposedType: text("proposed_type").notNull(),
  proposedScope: ruleScope("proposed_scope").notNull(),
  payload: jsonb("payload").notNull(),
  regressionCase: jsonb("regression_case").notNull(),
  status: text("status").notNull().default("PENDING_APPROVAL"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const processingJobs = pgTable("processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  status: jobStatus("status").notNull().default("PENDING"),
  attempt: integer("attempt").notNull().default(0),
  cacheKey: text("cache_key").notNull(),
  workerId: text("worker_id"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
