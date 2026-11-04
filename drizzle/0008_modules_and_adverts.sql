ALTER TABLE "companies" ADD COLUMN "modules" jsonb DEFAULT '["accounting","projects","procurement"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "paid_modules" jsonb DEFAULT '["accounting","projects","procurement"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "linked_company_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD COLUMN "payment_reference" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "modules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "partners_linked_company" ON "partners" USING btree ("company_id","linked_company_id");