import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { saveWeeklySchedule } from "@/server/availability";
import { createBooking } from "@/server/booking";
import { createEventType, setEventTypeActive } from "@/server/event-types";
import { APP, book, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { callerFromClaims, runTool } from "./server";
import {
  findFreeTimesTool,
  getBookingTool,
  listBookingsTool,
  listEventTypesTool,
  MAX_LISTED_TIMES,
  type Caller,
  type McpDeps,
} from "./tools";

/*
 * Day 21: the MCP tools on a real (in-memory) Postgres, without an MCP client
 * or a token: the caller is what a verified token would give. The fixture host
 * "sakif" is in Dhaka (UTC+6) and free all day; "now" is Wednesday 18 Nov,
 * 10:00 UTC (16:00 in Dhaka).
 */

const NOW = new Date("2026-11-18T10:00:00Z");
const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const host: Caller = { userId: "host", scopes: new Set(["bookings:read"]) };
const other: Caller = { userId: "other", scopes: new Set(["bookings:read"]) };

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

function deps(over: Partial<McpDeps> = {}): McpDeps {
  return {
    db,
    appUrl: APP,
    busyTimes: vi.fn(async () => []),
    limit: vi.fn(async () => ({ ok: true }) as const),
    now: () => NOW,
    ...over,
  };
}

/** A second host with one booking, to prove nothing of theirs leaks to "sakif" and back. */
async function setupOtherHost() {
  await db.insert(user).values({
    id: "other",
    name: "Grace Hopper",
    email: "grace@example.com",
    username: "grace",
    timeZone: "America/New_York",
  });
  await saveWeeklySchedule(db, "other", {
    timeZone: "America/New_York",
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "00:00", endTime: "23:30" })),
  });
  const r = await createEventType(
    db,
    "other",
    eventTypeSchema.parse({
      ...EVENT_TYPE_DEFAULTS,
      title: "Office hours",
      slug: "office",
      minimumNoticeMinutes: 0,
    }),
  );
  if (!r.ok) throw new Error("setup failed");
  const b = await createBooking(
    db,
    {
      username: "grace",
      slug: "office",
      startsAt: new Date("2026-11-25T15:00:00Z"),
      guestName: "Secret Guest",
      guestEmail: "secret@example.com",
      guestTimeZone: "America/New_York",
      guestNotes: "Grace's guest's private notes",
    },
    LONG_AGO,
  );
  if (!b.ok) throw new Error("setup failed");
  return b.booking.id;
}

describe("list_event_types", () => {
  it("lists the host's meeting types with their booking links, switched-off ones marked", async () => {
    const [deep] = await db.query.eventTypes.findMany({ where: (t, { eq }) => eq(t.slug, "deep") });
    await setEventTypeActive(db, "host", deep!.id, false);

    const r = await listEventTypesTool(deps(), host);

    expect(r).toEqual({
      ok: true,
      data: {
        timeZone: "Asia/Dhaka",
        eventTypes: [
          {
            slug: "intro",
            title: "Intro call",
            durationMinutes: 30,
            location: "Google Meet",
            active: true,
            bookingLink: `${APP}/sakif/intro`,
          },
          {
            slug: "deep",
            title: "Deep dive",
            durationMinutes: 60,
            location: "Zoom",
            active: false,
            bookingLink: `${APP}/sakif/deep`,
          },
        ],
      },
    });
  });

  it("asks a host who hasn't picked a booking link to finish setting up", async () => {
    await db.update(user).set({ username: null }).where(eq(user.id, "host"));
    expect(await listEventTypesTool(deps(), host)).toEqual({
      ok: false,
      error: `Finish setting up MeetReady first (pick your booking link): ${APP}/onboarding`,
    });
  });
});

