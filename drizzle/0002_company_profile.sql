ALTER TABLE "companies" ADD COLUMN "org_type" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sector" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email" text DEFAULT '' NOT NULL;