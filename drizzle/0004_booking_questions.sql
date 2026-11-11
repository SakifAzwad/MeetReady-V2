-- Custom booking questions (Day 10): the questions on event types, and a snapshot of the
-- answers on bookings. Both default to an empty array, so existing rows need no backfill.
ALTER TABLE "bookings" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_answers_check" CHECK (jsonb_typeof("bookings"."answers") = 'array');--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_questions_check" CHECK (jsonb_typeof("event_types"."questions") = 'array' and jsonb_array_length("event_types"."questions") <= 10);