ALTER TYPE "public"."document_type" ADD VALUE 'SPECIALIZED_SUPPLIER_OFFER' BEFORE 'FINAL_DECISION';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'FINAL_INTERNAL_CALCULATION' BEFORE 'FINAL_DECISION';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'FINAL_CUSTOMER_OFFER' BEFORE 'FINAL_DECISION';--> statement-breakpoint
CREATE TABLE "supplier_decision_review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_decision_id" uuid NOT NULL,
	"basis_position_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_decision_id" uuid,
	"operator" text NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "decision_type" text;--> statement-breakpoint
ALTER TABLE "supplier_decision_review_actions" ADD CONSTRAINT "supplier_decision_review_actions_supplier_decision_id_supplier_decisions_id_fk" FOREIGN KEY ("supplier_decision_id") REFERENCES "public"."supplier_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_decision_review_actions" ADD CONSTRAINT "supplier_decision_review_actions_basis_position_id_basis_positions_id_fk" FOREIGN KEY ("basis_position_id") REFERENCES "public"."basis_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_decision_review_action_decision_idx" ON "supplier_decision_review_actions" USING btree ("supplier_decision_id");