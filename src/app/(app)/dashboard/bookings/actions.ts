"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { requireOnboardedUser } from "@/server/auth/session";
import { calendarBusy, calendarSync } from "@/server/calendar";
import { jobs } from "@/server/jobs";
import { cancelBookingAsHost, rescheduleBookingAsHost, setNoShow } from "@/server/manage-booking";

const schema = z.object({
  bookingId: z.string().max(64),
  reason: z
    .string()
    .trim()
    .max(500)
    .transform((r) => r || null),
});

/** Host cancels a booking: session user -> validate -> scoped write -> email the guest after. */
export async function cancelBookingAsHostAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOnboardedUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  const result = await cancelBookingAsHost(
    db,
    user.id,
    parsed.data.bookingId,
    parsed.data.reason,
    new Date(),
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "not_changeable" ? "Too late to cancel this one" : "Booking not found",
    };
  }

  const { bookingId } = parsed.data;
  // Background job (Day 17): removes the Google Calendar event, then emails the guest.
  after(() => jobs.bookingChanged({ bookingId, change: "cancelled", sequence: result.sequence }));
  refresh();
  return { ok: true };
}

/**
 * "Retry" on a booking marked "Not in Google Calendar" (Day 16). The same
 * sync that runs after booking: it makes Google match the booking as it is
 * now (create, move or delete), so retrying is always safe.
 */
export async function retryCalendarSyncAction(bookingId: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOnboardedUser();
  const parsed = z.uuid().safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: "Booking not found" };
  // Scoped to this host: another host's booking id looks exactly like a missing one.
  const [own] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, parsed.data), eq(bookings.hostId, user.id)));
  if (!own) return { ok: false, error: "Booking not found" };

  const outcome = await calendarSync.syncBooking(own.id);
  refresh();
  if (outcome === "synced") return { ok: true };
  return {
    ok: false,
    error:
      outcome === "skipped"
        ? "Google Calendar isn't connected. Connect it on the Availability page."
        : "Google Calendar didn't accept it. Try again in a minute, or check the connection on the Availability page.",
  };
}

const noShowSchema = z.object({ bookingId: z.uuid(), noShow: z.boolean() });

/**
 * Day 25: "Didn't show up" on a past meeting, or Undo. Session user -> validate
 * -> scoped write. No email and no background job: it changes nothing outside
 * MeetReady, only the host's records (and Insights' no-show rate).
 */
export async function setNoShowAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOnboardedUser();
  const parsed = noShowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Booking not found" };
  const result = await setNoShow(db, user.id, parsed.data.bookingId, parsed.data.noShow, new Date());
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "not_changeable"
          ? "Only a meeting that has ended can be marked"
          : "Booking not found",
    };
  }
  refresh();
  return { ok: true };
}

const moveSchema = z.object({
  bookingId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
});

export type MoveResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid" | "not_found" | "not_changeable" | "slot_unavailable" | "calendar_unavailable";
    };

/**
 * Day 25, the Move button: the host moves one of their bookings. Session user
 * -> validate -> rescheduleBookingAsHost (the same core, rules and race
 * protection as a guest's reschedule, Day 24) -> background job. The job
 * moves the Google event and emails only the guest ("Sakif moved your
 * meeting"): the host did it themselves, so there's no receipt.
 */
export async function moveBookingAsHostAction(input: unknown): Promise<MoveResult> {
  const user = await requireOnboardedUser();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { bookingId, startsAt } = parsed.data;
  const result = await rescheduleBookingAsHost(db, user.id, bookingId, startsAt, new Date(), {
    calendar: calendarBusy, // Google read live, fail closed, like every other move
  });
  if (!result.ok) {
    return { ok: false, error: result.error === "slot_taken" ? "slot_unavailable" : result.error };
  }
  after(() =>
    jobs.bookingChanged({
      bookingId,
      change: "rescheduled",
      sequence: result.sequence,
      previousStartsAt: result.previousStartsAt,
    }),
  );
  return { ok: true };
}
