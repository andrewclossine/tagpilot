CREATE TABLE "proforma_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proforma_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proformas" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "proformas" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proformas" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proformas" ADD COLUMN "sent_to" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_revisions" ADD CONSTRAINT "proforma_revisions_proforma_id_proformas_id_fk" FOREIGN KEY ("proforma_id") REFERENCES "public"."proformas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_revisions" ADD CONSTRAINT "proforma_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proforma_revisions_proforma" ON "proforma_revisions" USING btree ("proforma_id");--> statement-breakpoint
UPDATE "proformas" SET "status" = 'draft' WHERE "status" = 'open';