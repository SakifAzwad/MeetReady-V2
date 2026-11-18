import type { LanguageModel } from "ai";
import { aiCalls } from "@/db/schema";
import type { Database } from "@/db/types";
import type { Interval } from "@/lib/scheduling/intervals";
import { busyLoadRange, getBookableSlots, getPublicEventType } from "../booking";
import type { LimitResult } from "../rate-limit/limits";
import { runAssistant } from "./assistant";

/*
 * One request to the booking assistant, end to end (Day 19): find the event
 * type from the page, check our budget, run the assistant over our real slot
 * function, log the call. The server action calls this; tests call it with a
 * fake model.
 */

export type AskDeps = {
  db: Database;
  /** Null when no API key is set: the assistant is off (the page doesn't show it). */
  model: LanguageModel | null;
  modelId: string;
  /** Per-host and app-wide budgets (the per-IP limit is checked first, by the action). */
  limit: (hostId: string) => Promise<LimitResult>;
  /** The host's Google Calendar busy times (the same cached read the times grid uses). */
  busyTimes: (hostId: string, range: Interval) => Promise<Interval[]>;
  report: (error: unknown) => void;
  /** Milliseconds, for timing the call. Tests pass a fake. */
  clock?: () => number;
};

export type AskInput = { username: string; slug: string; message: string; timeZone: string };

export type AskResult =
  | {
      ok: true;
      reply: string;
      /** Up to three suggestions, from the tool's results (ISO instants). */
      slots: { start: string; end: string }[];
      /** The timezone the guest asked in, which may differ from their device's ("I'm in London"). */
      timeZone: string;
    }
  | { ok: false; error: "not_found" | "unavailable" | "failed" }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

export const ASSISTANT_FEATURE = "booking_assistant";

export async function askAssistant(deps: AskDeps, input: AskInput, now: Date): Promise<AskResult> {
  const eventType = await getPublicEventType(deps.db, input.username, input.slug);
  if (!eventType) return { ok: false, error: "not_found" };
  if (!deps.model) return { ok: false, error: "unavailable" };
  const limited = await deps.limit(eventType.hostId);
  if (!limited.ok) return { ok: false, error: "rate_limited", retryAfterSeconds: limited.retryAfterSeconds };

  const clock = deps.clock ?? Date.now;
  const started = clock();
  const run = await runAssistant(
    deps.model,
    {
      eventTitle: eventType.title,
      durationMinutes: eventType.durationMinutes,
      hostName: eventType.hostName,
      guestTimeZone: input.timeZone,
    },
    input.message,
    // The same slots the times grid shows: rules, bookings, buffers, and the host's Google Calendar.
    async (range) =>
      getBookableSlots(deps.db, eventType, range, now, {
        externalBusy: await deps.busyTimes(eventType.hostId, busyLoadRange(range)),
      }),
    now,
  );

  await deps.db.insert(aiCalls).values({
    feature: ASSISTANT_FEATURE,
    model: deps.modelId,
    hostId: eventType.hostId,
    outcome: run.ok ? "ok" : "error",
    inputTokens: run.inputTokens ?? null,
    outputTokens: run.outputTokens ?? null,
    durationMs: Math.round(clock() - started),
  });

  if (!run.ok) {
    deps.report(run.error);
    return { ok: false, error: "failed" };
  }
  return {
    ok: true,
    reply: run.reply,
    slots: run.slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    timeZone: run.timeZone,
  };
}
