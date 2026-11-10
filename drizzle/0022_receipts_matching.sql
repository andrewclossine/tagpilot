CREATE TABLE "notice_log" (
	"key" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"received" numeric(18, 3) NOT NULL,
	"accepted" numeric(18, 3) NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"delivery_note" text DEFAULT '' NOT NULL,
	"checks" jsonb NOT NULL,
	"defects" text DEFAULT '' NOT NULL,
	"attachment_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"void_note" text DEFAULT '' NOT NULL,
	"received_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "require_receipt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_receipt_lines" ADD CONSTRAINT "order_receipt_lines_receipt_id_order_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."order_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_receipt_lines" ADD CONSTRAINT "order_receipt_lines_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_receipts" ADD CONSTRAINT "order_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_receipts" ADD CONSTRAINT "order_receipts_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_receipts" ADD CONSTRAINT "order_receipts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_receipts" ADD CONSTRAINT "order_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_receipt_lines_line" ON "order_receipt_lines" USING btree ("line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_receipts_company_number" ON "order_receipts" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "order_receipts_order" ON "order_receipts" USING btree ("order_id");