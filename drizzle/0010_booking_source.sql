CREATE TYPE "public"."booking_source" AS ENUM('booking_page', 'assistant');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "source" "booking_source" DEFAULT 'booking_page' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "created_by_client" text;