ALTER TABLE "companies" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "suspended_reason" text DEFAULT '' NOT NULL;