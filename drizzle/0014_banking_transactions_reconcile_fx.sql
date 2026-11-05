CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT 0 NOT NULL,
	"ending_balance" numeric(18, 2) DEFAULT 0 NOT NULL,
	"cleared_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"partner_id" uuid,
	"payee" text DEFAULT '' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"foreign_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"to_foreign_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"rate" numeric(18, 6) DEFAULT 0 NOT NULL,
	"entry_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "reconciliation_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_rec_account" ON "bank_reconciliations" USING btree ("company_id","account_id","statement_date");--> statement-breakpoint
CREATE INDEX "bank_tx_company_kind" ON "bank_transactions" USING btree ("company_id","kind","date");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_tx_check_number" ON "bank_transactions" USING btree ("account_id","number") WHERE "bank_transactions"."kind" = 'check';