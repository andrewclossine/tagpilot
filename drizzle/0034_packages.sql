ALTER TABLE "companies" ADD COLUMN "tiers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "paid_tiers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "seats" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "paid_seats" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "storage_tier" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "paid_storage_tier" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "tiers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "seats" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "storage_tier" text DEFAULT 'free' NOT NULL;