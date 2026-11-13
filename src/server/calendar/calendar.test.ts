import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { account, calendarConnections, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { CALENDAR_SCOPES } from "@/lib/calendar";
import { createTestDb } from "@/test/db";
import { createCalendarBusy, type CalendarBusyDeps } from "./busy";
import { createMemoryBusyCache, FRESH_MS, STALE_MS } from "./cache";
import { completeCalendarConnection, disconnectCalendar, getCalendarStatus } from "./connection";
import { CalendarUnavailableError } from "./google-api";

/*
 * The calendar's rules, on a real (in-memory) Postgres with a fake Google:
 * when Google is asked, what's cached, what fails closed, what the dashboard
 * is told, and what connecting and disconnecting do to the stored tokens.
 */

const RANGE = { start: new Date("2026-11-09T00:00:00Z"), end: new Date("2026-11-10T00:00:00Z") };
const MEETING = { start: new Date("2026-11-09T04:00:00Z"), end: new Date("2026-11-09T05:00:00Z") };
const ALL_SCOPES = ["openid", "email", "profile", ...CALENDAR_SCOPES].join(",");

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "alice", name: "Alice", email: "alice@example.com", username: "alice" },
    { id: "bob", name: "Bob", email: "bob@example.com", username: "bob" },
  ]);
  await db.insert(account).values([
    {
      id: "acc-alice",
      accountId: "google-sub-alice",
      providerId: "google",
      userId: "alice",
      accessToken: "enc-access",
      refreshToken: "enc-refresh",
      scope: ALL_SCOPES,
    },
    {
      id: "acc-bob",
      accountId: "google-sub-bob",
      providerId: "google",
      userId: "bob",
      scope: "openid,email,profile",
    },
  ]);
}, 30_000);

const connectAlice = () => db.insert(calendarConnections).values({ userId: "alice", accountId: "acc-alice" });

/** A fake Google + clock, and the busy-times source built on them. */
function setup(overrides: Partial<CalendarBusyDeps> = {}) {
  let t = Date.parse("2026-11-01T00:00:00Z");
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const google = vi.fn<CalendarBusyDeps["queryFreeBusy"]>(async () => [MEETING]);
  const getAccessToken = vi.fn<CalendarBusyDeps["getAccessToken"]>(async () => "access-token");
  const report = vi.fn<CalendarBusyDeps["report"]>();
  const busy = createCalendarBusy({
    db,
    cache: createMemoryBusyCache(clock.now),
    getAccessToken,
    queryFreeBusy: google,
    report,
    now: clock.now,
    ...overrides,
  });
  return { busy, google, getAccessToken, report, clock };
}

const lastError = async (userId = "alice") =>
  (await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId)))[0];

