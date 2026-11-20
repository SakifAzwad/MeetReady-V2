import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { bookings } from "@/db/schema";
import type { Database } from "@/db/types";
import { APP, book, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { buildMcpServer } from "./server";
import type { Caller, McpDeps } from "./tools";

/*
 * Day 22: book_meeting through the real MCP SDK on both sides, in-process (the
 * client's fetch goes straight to the handler, no HTTP server), over a real
 * database. What the unit tests can't show: the confirm form crossing the
 * protocol, which only exists on 2026-07-28, and a 2025-era client getting no
 * form at all. The SDK's own client defaults to the 2025 protocol (story), so
 * the modern client here pins 2026-07-28 explicitly.
 *
 * Day 24: cancel_booking and reschedule_booking the same way. The test client
 * ticks whichever box the form asks for (like a real client's UI), so these
 * also prove each form carries its own checkbox.
 */

const caller: Caller = {
  userId: "host",
  clientId: "https://claude.ai/client",
  scopes: new Set(["bookings:read", "bookings:write"]),
};
const args = {
  eventType: "intro",
  date: "2026-11-26",
  time: "14:00",
  timeZone: null,
  guestName: "Ada Lovelace",
  guestEmail: "ada@example.com",
  guestTimeZone: null,
};

let db: Database;
beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

function serve() {
  const deps: McpDeps & { report: (e: unknown) => void } = {
    db,
    appUrl: APP,
    busyTimes: async () => [],
    limit: async () => ({ ok: true }),
    now: () => new Date("2026-11-18T10:00:00Z"),
    bookLimit: async () => ({ ok: true }),
    changeLimit: async () => ({ ok: true }),
    report: vi.fn(),
  };
  return createMcpHandler((ctx) => buildMcpServer(deps, caller, ctx.era));
}

async function connect(opts: { modern: boolean; answer?: (message: string) => "accept" | "decline" }) {
  const handler = serve();
  const client = new Client(
    { name: "test-assistant", version: "1.0.0" },
    {
      ...(opts.answer ? { capabilities: { elicitation: { form: {} } } } : {}),
      ...(opts.modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}),
    },
  );
  if (opts.answer) {
    const answer = opts.answer;
    client.setRequestHandler("elicitation/create", async (request) => {
      const action = answer(request.params.message);
      // Tick the one box the form shows ("book", "cancel" or "move"), as a person would.
      const params = request.params as { requestedSchema?: { properties?: Record<string, unknown> } };
      const box = Object.keys(params.requestedSchema?.properties ?? {})[0] ?? "none";
      return action === "accept" ? { action, content: { [box]: true } } : { action };
    });
  }
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://meetready.test/api/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  return client;
}

const count = async () => (await db.select().from(bookings)).length;

describe("book_meeting over the MCP protocol", () => {
  it("2026-07-28 with a form: the person is asked, and only a yes books", async () => {
    const asked: string[] = [];
    let reply: "accept" | "decline" = "decline";
    const client = await connect({
      modern: true,
      answer: (message) => {
        asked.push(message);
        return reply;
      },
    });

    const no = await client.callTool({ name: "book_meeting", arguments: args });
    expect(asked).toEqual([
      'Book "Intro call" with Ada Lovelace (ada@example.com) on 2026-11-26 14:00 (Asia/Dhaka)? MeetReady will email Ada Lovelace the invitation, with a link to reschedule or cancel.',
    ]);
    expect(no.structuredContent).toEqual({
      booked: false,
      reason: "The user declined in the confirmation form.",
    });
    expect(await count()).toBe(0);

    reply = "accept";
    const yes = await client.callTool({ name: "book_meeting", arguments: args });
    expect(asked).toHaveLength(2);
    expect(yes.structuredContent).toMatchObject({ booked: true, start: "2026-11-26 14:00" });
    expect(await count()).toBe(1);
  });

  it("2026-07-28 without a form (like Claude.ai today): books, relying on the assistant to have asked", async () => {
    const client = await connect({ modern: true });
    const r = await client.callTool({ name: "book_meeting", arguments: args });
    expect(r.structuredContent).toMatchObject({ booked: true });
    expect(await count()).toBe(1);
  });

  it("a 2025-era client gets no form even if it can show one: there's no way back to this server", async () => {
    const answer = vi.fn(() => "accept" as const);
    const client = await connect({ modern: false, answer });
    const r = await client.callTool({ name: "book_meeting", arguments: args });
    expect(answer).not.toHaveBeenCalled();
    expect(r.structuredContent).toMatchObject({ booked: true });
  });

  it("lists book_meeting as a tool that writes and reaches outside MeetReady", async () => {
    const client = await connect({ modern: true });
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "book_meeting")?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });
});

