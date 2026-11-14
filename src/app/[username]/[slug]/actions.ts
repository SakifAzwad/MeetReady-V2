"use server";

import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { bookingRequestSchema, type GuestDetailsForm } from "@/lib/validation/booking";
import type { Question } from "@/lib/validation/questions";
import { createBooking } from "@/server/booking";
import { calendarBusy } from "@/server/calendar";
import { jobs } from "@/server/jobs";
import { sealToken } from "@/server/manage-link";
import { actionIp, emailBucket, rateLimit } from "@/server/rate-limit";

export type BookSlotResult =
  | { ok: true; booking: { startsAt: string; endsAt: string } }
  | { ok: false; error: "slot_unavailable" | "not_found" }
  /** The host's Google Calendar couldn't be checked: nothing was booked, the guest retries (Day 15). */
  | { ok: false; error: "calendar_unavailable" }
  /** Too many attempts (per IP, or per guest email): the form keeps what was typed. */
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number }
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
 * Rate limits (Day 14), checked before any database work:
 *  - per IP, on every attempt, even malformed ones: a script filling a host's
 *    calendar, or just hammering the endpoint;
 *  - per guest email (after parsing, once there is a valid one): emailing one
 *    person over and over from many IPs. Plus-addressed variants count as one.
 */
export async function bookSlotAction(input: unknown): Promise<BookSlotResult> {
  const byIp = await rateLimit([["book_ip", await actionIp()]]);
  if (!byIp.ok) return { ok: false, error: "rate_limited", retryAfterSeconds: byIp.retryAfterSeconds };

  const parsed = bookingRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const byEmail = await rateLimit([["book_email", emailBucket(parsed.data.guestEmail)]]);
  if (!byEmail.ok) return { ok: false, error: "rate_limited", retryAfterSeconds: byEmail.retryAfterSeconds };

  const result = await createBooking(db, parsed.data, new Date(), { calendar: calendarBusy, sealToken });
  if (!result.ok && result.error === "invalid_answers") {
    return { ok: false, error: "invalid", fieldErrors: {}, answerErrors: result.answerErrors };
  }
  if (!result.ok && result.error === "questions_changed") {
    const { questions, questionsVersion } = result;
    return { ok: false, error: "questions_changed", questions, questionsVersion };
  }
  if (!result.ok && result.error === "calendar_unavailable")
    return { ok: false, error: "calendar_unavailable" };
  if (!result.ok) {
    // "slot_taken" (lost a race at the database) and "slot_unavailable" (failed
    // the re-check) mean the same thing to a guest: pick another time.
    return { ok: false, error: result.error === "not_found" ? "not_found" : "slot_unavailable" };
  }

  // Google Calendar and the emails run AFTER the response is sent, as a
  // background job (Day 17, src/server/jobs): the guest sees "You're booked"
  // without waiting, a failed email can't undo a committed booking, and the
  // job queue retries what fails. The job gets the booking id, nothing else:
  // it reads the rest (and decrypts the manage link) when it runs.
  const { id } = result.booking;
  after(() => jobs.bookingChanged({ bookingId: id, change: "created", sequence: 0 }));

  return {
    ok: true,
    booking: { startsAt: result.booking.startsAt.toISOString(), endsAt: result.booking.endsAt.toISOString() },
  };
}
