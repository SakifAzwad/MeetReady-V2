"use server";

import { after } from "next/server";
import { db } from "@/db";
import { cancelRequestSchema, rescheduleRequestSchema } from "@/lib/validation/booking";
import { emailContext } from "@/server/email";
import { notifyBookingCancelled, notifyBookingRescheduled } from "@/server/email/notifications";
import { cancelBookingByToken, rescheduleBookingByToken } from "@/server/manage-booking";
import { calendarBusy } from "@/server/calendar";
import { rateLimit } from "@/server/rate-limit";

/*
 * Guest actions. No login: the manage token from the email IS the
 * authorisation, and it only ever reaches one booking (WHERE token hash = …).
 *
 * Rate limit (Day 14): 10 changes per hour per token, cancel and reschedule
 * together. Each change emails the host, so a leaked or scripted link could
 * otherwise flood their inbox. Keyed by token, not IP: that's the thing being
 * abused, and guessing tokens isn't a risk (256 random bits).
 */

export type ManageActionResult =
  | { ok: true; startsAt?: string; endsAt?: string }
  | { ok: false; error: "not_found" | "not_changeable" | "slot_unavailable" | "invalid" }
  /** The host's Google Calendar couldn't be checked, so the new time can't be confirmed yet. */
  | { ok: false; error: "calendar_unavailable" }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

export async function cancelByTokenAction(input: unknown): Promise<ManageActionResult> {
  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const limited = await rateLimit([["manage", parsed.data.token]]);
  if (!limited.ok) return { ok: false, error: "rate_limited", retryAfterSeconds: limited.retryAfterSeconds };

  const result = await cancelBookingByToken(db, parsed.data.token, parsed.data.reason, new Date());
  if (!result.ok) return result;

  after(() => notifyBookingCancelled(emailContext(), result.bookingId));
  return { ok: true };
}

export async function rescheduleByTokenAction(input: unknown): Promise<ManageActionResult> {
  const parsed = rescheduleRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { token, startsAt } = parsed.data;
  const limited = await rateLimit([["manage", token]]);
  if (!limited.ok) return { ok: false, error: "rate_limited", retryAfterSeconds: limited.retryAfterSeconds };

  const result = await rescheduleBookingByToken(db, token, startsAt, new Date(), {
    calendar: calendarBusy,
  });
  if (!result.ok) {
    return { ok: false, error: result.error === "slot_taken" ? "slot_unavailable" : result.error };
  }

  after(() => notifyBookingRescheduled(emailContext(), result.bookingId, result.previousStartsAt, token));
  return { ok: true, startsAt: startsAt.toISOString() };
}
