import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { slotsQuerySchema } from "@/lib/validation/booking";
import { getBookableSlots, getPublicEventType } from "@/server/booking";
import { getBookingByToken } from "@/server/manage-booking";

/**
 * GET /api/slots?username=sakif&slug=intro&from=<ISO>&to=<ISO>
 * -> { slots: [{ start, end }] } as UTC ISO strings.
 *
 * A route handler, not a server action: reads should be GET (cacheable,
 * can run in parallel, safe to retry). Server actions are POST and queue
 * one after another. Public: no session; only active event types of
 * onboarded hosts are visible.
 */
export async function GET(request: NextRequest) {
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

  const slots = await getBookableSlots(db, eventType, { start: from, end: to }, new Date(), {
    excludeBookingId,
  });
  return Response.json(
    { slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) },
    // Availability changes with every booking; never serve a stale copy.
    { headers: { "Cache-Control": "no-store" } },
  );
}
