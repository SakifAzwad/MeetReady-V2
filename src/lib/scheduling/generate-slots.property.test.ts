import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateSlots, type SlotGenerationInput } from "./generate-slots";
import { overlaps } from "./intervals";

/**
 * Example tests check cases we thought of. These check rules that must hold
 * for ANY calendar: fast-check generates hundreds of random hosts, timezones,
 * bookings and settings, and shrinks any failure to the smallest example.
 */

const TIMEZONES = [
  "UTC",
  "Asia/Dhaka",
  "America/New_York",
  "Europe/London",
  "Australia/Lord_Howe",
  "Asia/Kathmandu",
];

const wallTime = fc
  .integer({ min: 0, max: 24 * 4 })
  .map((q) =>
    q === 96
      ? "24:00"
      : `${String(Math.floor(q / 4)).padStart(2, "0")}:${String((q % 4) * 15).padStart(2, "0")}`,
  );

const rule = fc
  .record({ dayOfWeek: fc.integer({ min: 0, max: 6 }), a: wallTime, b: wallTime })
  .filter(({ a, b }) => a < b)
  .map(({ dayOfWeek, a, b }) => ({ dayOfWeek, startTime: a, endTime: b }));

// Spans March 2026 so the US and UK DST changes are included.
const RANGE_START = Date.parse("2026-03-01T00:00:00Z");
const instant = fc
  .integer({ min: RANGE_START, max: RANGE_START + 40 * 86_400_000 })
  .map((ms) => new Date(ms));

const busy = fc
  .record({
    start: instant,
    minutes: fc.integer({ min: 5, max: 240 }),
    bufferBeforeMinutes: fc.integer({ min: 0, max: 30 }),
    bufferAfterMinutes: fc.integer({ min: 0, max: 30 }),
    countsTowardDailyLimit: fc.boolean(),
  })
  .map(({ start, minutes, ...rest }) => ({
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    ...rest,
  }));

const scenario: fc.Arbitrary<SlotGenerationInput> = fc.record({
  range: fc.constant({ start: new Date(RANGE_START), end: new Date(RANGE_START + 35 * 86_400_000) }),
  now: instant,
  host: fc.record({
    timeZone: fc.constantFrom(...TIMEZONES),
    weeklyRules: fc.array(rule, { maxLength: 6 }),
    dateOverrides: fc.constant([]),
  }),
  eventType: fc.record({
    durationMinutes: fc.constantFrom(15, 20, 30, 45, 60, 90),
    slotIntervalMinutes: fc.option(fc.constantFrom(5, 10, 15, 30, 60), { nil: null }),
    bufferBeforeMinutes: fc.integer({ min: 0, max: 30 }),
    bufferAfterMinutes: fc.integer({ min: 0, max: 30 }),
    minimumNoticeMinutes: fc.integer({ min: 0, max: 48 * 60 }),
    bookingWindowDays: fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
    maxBookingsPerDay: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  }),
  busy: fc.array(busy, { maxLength: 15 }),
});

describe("generateSlots invariants", () => {
  it("every slot is exactly the event duration", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        for (const s of generateSlots(input)) {
          expect(s.end.getTime() - s.start.getTime()).toBe(input.eventType.durationMinutes * 60_000);
        }
      }),
    );
  });

  it("no slot overlaps an existing booking, even ignoring buffers", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        for (const s of generateSlots(input)) {
          for (const b of input.busy) expect(overlaps(s, b)).toBe(false);
        }
      }),
    );
  });

  it("slots are strictly increasing (sorted, no duplicates)", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const slots = generateSlots(input);
        for (let i = 1; i < slots.length; i++) {
          expect(slots[i]!.start.getTime()).toBeGreaterThan(slots[i - 1]!.start.getTime());
        }
      }),
    );
  });

  it("slots start inside the range and after now + minimum notice", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const earliest = input.now.getTime() + input.eventType.minimumNoticeMinutes * 60_000;
        for (const s of generateSlots(input)) {
          expect(s.start.getTime()).toBeGreaterThanOrEqual(Math.max(earliest, input.range.start.getTime()));
          expect(s.start.getTime()).toBeLessThan(input.range.end.getTime());
        }
      }),
    );
  });

  it("with no rules there are no slots", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        expect(generateSlots({ ...input, host: { ...input.host, weeklyRules: [] } })).toEqual([]);
      }),
    );
  });
});
