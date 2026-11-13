import type { Database } from "@/db/types";
import { addMinutes, type Interval } from "@/lib/scheduling/intervals";
import { pickSuggestedSlots } from "@/lib/scheduling/suggest";
import { busyLoadRange, getBookingCalendar, getPublicEventType } from "./booking";
import { CalendarUnavailableError, type ExternalBusy } from "./calendar/busy";
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
  | { ok: false; error: "not_found" | "inactive" | "calendar_unavailable" };

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
  /** The host's calendar, so suggested times avoid their own meetings (cached is fine: the guest still books live). */
  calendar?: ExternalBusy,
): Promise<SuggestResult> {
  const owned = await getEventType(db, host.id, eventTypeId);
  if (!owned) return { ok: false, error: "not_found" };
  // Switched off = guests can't book it, so don't invite them to.
  const eventType = owned.isActive ? await getPublicEventType(db, host.username, owned.slug) : null;
  if (!eventType) return { ok: false, error: "inactive" };

  const range = { start: now, end: addMinutes(now, SUGGEST_DAYS * 24 * 60) };
  let externalBusy: Interval[] = [];
  try {
    externalBusy = (await calendar?.busyTimes(host.id, busyLoadRange(range), "cached")) ?? [];
  } catch (error) {
    if (error instanceof CalendarUnavailableError) return { ok: false, error: "calendar_unavailable" };
    throw error;
  }
  const { slots } = await getBookingCalendar(db, eventType, range, now, { externalBusy });
  return {
    ok: true,
    slots: pickSuggestedSlots(slots, recipientZone),
    eventType: { title: eventType.title, slug: eventType.slug, durationMinutes: eventType.durationMinutes },
    hostTimeZone: eventType.hostTimeZone,
  };
}
