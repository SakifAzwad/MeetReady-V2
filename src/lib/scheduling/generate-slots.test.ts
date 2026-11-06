import { describe, expect, it } from "vitest";
import { generateSlots, type SlotGenerationInput } from "./generate-slots";
import { groupSlotsByDate } from "./group-slots";

// 2026-11-09 is a Monday, 2026-11-10 a Tuesday.
const MON = 1;
const TUE = 2;
const SAT = 6;
const SUN = 0;

const d = (iso: string) => new Date(iso);
const starts = (slots: { start: Date }[]) => slots.map((s) => s.start.toISOString());

/** Defaults: UTC host, Monday 09:00–12:00, 30-min event, no rules, viewing Monday. */
function input(overrides: {
  range?: [string, string];
  now?: string;
  host?: Partial<SlotGenerationInput["host"]>;
  eventType?: Partial<SlotGenerationInput["eventType"]>;
  busy?: SlotGenerationInput["busy"];
}): SlotGenerationInput {
  const [from, to] = overrides.range ?? ["2026-11-09T00:00:00Z", "2026-11-10T00:00:00Z"];
  return {
    range: { start: d(from), end: d(to) },
    now: d(overrides.now ?? "2026-11-01T00:00:00Z"),
    host: {
      timeZone: "UTC",
      weeklyRules: [{ dayOfWeek: MON, startTime: "09:00", endTime: "12:00" }],
      dateOverrides: [],
      ...overrides.host,
    },
    eventType: {
      durationMinutes: 30,
      slotIntervalMinutes: null,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minimumNoticeMinutes: 0,
      bookingWindowDays: null,
      maxBookingsPerDay: null,
      ...overrides.eventType,
    },
    busy: overrides.busy ?? [],
  };
}

