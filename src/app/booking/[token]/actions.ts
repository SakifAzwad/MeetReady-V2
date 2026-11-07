"use server";

import { after } from "next/server";
import { db } from "@/db";
import { cancelRequestSchema, rescheduleRequestSchema } from "@/lib/validation/booking";
import { emailContext } from "@/server/email";
import { notifyBookingCancelled, notifyBookingRescheduled } from "@/server/email/notifications";
import { cancelBookingByToken, rescheduleBookingByToken } from "@/server/manage-booking";

/*
 * Guest actions. No login: the manage token from the email IS the
 * authorisation, and it only ever reaches one booking (WHERE token hash = …).
 */

export type ManageActionResult =
  | { ok: true; startsAt?: string; endsAt?: string }
  | { ok: false; error: "not_found" | "not_changeable" | "slot_unavailable" | "invalid" };

export async function cancelByTokenAction(input: unknown): Promise<ManageActionResult> {
  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const result = await cancelBookingByToken(db, parsed.data.token, parsed.data.reason, new Date());
  if (!result.ok) return result;

  after(() => notifyBookingCancelled(emailContext(), result.bookingId));
  return { ok: true };
}

export async function rescheduleByTokenAction(input: unknown): Promise<ManageActionResult> {
  const parsed = rescheduleRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { token, startsAt } = parsed.data;

  const result = await rescheduleBookingByToken(db, token, startsAt, new Date());
  if (!result.ok) {
    return { ok: false, error: result.error === "slot_taken" ? "slot_unavailable" : result.error };
  }

  after(() => notifyBookingRescheduled(emailContext(), result.bookingId, result.previousStartsAt, token));
  return { ok: true, startsAt: startsAt.toISOString() };
}
