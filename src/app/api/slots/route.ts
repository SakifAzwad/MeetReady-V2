import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { slotsQuerySchema } from "@/lib/validation/booking";
import { getBookingCalendar, getPublicEventType } from "@/server/booking";
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
  if (reschedule) {
    const own = await getBookingByToken(db, reschedule);
    if (own && own.eventTypeId === eventType.id && own.status === "confirmed") excludeBookingId = own.id;
  }

  const { slots, windows } = await getBookingCalendar(db, eventType, { start: from, end: to }, new Date(), {
    excludeBookingId,
  });
  const iso = (i: { start: Date; end: Date }) => ({ start: i.start.toISOString(), end: i.end.toISOString() });
  return Response.json(
    // windows: the host's working hours (for the daylight band), not free time.
    { slots: slots.map(iso), windows: windows.map(iso) },
    // Availability changes with every booking; never serve a stale copy.
    { headers: { "Cache-Control": "no-store" } },
  );
}
