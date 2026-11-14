import { eq } from "drizzle-orm";
import { account, bookings, calendarConnections, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { saveWeeklySchedule } from "@/server/availability";
import { createBooking } from "@/server/booking";
import { createEventType } from "@/server/event-types";
import { sealManageToken } from "@/server/manage-token";

/*
 * A host with bookable event types, for tests of what happens AFTER booking
 * (jobs, reminders). Host "sakif" in Dhaka, available every day 00:00–24:00
 * local, so any start on the hour or half hour can be booked. Event types:
 * "intro" (30 min, Google Meet) and "deep" (60 min, Zoom).
 */

export const SECRET = "test-secret-test-secret-test-secret-00";
export const APP = "https://meetready.test";

export async function setupHost(db: Database) {
  await db.insert(user).values({
    id: "host",
    name: "Sakif Azwad",
    email: "sakif@example.com",
    username: "sakif",
    timeZone: "Asia/Dhaka",
  });
  await saveWeeklySchedule(db, "host", {
    timeZone: "Asia/Dhaka",
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "00:00", endTime: "23:30" })),
  });
  for (const [slug, durationMinutes, locationType] of [
    ["intro", 30, "google_meet"],
    ["deep", 60, "zoom"],
  ] as const) {
    const r = await createEventType(
      db,
      "host",
      eventTypeSchema.parse({
        ...EVENT_TYPE_DEFAULTS,
        title: slug === "intro" ? "Intro call" : "Deep dive",
        slug,
        durationMinutes,
        slotIntervalMinutes: 30,
        locationType,
        locationValue: locationType === "zoom" ? "https://us05web.zoom.us/j/123" : "",
        minimumNoticeMinutes: 0,
        bookingWindowDays: null,
      }),
    );
    if (!r.ok) throw new Error("setup failed");
  }
}

export async function connectCalendar(db: Database) {
  await db.insert(account).values({ id: "acc", accountId: "sub", providerId: "google", userId: "host" });
  await db.insert(calendarConnections).values({ userId: "host", accountId: "acc" });
}

/**
 * Books `slug` at `startsAt`, as if done at `bookedAt` (also stored as
 * created_at: the database would otherwise use the real clock).
 */
export async function book(
  db: Database,
  startsAt: Date,
  bookedAt: Date,
  opts: { slug?: string; guestEmail?: string; seal?: boolean } = {},
) {
  const r = await createBooking(
    db,
    {
      username: "sakif",
      slug: opts.slug ?? "intro",
      startsAt,
      guestName: "Ada",
      guestEmail: opts.guestEmail ?? "ada@example.com",
      guestTimeZone: "Europe/London",
      guestNotes: "Private notes for the host",
    },
    bookedAt,
    { sealToken: opts.seal === false ? undefined : (token, id) => sealManageToken(token, id, SECRET) },
  );
  if (!r.ok) throw new Error(`setup failed: ${r.error}`);
  await db.update(bookings).set({ createdAt: bookedAt }).where(eq(bookings.id, r.booking.id));
  return r;
}
