CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"kind" text DEFAULT 'stock' NOT NULL,
	"sale_price" numeric(18, 2) DEFAULT 0 NOT NULL,
	"purchase_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"inventory_account" text DEFAULT '1300' NOT NULL,
	"income_account" text DEFAULT '4100' NOT NULL,
	"cogs_account" text DEFAULT '5100' NOT NULL,
	"expense_account" text DEFAULT '6900' NOT NULL,
	"reorder_level" numeric(18, 3) DEFAULT 0 NOT NULL,
	"qty_on_hand" numeric(18, 3) DEFAULT 0 NOT NULL,
	"avg_cost" numeric(18, 4) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric(18, 3) DEFAULT 0 NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT 0 NOT NULL,
	"value" numeric(18, 2) DEFAULT 0 NOT NULL,
	"qty_after" numeric(18, 3) DEFAULT 0 NOT NULL,
	"avg_cost_after" numeric(18, 4) DEFAULT 0 NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"entry_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_company_sku" ON "items" USING btree ("company_id","sku");--> statement-breakpoint
CREATE INDEX "stock_moves_item" ON "stock_moves" USING btree ("item_id","date");--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;