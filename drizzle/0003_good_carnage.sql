CREATE TABLE "decision_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"position_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"selected_supplier_option_id" text,
	"selected_bundle_line_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejected_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text,
	"comment" text DEFAULT '' NOT NULL,
	"analysis_version_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"device_session_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"position_id" text NOT NULL,
	"decision_id" uuid,
	"draft_id" uuid,
	"event_type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "recommendation_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "supplier_decisions"
SET
	"comment" = COALESCE("comment", ''),
	"evidence_snapshot" = COALESCE("evidence_snapshot", '{}'::jsonb),
	"decided_by" = COALESCE("decided_by", "operator");
--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "comment" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "evidence_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "decided_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "position_id" text;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "selected_bundle_line_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "rejected_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "context_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "analysis_version_id" text;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "decision_version" integer;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "supplier_decisions" AS "decision"
SET
	"project_id" = "recommendation"."project_id"::text,
	"position_id" = "recommendation"."basis_position_id"::text,
	"selected_bundle_line_ids" = COALESCE("decision"."selected_supplier_line_ids", '[]'::jsonb),
	"outcome" = "decision"."status",
	"context_snapshot" = '{}'::jsonb,
	"analysis_version_id" = 'legacy'
FROM "supplier_recommendations" AS "recommendation"
WHERE "decision"."recommendation_id" = "recommendation"."id";
--> statement-breakpoint
WITH "versioned" AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "project_id", "position_id"
			ORDER BY "decided_at", "id"
		) AS "version"
	FROM "supplier_decisions"
)
UPDATE "supplier_decisions" AS "decision"
SET "decision_version" = "versioned"."version"
FROM "versioned"
WHERE "decision"."id" = "versioned"."id";
--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "position_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "outcome" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "context_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "analysis_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_decisions" ALTER COLUMN "decision_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_drafts" ADD CONSTRAINT "decision_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_drafts" ADD CONSTRAINT "decision_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_decision_id_supplier_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."supplier_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_drafts_project_position_idx" ON "decision_drafts" USING btree ("project_id","position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_idx" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_decisions_project_position_version_idx" ON "supplier_decisions" USING btree ("project_id","position_id","decision_version");
