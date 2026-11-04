CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"attachment_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responsive" boolean,
	"technical_score" numeric(6, 2),
	"financial_score" numeric(6, 2),
	"total_score" numeric(6, 2),
	"rank" integer,
	"evaluation_note" text DEFAULT '' NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"no" integer NOT NULL,
	"reason" text NOT NULL,
	"amount_change" numeric(18, 2) DEFAULT 0 NOT NULL,
	"new_end_date" date,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"from_supplier" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"tender_id" uuid,
	"partner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"signed_date" date NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"attachment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logframe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"indicator" text DEFAULT '' NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"verification" text DEFAULT '' NOT NULL,
	"assumptions" text DEFAULT '' NOT NULL,
	"account_id" uuid,
	"budget" numeric(18, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"project_id" uuid NOT NULL,
	"budget_item_id" uuid NOT NULL,
	"contract_id" uuid,
	"partner_id" uuid,
	"payee" text DEFAULT '' NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"activity_budget" numeric(18, 2) DEFAULT 0 NOT NULL,
	"previous_execution" numeric(18, 2) DEFAULT 0 NOT NULL,
	"attachment_id" uuid,
	"requested_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_guarantees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"issue_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_invites" (
	"tender_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	CONSTRAINT "tender_invites_tender_id_partner_id_pk" PRIMARY KEY("tender_id","partner_id")
);
--> statement-breakpoint
CREATE TABLE "tender_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"date" date NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"attachment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"budget_item_id" uuid,
	"estimate" numeric(18, 2) DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone,
	"open_to_all" boolean DEFAULT false NOT NULL,
	"technical_weight" integer DEFAULT 70 NOT NULL,
	"standstill_days" integer DEFAULT 7 NOT NULL,
	"attachment_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD CONSTRAINT "logframe_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD CONSTRAINT "logframe_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logframe_items" ADD CONSTRAINT "logframe_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_budget_item_id_logframe_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."logframe_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_guarantees" ADD CONSTRAINT "performance_guarantees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_guarantees" ADD CONSTRAINT "performance_guarantees_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_guarantees" ADD CONSTRAINT "performance_guarantees_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_invites" ADD CONSTRAINT "tender_invites_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_invites" ADD CONSTRAINT "tender_invites_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_stages" ADD CONSTRAINT "tender_stages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_stages" ADD CONSTRAINT "tender_stages_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_stages" ADD CONSTRAINT "tender_stages_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_stages" ADD CONSTRAINT "tender_stages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_budget_item_id_logframe_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."logframe_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bids_tender_partner" ON "bids" USING btree ("tender_id","partner_id");--> statement-breakpoint
CREATE INDEX "amendments_contract" ON "contract_amendments" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_company_number" ON "contracts" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "logframe_project" ON "logframe_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "logframe_parent" ON "logframe_items" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_company_number" ON "payment_vouchers" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "vouchers_budget_item" ON "payment_vouchers" USING btree ("budget_item_id");--> statement-breakpoint
CREATE INDEX "guarantees_contract" ON "performance_guarantees" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_stages_unique" ON "tender_stages" USING btree ("tender_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "tenders_company_number" ON "tenders" USING btree ("company_id","number");