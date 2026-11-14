"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { requireOnboardedUser } from "@/server/auth/session";
import { calendarSync } from "@/server/calendar";
import { jobs } from "@/server/jobs";
import { cancelBookingAsHost } from "@/server/manage-booking";

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
