CREATE TYPE "public"."reminder_kind" AS ENUM('day', 'hour');--> statement-breakpoint
CREATE TABLE "booking_reminders" (
	"booking_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_reminders_booking_id_kind_starts_at_pk" PRIMARY KEY("booking_id","kind","starts_at")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "manage_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_confirmed_starts_at_idx" ON "bookings" USING btree ("starts_at") WHERE status = 'confirmed';