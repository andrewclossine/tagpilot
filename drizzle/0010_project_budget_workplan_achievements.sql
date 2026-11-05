CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"budget_item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"attachment_id" uuid,
	"entered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"baseline" numeric(18, 3),
	"target" numeric(18, 3),
	"source" text DEFAULT '' NOT NULL,
	"assumptions" text DEFAULT '' NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_documents" (
	"voucher_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"status" text DEFAULT 'na' NOT NULL,
	"attachment_id" uuid,
	CONSTRAINT "voucher_documents_voucher_id_doc_type_pk" PRIMARY KEY("voucher_id","doc_type")
);
--> statement-breakpoint
CREATE TABLE "voucher_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"line_no" integer DEFAULT 1 NOT NULL,
	"budget_item_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"activity_budget" numeric(18, 2) DEFAULT 0 NOT NULL,
	"previous_execution" numeric(18, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"step" text NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "task_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "unit" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "quantity" numeric(18, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "unit_cost" numeric(18, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "own_contribution" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "plan" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "responsible" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "baseline_qty" numeric(18, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD COLUMN "baseline_spent" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_budget_item_id_logframe_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."logframe_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_item_id_logframe_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."logframe_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_funds" ADD CONSTRAINT "project_funds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_funds" ADD CONSTRAINT "project_funds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_documents" ADD CONSTRAINT "voucher_documents_voucher_id_payment_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."payment_vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_documents" ADD CONSTRAINT "voucher_documents_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_payment_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."payment_vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_budget_item_id_logframe_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."logframe_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_steps" ADD CONSTRAINT "voucher_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_steps" ADD CONSTRAINT "voucher_steps_voucher_id_payment_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."payment_vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_steps" ADD CONSTRAINT "voucher_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievements_item" ON "achievements" USING btree ("budget_item_id");--> statement-breakpoint
CREATE INDEX "achievements_project" ON "achievements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "indicators_item" ON "indicators" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "project_funds_project" ON "project_funds" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_voucher" ON "voucher_lines" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_item" ON "voucher_lines" USING btree ("budget_item_id");--> statement-breakpoint
CREATE INDEX "voucher_steps_voucher" ON "voucher_steps" USING btree ("voucher_id");--> statement-breakpoint
-- existing requests become one line each, and keep the signatures they already have
INSERT INTO "voucher_lines" ("company_id", "voucher_id", "line_no", "budget_item_id", "amount", "activity_budget", "previous_execution")
  SELECT "company_id", "id", 1, "budget_item_id", "amount", "activity_budget", "previous_execution" FROM "payment_vouchers";--> statement-breakpoint
INSERT INTO "voucher_steps" ("company_id", "voucher_id", "step", "user_id", "at")
  SELECT "company_id", "id", 'prepared', "requested_by", coalesce("submitted_at", "created_at") FROM "payment_vouchers" WHERE "status" <> 'draft';--> statement-breakpoint
INSERT INTO "voucher_steps" ("company_id", "voucher_id", "step", "user_id", "at")
  SELECT "company_id", "id", 'authorized', "decided_by", coalesce("decided_at", "created_at") FROM "payment_vouchers" WHERE "status" IN ('approved', 'paid') AND "decided_by" IS NOT NULL;--> statement-breakpoint
UPDATE "payment_vouchers" SET "status" = 'authorized' WHERE "status" = 'approved';--> statement-breakpoint
UPDATE "logframe_items" SET "task_code" = 'TSK' || replace("code", '.', '') WHERE "level" IN ('activity', 'sub_activity') AND "task_code" = '';
