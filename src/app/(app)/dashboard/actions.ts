"use server";

import { z } from "zod";
import { db } from "@/db";
import { timeZoneSchema } from "@/lib/validation/onboarding";
import { requireOnboardedUser } from "@/server/auth/session";
import { calendarBusy } from "@/server/calendar";
import { suggestTimes } from "@/server/share";

/*
 * Same rules as every server action (they're public HTTP endpoints): the host
 * comes from the session, the arguments are re-validated, and the data layer
 * checks that the event type belongs to that host.
 */
const inputSchema = z.object({ eventTypeId: z.string().max(100), timeZone: timeZoneSchema });

export type SuggestTimesResult =
  | {
      ok: true;
      slots: { start: string; end: string }[];
      eventType: { title: string; slug: string; durationMinutes: number };
      hostTimeZone: string;
      bookingPath: string;
    }
  | { ok: false; error: string };

export async function suggestTimesAction(input: unknown): Promise<SuggestTimesResult> {
  const user = await requireOnboardedUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a meeting type and a valid timezone." };

  const r = await suggestTimes(
    db,
    user,
    parsed.data.eventTypeId,
    parsed.data.timeZone,
    new Date(),
    calendarBusy,
  );
  if (!r.ok)
    return {
      ok: false,
      error:
        r.error === "inactive"
          ? "That meeting type is switched off. Turn it on first."
          : r.error === "calendar_unavailable"
            ? "Couldn't read your Google Calendar just now, so these times might clash with your meetings. Try again in a minute, or check the connection on the Availability page."
            : "Meeting type not found.",
    };
  return {
    ok: true,
    slots: r.slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    eventType: r.eventType,
    hostTimeZone: r.hostTimeZone,
    bookingPath: `/${user.username}/${r.eventType.slug}`,
  };
}
