CREATE TABLE "esign_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ordered" boolean DEFAULT true NOT NULL,
	"original_attachment_id" uuid NOT NULL,
	"original_hash" text NOT NULL,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_attachment_id" uuid,
	"final_hash" text,
	"void_reason" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "esign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esign_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision NOT NULL,
	"h" double precision NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esign_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"order" integer DEFAULT 1 NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"signature" text,
	"initials" text DEFAULT '' NOT NULL,
	"decline_reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dynamic" boolean DEFAULT true NOT NULL,
	"slug" text NOT NULL,
	"style" jsonb NOT NULL,
	"file_attachment_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"os" text DEFAULT '' NOT NULL,
	"browser" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "esign_documents" ADD CONSTRAINT "esign_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_documents" ADD CONSTRAINT "esign_documents_original_attachment_id_attachments_id_fk" FOREIGN KEY ("original_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_documents" ADD CONSTRAINT "esign_documents_final_attachment_id_attachments_id_fk" FOREIGN KEY ("final_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_documents" ADD CONSTRAINT "esign_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_signer_id_esign_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."esign_signers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_signer_id_esign_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."esign_signers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esign_signers" ADD CONSTRAINT "esign_signers_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_file_attachment_id_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_code_id_qr_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."qr_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "esign_documents_number" ON "esign_documents" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "esign_documents_company" ON "esign_documents" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "esign_events_document" ON "esign_events" USING btree ("document_id","at");--> statement-breakpoint
CREATE INDEX "esign_fields_document" ON "esign_fields" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "esign_signers_token" ON "esign_signers" USING btree ("token");--> statement-breakpoint
CREATE INDEX "esign_signers_document" ON "esign_signers" USING btree ("document_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_codes_slug" ON "qr_codes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "qr_codes_company" ON "qr_codes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "qr_scans_code" ON "qr_scans" USING btree ("code_id","at");