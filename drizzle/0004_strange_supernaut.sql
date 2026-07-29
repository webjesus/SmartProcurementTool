CREATE TABLE "project_workspaces" (
	"project_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "project_workspaces_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;