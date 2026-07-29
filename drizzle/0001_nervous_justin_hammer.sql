ALTER TABLE "supplier_decisions" ADD COLUMN "selected_supplier_option_id" text;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "selected_supplier_line_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "evidence_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "document_revision_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "previous_decision_id" uuid;