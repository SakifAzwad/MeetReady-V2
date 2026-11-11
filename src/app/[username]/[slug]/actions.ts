"use server";

import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { bookingRequestSchema, type GuestDetailsForm } from "@/lib/validation/booking";
import type { Question } from "@/lib/validation/questions";
import { createBooking } from "@/server/booking";
import { emailContext } from "@/server/email";
import { notifyBookingConfirmed } from "@/server/email/notifications";

export type BookSlotResult =
  | { ok: true; booking: { startsAt: string; endsAt: string } }
  | { ok: false; error: "slot_unavailable" | "not_found" }
  | {
      ok: false;
      error: "invalid";
      fieldErrors: Partial<Record<keyof GuestDetailsForm, string[]>>;
      /** First message per question id. */
      answerErrors?: Record<string, string>;
    }
  /** The host changed the questions while the guest typed: the form rebuilds from these. */
  | { ok: false; error: "questions_changed"; questions: Question[]; questionsVersion: string };

/*
 * Public action: guests have no account. Everything in `input` is untrusted,
 * so it's parsed with the same schema the form uses, and createBooking()
 * re-checks the time against the host's live availability under a lock.
 *
 * TODO (later): rate-limit by IP with Upstash before this goes public, so a
 * script can't fill a host's calendar.
 */
export async function bookSlotAction(input: unknown): Promise<BookSlotResult> {
  const parsed = bookingRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const result = await createBooking(db, parsed.data, new Date());
  if (!result.ok && result.error === "invalid_answers") {
    return { ok: false, error: "invalid", fieldErrors: {}, answerErrors: result.answerErrors };
  }
  if (!result.ok && result.error === "questions_changed") {
    const { questions, questionsVersion } = result;
    return { ok: false, error: "questions_changed", questions, questionsVersion };
  }
  if (!result.ok) {
    // "slot_taken" (lost a race at the database) and "slot_unavailable" (failed
    // the re-check) mean the same thing to a guest: pick another time.
    return { ok: false, error: result.error === "not_found" ? "not_found" : "slot_unavailable" };
  }

  // Emails go out AFTER the response is sent: the guest sees "You're booked"
  // without waiting on the mail provider, and a failed email can't undo a
  // committed booking. (A job queue with retries comes with Inngest later.)
  const { id } = result.booking;
  const { manageToken } = result;
  after(() => notifyBookingConfirmed(emailContext(), id, manageToken));

  return {
    ok: true,
    booking: { startsAt: result.booking.startsAt.toISOString(), endsAt: result.booking.endsAt.toISOString() },
  };
}