describe("weekly availability", () => {
  it("splits a window into back-to-back slots of the event duration", () => {
    expect(starts(generateSlots(input({})))).toEqual([
      "2026-11-09T09:00:00.000Z",
      "2026-11-09T09:30:00.000Z",
      "2026-11-09T10:00:00.000Z",
      "2026-11-09T10:30:00.000Z",
      "2026-11-09T11:00:00.000Z",
      "2026-11-09T11:30:00.000Z",
    ]);
  });

  it("only returns slots that fit completely inside the window", () => {
    const slots = generateSlots(input({ eventType: { durationMinutes: 45 } }));
    expect(starts(slots)).toEqual([
      "2026-11-09T09:00:00.000Z",
      "2026-11-09T09:45:00.000Z",
      "2026-11-09T10:30:00.000Z",
      "2026-11-09T11:15:00.000Z", // ends exactly at 12:00 -> allowed
    ]);
    expect(slots.at(-1)?.end.toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });

  it("supports a slot interval shorter than the duration", () => {
    const slots = generateSlots(
      input({
        host: { weeklyRules: [{ dayOfWeek: MON, startTime: "09:00", endTime: "10:30" }] },
        eventType: { durationMinutes: 60, slotIntervalMinutes: 15 },
      }),
    );
    expect(starts(slots)).toEqual([
      "2026-11-09T09:00:00.000Z",
      "2026-11-09T09:15:00.000Z",
      "2026-11-09T09:30:00.000Z",
    ]);
  });

  it("ignores rules for other weekdays", () => {
    const slots = generateSlots(
      input({ host: { weeklyRules: [{ dayOfWeek: TUE, startTime: "09:00", endTime: "12:00" }] } }),
    );
    expect(slots).toEqual([]);
  });

  it("supports several windows in one day (lunch break)", () => {
    const slots = generateSlots(
      input({
        host: {
          weeklyRules: [
            { dayOfWeek: MON, startTime: "09:00", endTime: "12:00" },
            { dayOfWeek: MON, startTime: "13:00", endTime: "15:00" },
          ],
        },
        eventType: { durationMinutes: 60 },
      }),
    );
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["09:00", "10:00", "11:00", "13:00", "14:00"]);
  });

  it("merges overlapping rules instead of producing duplicate slots", () => {
    const slots = generateSlots(
      input({
        host: {
          weeklyRules: [
            { dayOfWeek: MON, startTime: "09:00", endTime: "11:00" },
            { dayOfWeek: MON, startTime: "10:00", endTime: "12:00" },
          ],
        },
        eventType: { durationMinutes: 60 },
      }),
    );
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("returns only slots that start inside the requested range", () => {
    const slots = generateSlots(input({ range: ["2026-11-09T10:15:00Z", "2026-11-09T11:00:00Z"] }));
    expect(starts(slots)).toEqual(["2026-11-09T10:30:00.000Z"]);
  });

  it("joins windows across midnight so a slot can span it", () => {
    const slots = generateSlots(
      input({
        range: ["2026-11-09T00:00:00Z", "2026-11-11T00:00:00Z"],
        host: {
          weeklyRules: [
            { dayOfWeek: MON, startTime: "22:00", endTime: "24:00" },
            { dayOfWeek: TUE, startTime: "00:00", endTime: "02:00" },
          ],
        },
        eventType: { durationMinutes: 90 },
      }),
    );
    expect(slots.map((s) => [s.start.toISOString(), s.end.toISOString()])).toEqual([
      ["2026-11-09T22:00:00.000Z", "2026-11-09T23:30:00.000Z"],
      ["2026-11-09T23:30:00.000Z", "2026-11-10T01:00:00.000Z"],
    ]);
  });
});

describe("timezones and DST", () => {
  it("interprets availability in the host's timezone and returns UTC instants", () => {
    // Asia/Dhaka is UTC+6, no DST. Monday 09:00 Dhaka = Monday 03:00 UTC.
    const slots = generateSlots(
      input({
        range: ["2026-11-08T00:00:00Z", "2026-11-10T00:00:00Z"],
        host: {
          timeZone: "Asia/Dhaka",
          weeklyRules: [{ dayOfWeek: MON, startTime: "09:00", endTime: "10:00" }],
        },
      }),
    );
    expect(starts(slots)).toEqual(["2026-11-09T03:00:00.000Z", "2026-11-09T03:30:00.000Z"]);
  });

  it("keeps 09:00 local on both sides of a DST change", () => {
    // New York springs forward on Sun 8 Mar 2026: EST (UTC-5) -> EDT (UTC-4).
    const slots = generateSlots(
      input({
        now: "2026-03-01T00:00:00Z",
        range: ["2026-03-07T00:00:00Z", "2026-03-09T12:00:00Z"],
        host: {
          timeZone: "America/New_York",
          weeklyRules: [
            { dayOfWeek: SAT, startTime: "09:00", endTime: "09:30" },
            { dayOfWeek: SUN, startTime: "09:00", endTime: "09:30" },
          ],
        },
      }),
    );
    expect(starts(slots)).toEqual([
      "2026-03-07T14:00:00.000Z", // Sat 09:00 EST
      "2026-03-08T13:00:00.000Z", // Sun 09:00 EDT — one hour earlier in UTC
    ]);
  });

  it("never offers wall-clock times that don't exist (spring-forward gap)", () => {
    // 02:00–03:00 does not exist in New York on 8 Mar 2026. A 02:00–04:00 rule
    // is really 03:00–04:00 EDT: one hour, two 30-min slots.
    const slots = generateSlots(
      input({
        now: "2026-03-01T00:00:00Z",
        range: ["2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z"],
        host: {
          timeZone: "America/New_York",
          weeklyRules: [{ dayOfWeek: SUN, startTime: "02:00", endTime: "04:00" }],
        },
      }),
    );
    expect(starts(slots)).toEqual(["2026-03-08T07:00:00.000Z", "2026-03-08T07:30:00.000Z"]);
  });

  it("uses real elapsed time when the clock falls back", () => {
    // 1 Nov 2026, New York: 01:00–02:00 happens twice. 00:00 EDT -> 03:00 EST is 4 real hours.
    const slots = generateSlots(
      input({
        now: "2026-10-25T00:00:00Z",
        range: ["2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"],
        host: {
          timeZone: "America/New_York",
          weeklyRules: [{ dayOfWeek: SUN, startTime: "00:00", endTime: "03:00" }],
        },
        eventType: { durationMinutes: 60 },
      }),
    );
    expect(starts(slots)).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
    ]);
  });
});

