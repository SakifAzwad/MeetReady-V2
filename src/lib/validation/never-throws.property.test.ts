import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { dateOverrideSchema, weeklyScheduleSchema } from "./availability";
import {
  bookingRequestSchema,
  cancelRequestSchema,
  rescheduleRequestSchema,
  slotsQuerySchema,
} from "./booking";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "./event-type";
import { onboardingSchema } from "./onboarding";
import { answersSchema, questionsSchema, type Question } from "./questions";

/*
 * Every schema here parses input from outside: a URL, a form, a server action
 * anyone can call with anything. `safeParse` must answer "invalid", never
 * THROW, or the request becomes a 500 instead of a 400.
 *
 * The trap (Day 12 story): in Zod 4, a refinement on an OBJECT still runs when
 * one of its fields already failed, and it receives that field's raw,
 * untransformed value. `.refine((q) => q.to > q.from)` gets the string "bad",
 * and `"bad".getTime()` throws.
 *
 * Purely random input rarely has the right keys, so each case starts from a
 * VALID example and replaces any subset of its fields with arbitrary values.
 */

const Q: Question = {
  id: "0b6f2d4e-1c3a-4e5f-8a7b-9c0d1e2f3a4b",
  type: "text",
  label: "Company",
  required: true,
  multiline: false,
};

const cases: [string, z.ZodType, Record<string, unknown>][] = [
  [
    "slots query",
    slotsQuerySchema,
    { username: "sakif", slug: "intro", from: "2026-11-01T00:00:00Z", to: "2026-11-30T00:00:00Z" },
  ],
  [
    "booking request",
    bookingRequestSchema,
    {
      username: "sakif",
      slug: "intro",
      startsAt: "2026-11-09T04:00:00Z",
      guestName: "Ada",
      guestEmail: "ada@example.com",
      guestNotes: "",
      guestTimeZone: "Europe/London",
      answers: {},
    },
  ],
  ["reschedule", rescheduleRequestSchema, { token: "x".repeat(43), startsAt: "2026-11-09T04:00:00Z" }],
  ["cancel", cancelRequestSchema, { token: "x".repeat(43), reason: "" }],
  ["event type", eventTypeSchema, { ...EVENT_TYPE_DEFAULTS, title: "Intro", slug: "intro" }],
  ["onboarding", onboardingSchema, { username: "sakif", timeZone: "Asia/Dhaka" }],
  [
    "weekly schedule",
    weeklyScheduleSchema,
    {
      timeZone: "Asia/Dhaka",
      days: Array.from({ length: 7 }, (_, d) => ({
        dayOfWeek: d,
        enabled: true,
        ranges: [{ startTime: "09:00", endTime: "17:00" }],
      })),
    },
  ],
  [
    "date override",
    dateOverrideSchema,
    { date: "2026-12-25", available: true, ranges: [{ startTime: "09:00", endTime: "12:00" }] },
  ],
  ["answers", answersSchema([Q]), { [Q.id]: "Acme" }],
];

describe("parsing untrusted input never throws", () => {
  it.each(cases)("%s: the valid example parses", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(cases)("%s: garbage in any field gives an error, not an exception", (_name, schema, valid) => {
    const field = fc.oneof(fc.anything(), fc.string(), fc.constant(undefined), fc.constant(null));
    const mutated = fc.record(
      Object.fromEntries(
        Object.entries(valid).map(([key, value]) => [key, fc.oneof(fc.constant(value), field)]),
      ),
    );
    fc.assert(
      fc.property(fc.oneof(mutated, fc.anything()), (input) => {
        schema.safeParse(input); // must return, whatever it returns
      }),
      { numRuns: 300 },
    );
  });

  it("questions list: garbage inside a question gives an error, not an exception", () => {
    const question = fc.record({
      id: fc.oneof(fc.constant(Q.id), fc.anything()),
      type: fc.oneof(fc.constantFrom("text", "choice", "multi_choice", "checkbox"), fc.anything()),
      label: fc.oneof(fc.constant("Company"), fc.anything()),
      required: fc.oneof(fc.boolean(), fc.anything()),
      options: fc.oneof(fc.constant(["A", "B"]), fc.array(fc.anything()), fc.anything()),
      multiline: fc.oneof(fc.boolean(), fc.anything()),
    });
    fc.assert(
      fc.property(fc.array(question, { maxLength: 4 }), (input) => void questionsSchema.safeParse(input)),
      {
        numRuns: 300,
      },
    );
  });
});
