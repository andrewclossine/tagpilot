CREATE TABLE "platform_prices" (
	"currency" text NOT NULL,
	"module" text NOT NULL,
	"monthly" numeric(18, 2) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_prices_currency_module_pk" PRIMARY KEY("currency","module")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "temp_password_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;