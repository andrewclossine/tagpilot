CREATE TABLE "user_signatures" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"image" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voucher_steps" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;