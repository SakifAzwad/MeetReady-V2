"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { requireOnboardedUser } from "@/server/auth/session";
import { emailContext } from "@/server/email";
import { notifyBookingCancelled } from "@/server/email/notifications";
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

  after(() => notifyBookingCancelled(emailContext(), parsed.data.bookingId));
  refresh();
  return { ok: true };
}
