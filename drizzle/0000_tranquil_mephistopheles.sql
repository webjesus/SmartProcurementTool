CREATE TYPE "public"."discipline" AS ENUM('SANITAER', 'HEIZUNG', 'MIXED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('BASIS_LV', 'SUPPLIER_OFFER', 'FINAL_DECISION', 'HISTORICAL_CALCULATION', 'MANUFACTURER_CALCULATION', 'MANUAL_PRICE_TABLE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."page_mode" AS ENUM('DIGITAL', 'SCAN', 'HYBRID', 'UNREADABLE');--> statement-breakpoint
CREATE TYPE "public"."rule_scope" AS ENUM('GLOBAL', 'COMPANY', 'SUPPLIER', 'DOCUMENT_FAMILY', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('MACHINE_VALIDATED', 'NEEDS_REVIEW', 'HUMAN_CONFIRMED', 'HUMAN_CORRECTED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "basis_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_page_run_id" uuid NOT NULL,
	"parent_id" uuid,
	"position_number" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 6),
	"unit" text,
	"heading" boolean DEFAULT false NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"alternative" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"scope" "rule_scope" NOT NULL,
	"scope_id" text,
	"payload" jsonb NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_rule_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"sha256" text NOT NULL,
	"type" "document_type" DEFAULT 'UNKNOWN' NOT NULL,
	"discipline" "discipline" DEFAULT 'UNKNOWN' NOT NULL,
	"supplier_name" text,
	"active_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"source_text" text NOT NULL,
	"region" jsonb NOT NULL,
	"crop_storage_key" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_text_items" (
	"evidence_id" uuid NOT NULL,
	"text_item_id" text NOT NULL,
	CONSTRAINT "evidence_text_items_evidence_id_text_item_id_pk" PRIMARY KEY("evidence_id","text_item_id")
);
--> statement-breakpoint
CREATE TABLE "extraction_page_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"immutable_result" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"semantic_recheck_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"response_id" text,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"preprocessing_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_tokens" integer,
	"duration_ms" integer,
	"attempt" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(12, 6),
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "match_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"basis_position_ids" jsonb NOT NULL,
	"offer_line_ids" jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_by_operator" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_line_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"raw_value" text NOT NULL,
	"amount" numeric(18, 4),
	"currency" text,
	"price_basis" integer,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_page_run_id" uuid NOT NULL,
	"label" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_group_id" uuid NOT NULL,
	"supplier_position_number" text,
	"source_position_number" text,
	"description" text NOT NULL,
	"manufacturer" text,
	"article_number" text,
	"quantity" numeric(18, 6),
	"unit" text,
	"role" text NOT NULL,
	"verification_status" "verification_status" DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"immutable_extraction" jsonb NOT NULL,
	"reviewed_value" jsonb,
	"locked_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"mode" "page_mode" NOT NULL,
	"width" numeric(12, 4) NOT NULL,
	"height" numeric(12, 4) NOT NULL,
	"render_storage_key" text,
	"text_layer_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"cache_key" text NOT NULL,
	"worker_id" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"external_reference" text,
	"discipline" "discipline" DEFAULT 'UNKNOWN' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_review_action_id" uuid NOT NULL,
	"proposed_type" text NOT NULL,
	"proposed_scope" "rule_scope" NOT NULL,
	"payload" jsonb NOT NULL,
	"regression_case" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"selected_supplier_id" text,
	"status" text NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"basis_position_id" uuid NOT NULL,
	"status" text NOT NULL,
	"supplier_options" jsonb NOT NULL,
	"reason" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "text_items" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"source_order" integer NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"region" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basis_positions" ADD CONSTRAINT "basis_positions_extraction_page_run_id_extraction_page_runs_id_fk" FOREIGN KEY ("extraction_page_run_id") REFERENCES "public"."extraction_page_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_references" ADD CONSTRAINT "evidence_references_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_references" ADD CONSTRAINT "evidence_references_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_text_items" ADD CONSTRAINT "evidence_text_items_evidence_id_evidence_references_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_text_items" ADD CONSTRAINT "evidence_text_items_text_item_id_text_items_id_fk" FOREIGN KEY ("text_item_id") REFERENCES "public"."text_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_page_runs" ADD CONSTRAINT "extraction_page_runs_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_page_runs" ADD CONSTRAINT "extraction_page_runs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_document_revision_id_document_revisions_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_links" ADD CONSTRAINT "match_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_candidates" ADD CONSTRAINT "money_candidates_offer_line_id_offer_lines_id_fk" FOREIGN KEY ("offer_line_id") REFERENCES "public"."offer_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_groups" ADD CONSTRAINT "offer_groups_extraction_page_run_id_extraction_page_runs_id_fk" FOREIGN KEY ("extraction_page_run_id") REFERENCES "public"."extraction_page_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_offer_group_id_offer_groups_id_fk" FOREIGN KEY ("offer_group_id") REFERENCES "public"."offer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_document_revision_id_document_revisions_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_issue_id_review_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."review_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_candidates" ADD CONSTRAINT "rule_candidates_source_review_action_id_review_actions_id_fk" FOREIGN KEY ("source_review_action_id") REFERENCES "public"."review_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD CONSTRAINT "supplier_decisions_recommendation_id_supplier_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."supplier_recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recommendations" ADD CONSTRAINT "supplier_recommendations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recommendations" ADD CONSTRAINT "supplier_recommendations_basis_position_id_basis_positions_id_fk" FOREIGN KEY ("basis_position_id") REFERENCES "public"."basis_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_items" ADD CONSTRAINT "text_items_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_rule_version_idx" ON "company_rules" USING btree ("id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_revision_number_idx" ON "document_revisions" USING btree ("document_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_sha256_idx" ON "documents" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_page_once_idx" ON "extraction_page_runs" USING btree ("extraction_run_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_revision_number_idx" ON "pages" USING btree ("document_revision_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "text_item_order_idx" ON "text_items" USING btree ("page_id","source_order");