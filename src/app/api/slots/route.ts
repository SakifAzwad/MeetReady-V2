import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { subtractInterval } from "@/lib/scheduling/intervals";
import { slotsQuerySchema } from "@/lib/validation/booking";
import { busyLoadRange, getBookingCalendar, getPublicEventType } from "@/server/booking";
import { CalendarUnavailableError, calendarBusy } from "@/server/calendar";
import { getBookingByToken } from "@/server/manage-booking";
import { ipOf, rateLimit, tooManyRequests } from "@/server/rate-limit";

/**
 * GET /api/slots?username=sakif&slug=intro&from=<ISO>&to=<ISO>
 * -> { slots: [{ start, end }], windows: [{ start, end }] } as UTC ISO strings.
 *
 * A route handler, not a server action: reads should be GET (cacheable,
 * can run in parallel, safe to retry). Server actions are POST and queue
 * one after another. Public: no session; only active event types of
 * onboarded hosts are visible.
 *
 * Rate limit (Day 14): 60 per minute per IP, checked first. Each call
 * computes a month of availability; a page load makes one or two.
 */
export async function GET(request: NextRequest) {
  const limited = await rateLimit([["slots", ipOf(request.headers)]]);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSeconds);

  const parsed = slotsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json({ error: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const { username, slug, from, to, reschedule } = parsed.data;

  const eventType = await getPublicEventType(db, username, slug);
  if (!eventType) return Response.json({ error: "Not found" }, { status: 404 });

  // Rescheduling: the guest's own booking (proved by its token, and only if it
  // belongs to this event type) mustn't block the times around it.
  let excludeBookingId: string | undefined;
  let ownTime: { start: Date; end: Date } | undefined;
  if (reschedule) {
    const own = await getBookingByToken(db, reschedule);
    if (own && own.eventTypeId === eventType.id && own.status === "confirmed") {
      excludeBookingId = own.id;
      ownTime = { start: own.startsAt, end: own.endsAt };
    }
  }

  // The host's Google Calendar (Day 15): cached for a minute, or up to an hour old if Google is
  // failing. Showing slightly old times is fine: booking re-checks Google live.
  const range = { start: from, end: to };
  let externalBusy;
  try {
    externalBusy = await calendarBusy.busyTimes(eventType.hostId, busyLoadRange(range), "cached");
    // Its own Google Calendar event (Day 16) mustn't block the times around it either.
    if (ownTime) externalBusy = subtractInterval(externalBusy, ownTime);
  } catch (error) {
    if (!(error instanceof CalendarUnavailableError)) throw error;
    // No usable copy at all: showing times we can't check would only lead to refused bookings.
    return Response.json(
      { error: "Calendar unavailable" },
      { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } },
    );
  }

  const { slots, windows } = await getBookingCalendar(db, eventType, range, new Date(), {
    excludeBookingId,
    externalBusy,
  });
  const iso = (i: { start: Date; end: Date }) => ({ start: i.start.toISOString(), end: i.end.toISOString() });
  return Response.json(
    // windows: the host's working hours (for the daylight band), not free time.
    { slots: slots.map(iso), windows: windows.map(iso) },
    // Availability changes with every booking; never serve a stale copy.
    { headers: { "Cache-Control": "no-store" } },
  );
}
