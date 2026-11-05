CREATE TABLE "purchase_order_billings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 3) DEFAULT 1 NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat_applies" boolean DEFAULT true NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"expected_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"close_note" text DEFAULT '' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat" numeric(18, 2) DEFAULT 0 NOT NULL,
	"total" numeric(18, 2) DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"issued_by" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_billings" ADD CONSTRAINT "purchase_order_billings_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_billings" ADD CONSTRAINT "purchase_order_billings_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_billings_line" ON "purchase_order_billings" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "po_billings_bill" ON "purchase_order_billings" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "po_lines_order" ON "purchase_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_company_number" ON "purchase_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_project" ON "purchase_orders" USING btree ("project_id");