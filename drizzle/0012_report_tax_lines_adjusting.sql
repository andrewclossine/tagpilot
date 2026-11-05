ALTER TABLE "accounts" ADD COLUMN "tax_line" text;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "is_adjusting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "journal_entries" SET "is_adjusting" = true WHERE "id" IN (SELECT "entry_id" FROM "asset_movements" WHERE "entry_id" IS NOT NULL AND "type" IN ('depreciation', 'impairment', 'revaluation'));