describe("date overrides", () => {
  it("blocks a whole day when start and end are null", () => {
    const slots = generateSlots(
      input({
        range: ["2026-11-09T00:00:00Z", "2026-11-17T00:00:00Z"],
        host: { dateOverrides: [{ date: "2026-11-09", startTime: null, endTime: null }] },
      }),
    );
    expect(slots.every((s) => s.start.toISOString().startsWith("2026-11-16"))).toBe(true);
    expect(slots).toHaveLength(6);
  });

  it("replaces the weekly hours for that date", () => {
    const slots = generateSlots(
      input({ host: { dateOverrides: [{ date: "2026-11-09", startTime: "14:00", endTime: "15:00" }] } }),
    );
    expect(starts(slots)).toEqual(["2026-11-09T14:00:00.000Z", "2026-11-09T14:30:00.000Z"]);
  });

  it("can add availability on a day with no weekly rule", () => {
    const slots = generateSlots(
      input({
        range: ["2026-11-14T00:00:00Z", "2026-11-15T00:00:00Z"], // Saturday
        host: { dateOverrides: [{ date: "2026-11-14", startTime: "10:00", endTime: "10:30" }] },
      }),
    );
    expect(starts(slots)).toEqual(["2026-11-14T10:00:00.000Z"]);
  });
});

describe("existing bookings and buffers", () => {
  const busy = (start: string, end: string, extra = {}) => ({ start: d(start), end: d(end), ...extra });

  it("removes slots that overlap a booking but keeps adjacent ones", () => {
    const slots = generateSlots(input({ busy: [busy("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z")] }));
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["09:00", "09:30", "10:30", "11:00", "11:30"]);
  });

  it("removes every slot a partial overlap touches", () => {
    const slots = generateSlots(input({ busy: [busy("2026-11-09T10:15:00Z", "2026-11-09T10:45:00Z")] }));
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });

  it("applies the event type's buffer after the new meeting", () => {
    const slots = generateSlots(
      input({
        eventType: { bufferAfterMinutes: 15 },
        busy: [busy("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z")],
      }),
    );
    // 09:30–10:00 + 15 min buffer runs into the 10:00 booking.
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["09:00", "10:30", "11:00", "11:30"]);
  });

  it("respects the existing booking's own buffer", () => {
    const slots = generateSlots(
      input({ busy: [busy("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z", { bufferAfterMinutes: 30 })] }),
    );
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });

  it("lets two buffers share the same free time (gap = max, not sum)", () => {
    const slots = generateSlots(
      input({
        eventType: { slotIntervalMinutes: 15, bufferBeforeMinutes: 15 },
        busy: [busy("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z", { bufferAfterMinutes: 15 })],
      }),
    );
    const times = starts(slots).map((s) => s.slice(11, 16));
    expect(times).not.toContain("10:30");
    expect(times).toContain("10:45"); // 15-min gap satisfies both 15-min buffers
  });
});

