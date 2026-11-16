CREATE TABLE "subscription_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'awaiting_details' NOT NULL,
	"token" text NOT NULL,
	"pay_to" text,
	"account_name" text DEFAULT '' NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"bank_code" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"details_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"paid_reference" text DEFAULT '' NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_refunds_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_refunds" ADD CONSTRAINT "subscription_refunds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_refunds" ADD CONSTRAINT "subscription_refunds_payment_id_subscription_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_refunds_company" ON "subscription_refunds" USING btree ("company_id");--> statement-breakpoint
UPDATE "subscription_payments" SET "method" = 'manual' WHERE "tx_ref" LIKE 'manual-%';