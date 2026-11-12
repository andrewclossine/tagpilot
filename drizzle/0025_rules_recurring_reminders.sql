CREATE TABLE "bank_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contains" text NOT NULL,
	"direction" text DEFAULT 'any' NOT NULL,
	"min_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"max_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"bank_account_id" uuid,
	"account_id" uuid NOT NULL,
	"project_id" uuid,
	"auto_book" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"every" text NOT NULL,
	"next_date" date NOT NULL,
	"end_date" date,
	"auto_post" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"payload" jsonb NOT NULL,
	"made" integer DEFAULT 0 NOT NULL,
	"last_date" date,
	"last_error" text DEFAULT '' NOT NULL,
	"source_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "suggested_project_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reminders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_bank_account_id_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_rules_company" ON "bank_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "recurring_company_next" ON "recurring_templates" USING btree ("company_id","next_date");--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_suggested_project_id_projects_id_fk" FOREIGN KEY ("suggested_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;