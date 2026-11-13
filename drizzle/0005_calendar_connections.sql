CREATE TYPE "public"."calendar_error" AS ENUM('access_lost', 'unavailable');--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"last_error" "calendar_error",
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_error_check" CHECK (("calendar_connections"."last_error" is null) = ("calendar_connections"."last_error_at" is null))
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;