describe("find_free_times", () => {
  const tuesday = { eventType: "intro", from: "2026-11-24", to: "2026-11-24" };

  it("gives the booking page's free times, on the host's clock by default, minus bookings and Google", async () => {
    await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO); // 14:00 in Dhaka
    const busyTimes = vi.fn(async () => [
      { start: new Date("2026-11-24T09:00:00Z"), end: new Date("2026-11-24T09:30:00Z") }, // 15:00 in Dhaka
    ]);

    const r = await findFreeTimesTool(deps({ busyTimes }), host, {
      ...tuesday,
      earliest: "13:00",
      latest: "16:00",
      timeZone: null,
    });

    expect(r).toEqual({
      ok: true,
      data: {
        eventType: "intro",
        durationMinutes: 30,
        timeZone: "Asia/Dhaka",
        from: "2026-11-24",
        to: "2026-11-24",
        totalFreeTimes: 5,
        days: [{ date: "2026-11-24", times: ["13:00", "13:30", "14:30", "15:30", "16:00"] }],
        truncated: false,
      },
    });
    // Google is asked about the host, for the searched day plus the usual two-day margin.
    expect(busyTimes).toHaveBeenCalledWith("host", {
      start: new Date("2026-11-21T18:00:00Z"),
      end: new Date("2026-11-26T18:00:00Z"),
    });
  });

  it("searches on another clock when given a timezone (Tuesday 09:00–10:00 in London)", async () => {
    const r = await findFreeTimesTool(deps(), host, {
      ...tuesday,
      earliest: "09:00",
      latest: "10:00",
      timeZone: "Europe/London",
    });
    expect(r.ok && r.data).toMatchObject({
      timeZone: "Europe/London",
      days: [{ date: "2026-11-24", times: ["09:00", "09:30", "10:00"] }],
    });
  });

  it("goes through the booking assistant's checks: dates in the past are refused, not searched", async () => {
    const busyTimes = vi.fn(async () => []);
    const r = await findFreeTimesTool(deps({ busyTimes }), host, {
      eventType: "intro",
      from: "2026-11-01",
      to: "2026-11-02",
      earliest: null,
      latest: null,
      timeZone: null,
    });
    expect(r).toEqual({ ok: false, error: "Those days are in the past. Today is 2026-11-18." });
    expect(busyTimes).not.toHaveBeenCalled();
  });

  it("caps a long list, and says it did", async () => {
    // Two free weeks, every half hour: far more than the cap.
    const r = await findFreeTimesTool(deps(), host, {
      eventType: "intro",
      from: "2026-11-19",
      to: "2026-12-02",
      earliest: null,
      latest: null,
      timeZone: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.truncated).toBe(true);
    expect(r.data.totalFreeTimes).toBeGreaterThan(MAX_LISTED_TIMES);
    expect(r.data.days.flatMap((d) => d.times)).toHaveLength(MAX_LISTED_TIMES);
  });

  it("only knows the caller's own active meeting types", async () => {
    await setupOtherHost();
    const args = { ...tuesday, earliest: null, latest: null, timeZone: null };
    // Grace's slug, asked by Sakif: not found (the host comes from the token, never the input).
    expect(await findFreeTimesTool(deps(), host, { ...args, eventType: "office" })).toEqual({
      ok: false,
      error: 'No active meeting type "office". list_event_types shows the slugs.',
    });
  });

  it("says so when Google Calendar can't be read, instead of showing times that may be busy", async () => {
    const busyTimes = vi.fn(async () => {
      throw new Error("Google down");
    });
    const r = await findFreeTimesTool(deps({ busyTimes }), host, {
      ...tuesday,
      earliest: null,
      latest: null,
      timeZone: null,
    });
    expect(r).toEqual({
      ok: false,
      error: "Your Google Calendar can't be read right now, so free times can't be checked. Try again soon.",
    });
  });
});

