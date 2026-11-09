import type { Database } from "@/db/types";
import { addMinutes, type Interval } from "@/lib/scheduling/intervals";
import { pickSuggestedSlots } from "@/lib/scheduling/suggest";
import { getBookingCalendar, getPublicEventType } from "./booking";
import { getEventType } from "./event-types";

/** How far ahead "share times by text" looks. Two weeks: soon enough to be useful in an email thread. */
export const SUGGEST_DAYS = 14;

export type SuggestResult =
  | {
      ok: true;
      slots: Interval[];
      eventType: { title: string; slug: string; durationMinutes: number };
      hostTimeZone: string;
    }
  | { ok: false; error: "not_found" | "inactive" };

/**
 * Three free times for one of the host's event types, chosen for a recipient
 * in `recipientZone`. Uses the same calendar as the booking page (rules,
 * overrides, existing bookings, buffers, notice), so every suggested time is
 * genuinely bookable right now.
 *
 * Scoped like everything host-side: the event type must belong to `host.id`,
 * so knowing another host's event type id gets "not_found".
 */
export async function suggestTimes(
  db: Database,
  host: { id: string; username: string },
  eventTypeId: string,
  recipientZone: string,
  now: Date,
): Promise<SuggestResult> {
  const owned = await getEventType(db, host.id, eventTypeId);
  if (!owned) return { ok: false, error: "not_found" };
  // Switched off = guests can't book it, so don't invite them to.
  const eventType = owned.isActive ? await getPublicEventType(db, host.username, owned.slug) : null;
  if (!eventType) return { ok: false, error: "inactive" };

  const { slots } = await getBookingCalendar(
    db,
    eventType,
    { start: now, end: addMinutes(now, SUGGEST_DAYS * 24 * 60) },
    now,
  );
  return {
    ok: true,
    slots: pickSuggestedSlots(slots, recipientZone),
    eventType: { title: eventType.title, slug: eventType.slug, durationMinutes: eventType.durationMinutes },
    hostTimeZone: eventType.hostTimeZone,
  };
}
