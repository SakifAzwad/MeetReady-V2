-- Booking management: guest manage links, who cancelled, reschedules, invite versions.
--
-- Hand-edited after drizzle-kit generate: the generated
--   ADD COLUMN "manage_token_hash" text NOT NULL
-- fails on any database that already has bookings (no value for existing
-- rows). So: add it nullable, fill existing rows with a random hash (those
-- old bookings simply have no working manage link, since nobody holds a
-- matching token), then make it NOT NULL. The end state matches schema.ts.
CREATE TYPE "public"."cancelled_by" AS ENUM('host', 'guest');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_by" "cancelled_by";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "manage_token_hash" text;--> statement-breakpoint
UPDATE "bookings" SET "manage_token_hash" = encode(sha256(gen_random_uuid()::text::bytea), 'hex') WHERE "manage_token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "manage_token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rescheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_manage_token_hash_unique" UNIQUE("manage_token_hash");--> statement-breakpoint
-- Any booking cancelled by hand before this constraint existed gets a cancelled_at.
UPDATE "bookings" SET "cancelled_at" = "updated_at" WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancellation_check" CHECK (("bookings"."status" = 'cancelled') = ("bookings"."cancelled_at" is not null));
