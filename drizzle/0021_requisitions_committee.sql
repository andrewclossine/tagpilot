CREATE TABLE "bid_items" (
	"bid_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT 0 NOT NULL,
	CONSTRAINT "bid_items_bid_id_item_id_pk" PRIMARY KEY("bid_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "committee_scores" (
	"tender_id" uuid NOT NULL,
	"bid_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"points" numeric(6, 2) NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	CONSTRAINT "committee_scores_bid_id_user_id_criterion_id_pk" PRIMARY KEY("bid_id","user_id","criterion_id")
);
--> statement-breakpoint
CREATE TABLE "requisition_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"min_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"approver_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisition_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisition_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"name" text NOT NULL,
	"approver_id" uuid NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"justification" text DEFAULT '' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"budget_item_id" uuid,
	"needed_by" date,
	"total" numeric(18, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"tender_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_committee" (
	"tender_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_chair" boolean DEFAULT false NOT NULL,
	"declared_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "tender_committee_tender_id_user_id_pk" PRIMARY KEY("tender_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tender_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"max_points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity" numeric(18, 3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenders" ADD COLUMN "award_approver_id" uuid;--> statement-breakpoint
ALTER TABLE "tenders" ADD COLUMN "award_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenders" ADD COLUMN "award_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bid_items" ADD CONSTRAINT "bid_items_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_items" ADD CONSTRAINT "bid_items_item_id_tender_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tender_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_scores" ADD CONSTRAINT "committee_scores_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_scores" ADD CONSTRAINT "committee_scores_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_scores" ADD CONSTRAINT "committee_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_scores" ADD CONSTRAINT "committee_scores_criterion_id_tender_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."tender_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_levels" ADD CONSTRAINT "requisition_levels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_levels" ADD CONSTRAINT "requisition_levels_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_steps" ADD CONSTRAINT "requisition_steps_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_steps" ADD CONSTRAINT "requisition_steps_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_budget_item_id_logframe_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."logframe_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_committee" ADD CONSTRAINT "tender_committee_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_committee" ADD CONSTRAINT "tender_committee_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_criteria" ADD CONSTRAINT "tender_criteria_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_criteria" ADD CONSTRAINT "tender_criteria_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_items" ADD CONSTRAINT "tender_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_items" ADD CONSTRAINT "tender_items_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requisition_levels_company" ON "requisition_levels" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "requisition_lines_req" ON "requisition_lines" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "requisition_steps_req" ON "requisition_steps" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "requisition_steps_approver" ON "requisition_steps" USING btree ("approver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requisitions_company_number" ON "requisitions" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "requisitions_requested_by" ON "requisitions" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "tender_criteria_tender" ON "tender_criteria" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX "tender_items_tender" ON "tender_items" USING btree ("tender_id");--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_award_approver_id_users_id_fk" FOREIGN KEY ("award_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;