describe("list_bookings and get_booking", () => {
  it("lists bookings compactly: no notes, only whether there are any", async () => {
    const { booking } = await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO);
    await setupOtherHost();

    const r = await listBookingsTool(deps(), host, { view: "upcoming", limit: null });

    expect(r).toEqual({
      ok: true,
      data: {
        timeZone: "Asia/Dhaka",
        bookings: [
          {
            id: booking.id,
            start: "2026-11-24 14:00",
            end: "2026-11-24 14:30",
            meetingType: "Intro call",
            guestName: "Ada",
            guestEmail: "ada@example.com",
            status: "confirmed",
            hasNotes: true,
            hasBrief: false,
          },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toContain("Private notes"); // and nothing of Grace's
    expect(JSON.stringify(r)).not.toContain("Secret Guest");
  });

  it("lists cancelled bookings with who cancelled", async () => {
    const { booking } = await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO);
    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledBy: "guest", cancelledAt: LONG_AGO })
      .where(eq(bookings.id, booking.id));

    const r = await listBookingsTool(deps(), host, { view: "cancelled", limit: 5 });
    expect(r.ok && r.data.bookings).toEqual([
      expect.objectContaining({ id: booking.id, status: "cancelled", cancelledBy: "guest" }),
    ]);
  });

  it("gives one booking in full, with the guest's own words labelled as theirs", async () => {
    const { booking } = await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO);

    const r = await getBookingTool(deps(), host, { bookingId: booking.id });

    expect(r).toEqual({
      ok: true,
      data: {
        id: booking.id,
        timeZone: "Asia/Dhaka",
        start: "2026-11-24 14:00",
        end: "2026-11-24 14:30",
        guestTimeZone: "Europe/London",
        meetingType: "Intro call",
        status: "confirmed",
        rescheduled: false,
        guestName: "Ada",
        guestEmail: "ada@example.com",
        meetUrl: null,
        guestWrote: { notes: "Private notes for the host", answers: [] },
        brief: null,
      },
    });
  });

  it("treats another host's booking, and a made-up id, as not found (IDOR)", async () => {
    const gracesBooking = await setupOtherHost();
    const notFound = { ok: false, error: "No booking with that id. list_bookings shows the ids." };

    expect(await getBookingTool(deps(), host, { bookingId: gracesBooking })).toEqual(notFound);
    expect(await getBookingTool(deps(), host, { bookingId: "not-a-uuid" })).toEqual(notFound);
    // Grace herself can read it.
    expect((await getBookingTool(deps(), other, { bookingId: gracesBooking })).ok).toBe(true);
  });
});

describe("every tool call (runTool)", () => {
  const limit = vi.fn(async () => ({ ok: true }) as const);
  const ok = async () => ({ ok: true as const, data: { hello: "world" } });

  it("returns the data as structured content and as JSON text", async () => {
    expect(await runTool({ limit, report: vi.fn() }, host, "bookings:read", ok)).toEqual({
      content: [{ type: "text", text: '{"hello":"world"}' }],
      structuredContent: { hello: "world" },
    });
  });

  it("refuses a token without the tool's scope, before counting or running anything", async () => {
    const tool = vi.fn(ok);
    const limitSpy = vi.fn(limit);
    const writeOnly: Caller = { userId: "host", scopes: new Set(["bookings:write"]) };

    const r = await runTool({ limit: limitSpy, report: vi.fn() }, writeOnly, "bookings:read", tool);

    expect(r).toEqual({
      content: [
        {
          type: "text",
          text: 'This connection wasn\'t given the "bookings:read" permission. Reconnect MeetReady to allow it.',
        },
      ],
      isError: true,
    });
    expect(tool).not.toHaveBeenCalled();
    expect(limitSpy).not.toHaveBeenCalled();
  });

  it("stops at the host's rate limit, with when to try again", async () => {
    const tool = vi.fn(ok);
    const r = await runTool(
      { limit: async () => ({ ok: false, retryAfterSeconds: 300 }), report: vi.fn() },
      host,
      "bookings:read",
      tool,
    );
    expect(r).toMatchObject({
      isError: true,
      content: [{ text: "Too many MeetReady requests. Try again in 5 minutes." }],
    });
    expect(tool).not.toHaveBeenCalled();
  });

  it("reports an unexpected error and answers with a generic message (no internals to the assistant)", async () => {
    const report = vi.fn();
    const r = await runTool({ limit, report }, host, "bookings:read", async () => {
      throw new Error("relation does not exist: secret detail");
    });
    expect(r).toMatchObject({
      isError: true,
      content: [{ text: "Something went wrong in MeetReady. Try again in a minute." }],
    });
    expect(report).toHaveBeenCalledOnce();
  });

  it("refuses when there's no caller at all", async () => {
    expect(await runTool({ limit, report: vi.fn() }, null, "bookings:read", ok)).toMatchObject({
      isError: true,
    });
  });
});

describe("callerFromClaims", () => {
  it("takes the host from `sub`, the scopes from `scope` and the client from `azp`", () => {
    const c = callerFromClaims({
      sub: "host",
      scope: "bookings:read offline_access",
      azp: "https://claude.ai/x",
    });
    expect(c).toEqual({
      userId: "host",
      clientId: "https://claude.ai/x",
      scopes: new Set(["bookings:read", "offline_access"]),
    });
  });

  it("refuses a token without a subject", () => {
    expect(callerFromClaims({ scope: "bookings:read" })).toBeNull();
    expect(callerFromClaims({ sub: "" })).toBeNull();
  });
});
