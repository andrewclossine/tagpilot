CREATE TABLE "bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"quantity" numeric(18, 3) DEFAULT 0 NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT 0 NOT NULL,
	"value" numeric(18, 2) DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(18, 3) DEFAULT 0 NOT NULL,
	"quantity_made" numeric(18, 3) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"planned_date" date NOT NULL,
	"start_date" date,
	"finish_date" date,
	"wip_account" text DEFAULT '1320' NOT NULL,
	"materials_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"conversion_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"start_entry_id" uuid,
	"finish_entry_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_class" text DEFAULT 'goods' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "conversion_cost" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_component_id_items_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_order_id_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_component_id_items_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_start_entry_id_journal_entries_id_fk" FOREIGN KEY ("start_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_finish_entry_id_journal_entries_id_fk" FOREIGN KEY ("finish_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bom_lines_item" ON "bom_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "production_lines_order" ON "production_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_orders_company_number" ON "production_orders" USING btree ("company_id","number");