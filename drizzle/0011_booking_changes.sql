ALTER TABLE "bookings" ADD COLUMN "rescheduled_by" "cancelled_by";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "changed_by_client" text;