describe("cancel_booking and reschedule_booking over the MCP protocol (Day 24)", () => {
  // Ada's booking: Thursday 26 Nov, 14:00 in Dhaka (08:00 UTC), made by a guest.
  let id: string;
  beforeEach(async () => {
    id = (await book(db, new Date("2026-11-26T08:00:00Z"), new Date("2026-11-01T00:00:00Z"))).booking.id;
  });
  const row = async () => (await db.select().from(bookings).where(eq(bookings.id, id)))[0]!;
  const move = () => ({ bookingId: id, date: "2026-11-27", time: "16:00", timeZone: null });

  it("2026-07-28 with a form: a cancel is asked about, and only a yes cancels", async () => {
    const asked: string[] = [];
    let reply: "accept" | "decline" = "decline";
    const client = await connect({
      modern: true,
      answer: (message) => {
        asked.push(message);
        return reply;
      },
    });
    const args = { bookingId: id, reason: null };
    const no = await client.callTool({ name: "cancel_booking", arguments: args });
    expect(asked[0]).toMatch(/^Cancel "Intro call" with Ada \(ada@example.com\) on 2026-11-26 14:00/);
    expect(no.structuredContent).toMatchObject({ cancelled: false });
    expect((await row()).status).toBe("confirmed");

    reply = "accept";
    const yes = await client.callTool({ name: "cancel_booking", arguments: args });
    expect(yes.structuredContent).toMatchObject({ cancelled: true });
    expect((await row()).status).toBe("cancelled");
  });

  it("2026-07-28 with a form: a move is asked about, and only a yes moves", async () => {
    let reply: "accept" | "decline" = "decline";
    const client = await connect({ modern: true, answer: () => reply });
    await client.callTool({ name: "reschedule_booking", arguments: move() });
    expect((await row()).startsAt).toEqual(new Date("2026-11-26T08:00:00Z"));

    reply = "accept";
    const yes = await client.callTool({ name: "reschedule_booking", arguments: move() });
    expect(yes.structuredContent).toMatchObject({ moved: true, start: "2026-11-27 16:00" });
    expect((await row()).startsAt).toEqual(new Date("2026-11-27T10:00:00Z"));
  });

  it("a 2025-era client gets no form, and the assistant's own confirmation is relied on", async () => {
    const answer = vi.fn(() => "accept" as const);
    const client = await connect({ modern: false, answer });
    const r = await client.callTool({ name: "reschedule_booking", arguments: move() });
    expect(answer).not.toHaveBeenCalled();
    expect(r.structuredContent).toMatchObject({ moved: true });
  });

  it("find_free_times takes a bookingId, and still answers a client that sends none (an old tool list)", async () => {
    const client = await connect({ modern: true });
    const search = {
      eventType: "intro",
      from: "2026-11-26",
      to: "2026-11-26",
      earliest: "14:00",
      latest: "14:00",
      timeZone: null,
    };
    const without = await client.callTool({ name: "find_free_times", arguments: search });
    expect(without.isError).toBeFalsy();
    expect(without.structuredContent).toMatchObject({ totalFreeTimes: 0 }); // Ada's meeting is there
    const moving = await client.callTool({
      name: "find_free_times",
      arguments: { ...search, bookingId: id },
    });
    expect(moving.structuredContent).toMatchObject({ totalFreeTimes: 1 });
  });

  it("lists both as destructive, idempotent tools that reach outside MeetReady", async () => {
    const client = await connect({ modern: true });
    const { tools } = await client.listTools();
    for (const name of ["cancel_booking", "reschedule_booking"]) {
      expect(tools.find((t) => t.name === name)?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });
});
