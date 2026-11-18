import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiCalls, bookingBriefs, bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { book, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { mockModel } from "@/test/mock-model";
import { cancelBookingAsHost, listHostBookings } from "../manage-booking";
import { getBrief, prepareBrief, type BriefDeps } from "./briefs";

/*
 * Day 18: when a brief is written, what's stored and logged, and who sees it.
 * Real (in-memory) Postgres, fake model.
 */

const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const START = new Date("2026-11-20T04:00:00Z");
const NOTES = "We're hiring two React developers and want to talk about your availability.";

const good = {
  summary: "Ada wants to discuss hiring two React developers.",
  agenda: ["Their hiring needs", "Your availability"],
  prepare: [],
};

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

async function bookWithNotes(notes: string | null = NOTES) {
  const r = await book(db, START, LONG_AGO);
  await db.update(bookings).set({ guestNotes: notes }).where(eq(bookings.id, r.booking.id));
  return r.booking.id;
}

function deps(over: Partial<BriefDeps> = {}) {
  const report = vi.fn();
  const allow = vi.fn(async () => true);
  let t = 1000;
  const d: BriefDeps = {
    db,
    model: mockModel(good, { input: 400, output: 90 }),
    modelId: "mock-model",
    allow,
    report,
    clock: () => (t += 250),
    ...over,
  };
  return { d, report, allow };
}

const calls = () => db.select().from(aiCalls);

describe("prepareBrief", () => {
  it("writes and stores the brief, and logs the call's tokens and time (never its text)", async () => {
    const id = await bookWithNotes();
    const { d } = deps();

    expect(await prepareBrief(d, id)).toBe("written");
    expect(await getBrief(db, id)).toEqual(good);
    const [row] = await db.select().from(bookingBriefs);
    expect(row!.model).toBe("mock-model");
    const [call] = await calls();
    expect(call).toMatchObject({
      feature: "meeting_brief",
      model: "mock-model",
      hostId: "host",
      bookingId: id,
      outcome: "ok",
      inputTokens: 400,
      outputTokens: 90,
      durationMs: 250,
    });
  });

  it("is safe to run twice (a retried job step): the brief is kept, the model isn't called again", async () => {
    const id = await bookWithNotes();
    const model = mockModel(good);
    const { d } = deps({ model });
    await prepareBrief(d, id);
    expect(await prepareBrief(d, id)).toBe("exists");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(await calls()).toHaveLength(1);
  });

  it("doesn't call the model when there's nothing to summarise", async () => {
    const id = await bookWithNotes(null); // the fixture's booking has no answers either
    const model = mockModel(good);
    expect(await prepareBrief(deps({ model }).d, id)).toBe("no_content");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("does nothing without an API key (AI off)", async () => {
    const id = await bookWithNotes();
    expect(await prepareBrief(deps({ model: null }).d, id)).toBe("ai_off");
    expect(await calls()).toHaveLength(0);
  });

  it("respects our own budget: over it, no call and no brief", async () => {
    const id = await bookWithNotes();
    const model = mockModel(good);
    const allow = vi.fn(async () => false);
    const { d } = deps({ model, allow });
    expect(await prepareBrief(d, id)).toBe("limited");
    expect(allow).toHaveBeenCalledWith("host");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("checks the budget only after deciding there's something to write", async () => {
    const id = await bookWithNotes(null);
    const { d, allow } = deps();
    await prepareBrief(d, id);
    expect(allow).not.toHaveBeenCalled(); // a booking without notes doesn't use up the host's allowance
  });

  it("logs a failed call and reports it, without the guest's words", async () => {
    const id = await bookWithNotes();
    const { d, report } = deps({ model: mockModel(`{"summary": "${NOTES}", "agenda": "not a list"}`) });

    expect(await prepareBrief(d, id)).toBe("failed");
    expect(await getBrief(db, id)).toBeNull();
    expect((await calls())[0]).toMatchObject({ outcome: "invalid_output" });
    expect(report).toHaveBeenCalledOnce();
    const [error, bookingId] = report.mock.calls[0]!;
    expect(bookingId).toBe(id);
    expect(String((error as Error).message)).not.toContain("React");
  });

  it("logs a provider error as an error", async () => {
    const id = await bookWithNotes();
    const { d, report } = deps({ model: mockModel(new Error("503 from provider")) });
    expect(await prepareBrief(d, id)).toBe("failed");
    expect((await calls())[0]).toMatchObject({ outcome: "error", inputTokens: null });
    expect(report).toHaveBeenCalledOnce();
  });

  it("skips a booking cancelled before the job ran", async () => {
    const id = await bookWithNotes();
    await cancelBookingAsHost(db, "host", id, null, LONG_AGO);
    expect(await prepareBrief(deps().d, id)).toBe("not_needed");
  });
});

describe("the brief on the Bookings page", () => {
  it("comes with its booking, for that booking's host only", async () => {
    const withBrief = await bookWithNotes();
    await bookWithNotesAt(new Date("2026-11-20T06:00:00Z"));
    await prepareBrief(deps().d, withBrief);
    await db.insert(user).values({ id: "other", name: "Other Host", email: "o@example.com" });

    const rows = await listHostBookings(db, "host", "upcoming", LONG_AGO);
    expect(rows.map((r) => r.brief)).toEqual([good, null]);
    expect(await listHostBookings(db, "other", "upcoming", LONG_AGO)).toEqual([]);
  });
});

async function bookWithNotesAt(start: Date) {
  const r = await book(db, start, LONG_AGO);
  return r.booking.id;
}