describe("busy times", () => {
  it("no connected calendar: no busy times, and Google is never called", async () => {
    const { busy, google, getAccessToken } = setup();
    expect(await busy.busyTimes("alice", RANGE, "cached")).toEqual([]);
    expect(await busy.busyTimes("alice", RANGE, "live")).toEqual([]);
    expect(google).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("asks Google with the host's own account, for the requested range and their primary calendar", async () => {
    await connectAlice();
    const { busy, google, getAccessToken } = setup();
    expect(await busy.busyTimes("alice", RANGE, "live")).toEqual([MEETING]);
    expect(getAccessToken).toHaveBeenCalledWith("alice", "acc-alice");
    expect(google).toHaveBeenCalledWith("access-token", "primary", RANGE);
  });

  it("showing times: a fresh copy is reused for a minute, then Google is asked again", async () => {
    await connectAlice();
    const { busy, google, clock } = setup();
    await busy.busyTimes("alice", RANGE, "cached");
    clock.advance(FRESH_MS - 1);
    await busy.busyTimes("alice", RANGE, "cached");
    expect(google).toHaveBeenCalledTimes(1);
    clock.advance(1);
    await busy.busyTimes("alice", RANGE, "cached");
    expect(google).toHaveBeenCalledTimes(2);
  });

  it("booking: always asks Google, even with a fresh copy", async () => {
    await connectAlice();
    const { busy, google } = setup();
    await busy.busyTimes("alice", RANGE, "cached");
    await busy.busyTimes("alice", RANGE, "live");
    await busy.busyTimes("alice", RANGE, "live");
    expect(google).toHaveBeenCalledTimes(3);
  });

  it("Google down while SHOWING times: an up-to-an-hour-old copy is used", async () => {
    await connectAlice();
    const { busy, google, clock } = setup();
    await busy.busyTimes("alice", RANGE, "cached");
    google.mockRejectedValue(new CalendarUnavailableError("unavailable", "503"));
    clock.advance(STALE_MS - 1);
    expect(await busy.busyTimes("alice", RANGE, "cached")).toEqual([MEETING]);
    clock.advance(2);
    await expect(busy.busyTimes("alice", RANGE, "cached")).rejects.toBeInstanceOf(CalendarUnavailableError);
  });

  it("Google down while BOOKING: fails, even with a copy in the cache (fail closed)", async () => {
    await connectAlice();
    const { busy, google } = setup();
    await busy.busyTimes("alice", RANGE, "cached");
    google.mockRejectedValue(new CalendarUnavailableError("unavailable", "timeout"));
    await expect(busy.busyTimes("alice", RANGE, "live")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("a token that can't be had or refreshed is lost access", async () => {
    await connectAlice();
    const { busy } = setup({
      getAccessToken: async () => Promise.reject(new Error("FAILED_TO_GET_ACCESS_TOKEN")),
    });
    await expect(busy.busyTimes("alice", RANGE, "live")).rejects.toMatchObject({ kind: "access_lost" });
  });

  it("remembers a failure for the dashboard, reports it once, and clears it on the next success", async () => {
    await connectAlice();
    const { busy, google, report } = setup();
    google.mockRejectedValue(new CalendarUnavailableError("unavailable", "503"));
    for (let i = 0; i < 3; i++) await busy.busyTimes("alice", RANGE, "live").catch(() => {});
    expect(await lastError()).toMatchObject({ lastError: "unavailable", lastErrorAt: expect.any(Date) });
    expect(report).toHaveBeenCalledTimes(1); // an outage is one report, not one per guest

    google.mockResolvedValue([]);
    await busy.busyTimes("alice", RANGE, "live");
    expect(await lastError()).toMatchObject({ lastError: null, lastErrorAt: null });
  });

  it("other errors (bugs) are thrown as they are, not disguised as an outage", async () => {
    await connectAlice();
    const { busy, google } = setup();
    google.mockRejectedValue(new TypeError("bug"));
    await expect(busy.busyTimes("alice", RANGE, "live")).rejects.toBeInstanceOf(TypeError);
  });

  it("a broken cache is skipped, never an error for the guest", async () => {
    await connectAlice();
    const broken = {
      get: () => Promise.reject(new Error("redis down")),
      set: () => Promise.reject(new Error("redis down")),
      clearHost: () => Promise.reject(new Error("redis down")),
    };
    const { busy } = setup({ cache: broken });
    expect(await busy.busyTimes("alice", RANGE, "cached")).toEqual([MEETING]);
  });
});

describe("connecting", () => {
  it("connects when both permissions and a refresh token were granted", async () => {
    expect(await completeCalendarConnection(db, "alice")).toBe("connected");
    expect(await getCalendarStatus(db, "alice")).toEqual({
      connected: true,
      calendarId: "primary",
      lastError: null,
      lastErrorAt: null,
    });
  });

  it("refuses when a permission was unticked, or there's no refresh token", async () => {
    expect(await completeCalendarConnection(db, "bob")).toBe("missing_permission");
    await db.update(account).set({ scope: ALL_SCOPES }).where(eq(account.id, "acc-bob")); // no refresh token
    expect(await completeCalendarConnection(db, "bob")).toBe("missing_permission");
    expect(await getCalendarStatus(db, "bob")).toEqual({ connected: false });
  });

  it("needs a Google account", async () => {
    await db.insert(user).values({ id: "carol", name: "Carol", email: "c@example.com" });
    expect(await completeCalendarConnection(db, "carol")).toBe("no_google_account");
  });

  it("reconnecting clears an old error", async () => {
    await connectAlice();
    await db
      .update(calendarConnections)
      .set({ lastError: "access_lost", lastErrorAt: new Date() })
      .where(eq(calendarConnections.userId, "alice"));
    expect(await completeCalendarConnection(db, "alice")).toBe("connected");
    expect(await lastError()).toMatchObject({ lastError: null, lastErrorAt: null });
  });

  it("the database refuses an error without a time (and a time without an error)", async () => {
    await connectAlice();
    await expect(
      db
        .update(calendarConnections)
        .set({ lastError: "unavailable" })
        .where(eq(calendarConnections.userId, "alice")),
    ).rejects.toThrow();
  });
});

describe("disconnecting", () => {
  it("revokes at Google, forgets the tokens and calendar scopes, and deletes the connection", async () => {
    await connectAlice();
    const revoke = vi.fn(async () => true);
    await disconnectCalendar(db, "alice", { getAccessToken: async () => "access-token", revoke });

    expect(revoke).toHaveBeenCalledWith("access-token");
    expect(await getCalendarStatus(db, "alice")).toEqual({ connected: false });
    const [row] = await db.select().from(account).where(eq(account.id, "acc-alice"));
    expect(row).toMatchObject({ accessToken: null, refreshToken: null, scope: "openid,email,profile" });
  });

  it("still disconnects when Google can't be reached or the token is already dead", async () => {
    await connectAlice();
    await disconnectCalendar(db, "alice", {
      getAccessToken: async () => Promise.reject(new Error("revoked")),
      revoke: vi.fn(),
    });
    expect(await getCalendarStatus(db, "alice")).toEqual({ connected: false });
  });

  it("only touches the signed-in host's own account", async () => {
    await connectAlice();
    await disconnectCalendar(db, "bob", { getAccessToken: async () => "x", revoke: vi.fn() });
    expect(await getCalendarStatus(db, "alice")).toMatchObject({ connected: true });
    const [row] = await db.select().from(account).where(eq(account.id, "acc-alice"));
    expect(row?.refreshToken).toBe("enc-refresh");
  });
});
