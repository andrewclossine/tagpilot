CREATE TABLE "achievement_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"schedule" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "achievement_reports" ADD CONSTRAINT "achievement_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_reports" ADD CONSTRAINT "achievement_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_reports" ADD CONSTRAINT "achievement_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievement_reports_project" ON "achievement_reports" USING btree ("project_id","period_from");--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_report_id_achievement_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."achievement_reports"("id") ON DELETE cascade ON UPDATE no action;