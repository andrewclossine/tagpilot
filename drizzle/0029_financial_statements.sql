CREATE TABLE "fs_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"comparative" boolean DEFAULT true NOT NULL,
	"framework" text DEFAULT 'ifrs_sme' NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" text DEFAULT '' NOT NULL,
	"approved_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fs_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"figures" text,
	"included" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fs_drafts" ADD CONSTRAINT "fs_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fs_drafts" ADD CONSTRAINT "fs_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fs_notes" ADD CONSTRAINT "fs_notes_draft_id_fs_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."fs_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fs_drafts_company" ON "fs_drafts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "fs_notes_draft" ON "fs_notes" USING btree ("draft_id","sort_order");