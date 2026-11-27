import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { subtractInterval } from "@/lib/scheduling/intervals";
import { slotsQuerySchema } from "@/lib/validation/booking";
import {
  busyByHost,
  busyLoadRange,
  eventTypeForBooking,
  getBookingCalendar,
  hostsBusyTimes,
  resolveEventType,
} from "@/server/booking";
import { CalendarUnavailableError, calendarBusy } from "@/server/calendar";
import { getSession } from "@/server/auth/session";
import { getBookingByToken, getHostBookingDetails } from "@/server/manage-booking";
import { ipOf, rateLimit, tooManyRequests } from "@/server/rate-limit";

/**
 * GET /api/slots?username=sakif&slug=intro&from=<ISO>&to=<ISO>
 *     (Day 29: or ?team=acme&slug=demo for a team's collective event type)
 * -> { slots: [{ start, end }], windows: [{ start, end }] } as UTC ISO strings.
 *
 * A route handler, not a server action: reads should be GET (cacheable,
 * can run in parallel, safe to retry). Server actions are POST and queue
 * one after another. Public: no session; only active event types of
 * onboarded hosts are visible. (One exception, Day 25: `move=<bookingId>` reads
 * the session, to let a host's own booking free its time on the Move page.)
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
  const { from, to, reschedule, move } = parsed.data;

  let eventType = await resolveEventType(db, parsed.data);
  if (!eventType) return Response.json({ error: "Not found" }, { status: 404 });

  // Rescheduling: the guest's own booking (proved by its token, and only if it
  // belongs to this event type) mustn't block the times around it.
  let excludeBookingId: string | undefined;
  let ownTime: { start: Date; end: Date } | undefined;
  // Day 25, the host's Move page: the same, but proved by the session. The lookup is scoped to the signed-in
  // user (one of the booking's hosts, Day 30), so anyone else's booking id frees nothing. The session is
  // read only for `move`.
  if (reschedule || move) {
    const session = move ? await getSession() : null;
    const own = reschedule
      ? await getBookingByToken(db, reschedule)
      : session
        ? await getHostBookingDetails(db, session.user.id, move!)
        : null;
    if (own && own.eventTypeId === eventType.id && own.status === "confirmed") {
      excludeBookingId = own.id;
      ownTime = { start: own.startsAt, end: own.endsAt };
      // Day 30: a move needs the MEETING's hosts free, not the event type's current list (someone
      // added to a team event type since isn't in this meeting). Same rule as the move itself.
      eventType = (await eventTypeForBooking(db, own)) ?? eventType;
    }
  }

  // The host's Google Calendar (Day 15): cached for a minute, or up to an hour old if Google is
  // failing. Showing slightly old times is fine: booking re-checks Google live.
  const range = { start: from, end: to };
  // Day 31, round-robin: each host's busy times apart (one host's meeting blocks only them), and a host
  // whose calendar can't be read just sits out: one free host is enough. Nobody readable = 503, as below.
  if (eventType.kind === "round_robin") {
    const { byHost, readable } = await busyByHost(
      calendarBusy,
      eventType.hosts,
      busyLoadRange(range),
      "cached",
    );
    if (readable.length === 0) return calendarUnavailable();
    if (ownTime) for (const [id, busy] of byHost) byHost.set(id, subtractInterval(busy, ownTime));
    const { slots, windows } = await getBookingCalendar(
      db,
      { ...eventType, hosts: readable },
      range,
      new Date(),
      {
        excludeBookingId,
        externalBusyByHost: byHost,
      },
    );
    return slotsResponse(slots, windows);
  }
  let externalBusy;
  try {
    // Day 29: every host's, for a team event type.
    externalBusy = await hostsBusyTimes(calendarBusy, eventType.hosts, busyLoadRange(range), "cached");
    // Its own Google Calendar event (Day 16) mustn't block the times around it either.
    if (ownTime) externalBusy = subtractInterval(externalBusy, ownTime);
  } catch (error) {
    if (!(error instanceof CalendarUnavailableError)) throw error;
    // No usable copy at all: showing times we can't check would only lead to refused bookings.
    return calendarUnavailable();
  }

  const { slots, windows } = await getBookingCalendar(db, eventType, range, new Date(), {
    excludeBookingId,
    externalBusy,
  });
  return slotsResponse(slots, windows);
}

type Span = { start: Date; end: Date };
const iso = (i: Span) => ({ start: i.start.toISOString(), end: i.end.toISOString() });

function slotsResponse(slots: Span[], windows: Span[]) {
  return Response.json(
    // windows: the host's working hours (for the daylight band), not free time.
    { slots: slots.map(iso), windows: windows.map(iso) },
    // Availability changes with every booking; never serve a stale copy.
    { headers: { "Cache-Control": "no-store" } },
  );
}

function calendarUnavailable() {
  return Response.json(
    { error: "Calendar unavailable" },
    { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } },
  );
}
