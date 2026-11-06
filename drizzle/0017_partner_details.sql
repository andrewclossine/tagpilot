ALTER TABLE "partners" ADD COLUMN "address2" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "address3" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "website" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "work_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "bank_account" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "payment_terms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "credit_limit" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "tax_code" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "opening_balance" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "opening_date" date;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "opening_doc_id" uuid;