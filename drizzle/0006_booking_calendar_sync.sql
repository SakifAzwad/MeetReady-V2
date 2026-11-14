CREATE TYPE "public"."calendar_sync" AS ENUM('synced', 'failed');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meet_url" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_sync" "calendar_sync";