describe("booking rules", () => {
  it("enforces minimum notice", () => {
    const slots = generateSlots(
      input({ now: "2026-11-09T09:10:00Z", eventType: { minimumNoticeMinutes: 60 } }),
    );
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["10:30", "11:00", "11:30"]);
  });

  it("never returns slots in the past", () => {
    const slots = generateSlots(input({ now: "2026-11-09T10:05:00Z" }));
    expect(starts(slots).map((s) => s.slice(11, 16))).toEqual(["10:30", "11:00", "11:30"]);
  });

  it("limits how far ahead guests can book, by host calendar day", () => {
    const base = {
      now: "2026-11-09T08:00:00Z",
      range: ["2026-11-09T00:00:00Z", "2026-11-11T00:00:00Z"] as [string, string],
      host: {
        weeklyRules: [
          { dayOfWeek: MON, startTime: "09:00", endTime: "10:00" },
          { dayOfWeek: TUE, startTime: "09:00", endTime: "10:00" },
        ],
      },
    };
    const oneDay = generateSlots(input({ ...base, eventType: { bookingWindowDays: 1 } }));
    const twoDays = generateSlots(input({ ...base, eventType: { bookingWindowDays: 2 } }));
    expect(oneDay.every((s) => s.start.toISOString().startsWith("2026-11-09"))).toBe(true);
    expect(twoDays).toHaveLength(4);
  });

  it("hides a day once it reaches the max bookings for this event type", () => {
    const thisEvent = { countsTowardDailyLimit: true };
    const slots = generateSlots(
      input({
        range: ["2026-11-09T00:00:00Z", "2026-11-11T00:00:00Z"],
        host: {
          weeklyRules: [
            { dayOfWeek: MON, startTime: "09:00", endTime: "12:00" },
            { dayOfWeek: TUE, startTime: "09:00", endTime: "10:00" },
          ],
        },
        eventType: { maxBookingsPerDay: 2 },
        busy: [
          { start: d("2026-11-09T09:00:00Z"), end: d("2026-11-09T09:30:00Z"), ...thisEvent },
          { start: d("2026-11-09T11:00:00Z"), end: d("2026-11-09T11:30:00Z"), ...thisEvent },
          // A different event type's booking on Tuesday: blocks its time, doesn't count.
          { start: d("2026-11-10T09:00:00Z"), end: d("2026-11-10T09:30:00Z") },
        ],
      }),
    );
    expect(starts(slots)).toEqual(["2026-11-10T09:30:00.000Z"]);
  });

  it("counts the daily limit by the host's calendar day, not UTC", () => {
    // 2026-11-09T20:00Z is already Tuesday 02:00 in Dhaka, so Monday isn't full.
    const slots = generateSlots(
      input({
        range: ["2026-11-08T00:00:00Z", "2026-11-10T00:00:00Z"],
        host: {
          timeZone: "Asia/Dhaka",
          weeklyRules: [{ dayOfWeek: MON, startTime: "09:00", endTime: "10:00" }],
        },
        eventType: { maxBookingsPerDay: 1 },
        busy: [
          { start: d("2026-11-09T20:00:00Z"), end: d("2026-11-09T20:30:00Z"), countsTowardDailyLimit: true },
        ],
      }),
    );
    expect(slots).toHaveLength(2);
  });
});

describe("input validation", () => {
  it("rejects an unknown timezone", () => {
    expect(() => generateSlots(input({ host: { timeZone: "Mars/Olympus_Mons" } }))).toThrow(/timezone/);
  });

  it("rejects a non-positive duration", () => {
    expect(() => generateSlots(input({ eventType: { durationMinutes: 0 } }))).toThrow(/durationMinutes/);
  });

  it("rejects a malformed wall time", () => {
    expect(() =>
      generateSlots(
        input({ host: { weeklyRules: [{ dayOfWeek: MON, startTime: "9am", endTime: "12:00" }] } }),
      ),
    ).toThrow(/wall time/);
  });
});

describe("groupSlotsByDate", () => {
  it("groups by the viewer's date, which can differ from the host's", () => {
    // London host, Monday 18:00 GMT = Tuesday 03:00 in Tokyo.
    const slots = generateSlots(
      input({
        host: {
          timeZone: "Europe/London",
          weeklyRules: [{ dayOfWeek: MON, startTime: "18:00", endTime: "18:30" }],
        },
      }),
    );
    expect([...groupSlotsByDate(slots, "Europe/London").keys()]).toEqual(["2026-11-09"]);
    expect([...groupSlotsByDate(slots, "Asia/Tokyo").keys()]).toEqual(["2026-11-10"]);
  });
});
