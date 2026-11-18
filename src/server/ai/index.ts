import "server-only";
import { createGroq } from "@ai-sdk/groq";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { env } from "@/lib/env";
import { scrubError } from "@/lib/monitoring";
import { calendarBusy } from "@/server/calendar";
import { rateLimit } from "@/server/rate-limit";
import type { AskDeps } from "./ask";
import type { BriefDeps } from "./briefs";

/*
 * The real wiring for AI (Day 18). The provider is chosen here and nowhere
 * else: the rest of the code only sees the AI SDK's `LanguageModel`, so moving
 * from Groq to another provider is this file and two env vars.
 */

const model = env.GROQ_API_KEY ? createGroq({ apiKey: env.GROQ_API_KEY })(env.AI_MODEL) : null;

export const briefDeps: BriefDeps = {
  db,
  model,
  modelId: env.AI_MODEL,
  allow: async (hostId) =>
    (
      await rateLimit([
        ["ai_brief_all", "all"],
        ["ai_brief_host", hostId],
      ])
    ).ok,
  // AI SDK errors carry the request (the prompt, i.e. the guest's text) and the model's raw answer as
  // properties. Only a scrubbed message goes to Sentry; the booking id lets the report be found.
  report: (error, bookingId) =>
    Sentry.captureException(scrubError(error), { tags: { area: "ai-brief" }, extra: { bookingId } }),
};

/** Whether the booking page offers the assistant (no key = no box: nothing to call). */
export const assistantEnabled = model !== null;

export const assistantDeps: AskDeps = {
  db,
  model,
  modelId: env.AI_MODEL,
  // App-wide first: once the day's budget is spent, a host's own allowance isn't touched.
  limit: (hostId) =>
    rateLimit([
      ["ai_assistant_all", "all"],
      ["ai_assistant_host", hostId],
    ]),
  busyTimes: (hostId, range) => calendarBusy.busyTimes(hostId, range, "cached"),
  // Same as the brief: the error carries the guest's message, so only a scrubbed copy is reported.
  report: (error) => Sentry.captureException(scrubError(error), { tags: { area: "ai-assistant" } }),
};
