import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiCalls } from "@/db/schema";
import type { Database } from "@/db/types";
import { book, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { mockModelSteps } from "@/test/mock-model";
import { askAssistant, type AskDeps } from "./ask";

/*
 * Day 19: the booking assistant end to end on a real (in-memory) Postgres:
 * our real slot function, with an existing booking and a Google Calendar
 * busy block in the way, and a fake model playing the guest's request.
 *
 * The fixture host is in Dhaka and available all day, so Tuesday 24 Nov
 * 12:00–17:00 in London (UTC in November) is bookable apart from what's in
 * the way. "Now" is Wednesday 18 Nov, 10:00 UTC.
 */

const NOW = new Date("2026-11-18T10:00:00Z");
const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const input = {
  username: "sakif",
  slug: "intro",
  message: "next Tuesday afternoon",
  timeZone: "Europe/London",
};
const tuesdayAfternoon = {
  tool: "findTimes",
  input: { from: "2026-11-24", to: "2026-11-24", earliest: "12:00", latest: "17:00", timeZone: null },
};

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

function deps(over: Partial<AskDeps> = {}) {
  const report = vi.fn();
  const limit = vi.fn(async () => ({ ok: true }) as const);
  // The host's Google Calendar: busy 15:00–16:00 UTC on Tuesday.
  const busyTimes = vi.fn(async () => [
    { start: new Date("2026-11-24T15:00:00Z"), end: new Date("2026-11-24T16:00:00Z") },
  ]);
  let t = 0;
  const d: AskDeps = {
    db,
    model: mockModelSteps([tuesdayAfternoon, { text: "Here are some Tuesday afternoon times." }]),
    modelId: "mock-model",
    limit,
    busyTimes,
    report,
    clock: () => (t += 700),
    ...over,
  };
  return { d, report, limit, busyTimes };
}

describe("askAssistant", () => {
  it("suggests real free times: not booked, not busy in Google, spread out", async () => {
    await book(db, new Date("2026-11-24T14:00:00Z"), LONG_AGO); // an existing booking at 14:00
    const { d, busyTimes } = deps();

    const r = await askAssistant(d, input, NOW);

    expect(r).toEqual({
      ok: true,
      reply: "Here are some Tuesday afternoon times.",
      slots: [
        { start: "2026-11-24T12:00:00.000Z", end: "2026-11-24T12:30:00.000Z" },
        { start: "2026-11-24T13:00:00.000Z", end: "2026-11-24T13:30:00.000Z" },
        { start: "2026-11-24T14:30:00.000Z", end: "2026-11-24T15:00:00.000Z" },
      ],
      timeZone: "Europe/London",
    });
    expect(busyTimes).toHaveBeenCalledWith("host", {
      start: new Date("2026-11-22T00:00:00Z"), // the search day, plus the usual two-day margin each side
      end: new Date("2026-11-27T00:00:00Z"),
    });
  });

  it("logs the call: feature, host, tokens over both model calls, time; never the message", async () => {
    await askAssistant(deps().d, input, NOW);
    const [call] = await db.select().from(aiCalls);
    expect(call).toMatchObject({
      feature: "booking_assistant",
      model: "mock-model",
      hostId: "host",
      bookingId: null,
      outcome: "ok",
      inputTokens: 400,
      outputTokens: 80,
      durationMs: 700,
    });
  });

  it("only searches the host and event type on the page", async () => {
    expect(await askAssistant(deps().d, { ...input, slug: "nope" }, NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("is off without an API key, before any budget is used", async () => {
    const { d, limit } = deps({ model: null });
    expect(await askAssistant(d, input, NOW)).toEqual({ ok: false, error: "unavailable" });
    expect(limit).not.toHaveBeenCalled();
  });

  it("over the budget, says when to try again and doesn't call the model", async () => {
    const model = mockModelSteps([tuesdayAfternoon]);
    const limit = vi.fn(async () => ({ ok: false, retryAfterSeconds: 3600 }) as const);
    expect(await askAssistant(deps({ model, limit }).d, input, NOW)).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: 3600,
    });
    expect(limit).toHaveBeenCalledWith("host");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("logs and reports a failed call, and tells the page it failed", async () => {
    const { d, report } = deps({ model: mockModelSteps([new Error("503")]) });
    expect(await askAssistant(d, input, NOW)).toEqual({ ok: false, error: "failed" });
    expect(report).toHaveBeenCalledOnce();
    expect((await db.select().from(aiCalls))[0]).toMatchObject({ outcome: "error" });
  });
});
