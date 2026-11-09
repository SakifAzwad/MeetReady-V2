import { describe, expect, it } from "vitest";
import { dayLoad } from "./day-load";

const t = (iso: string) => new Date(`2026-11-09T${iso}:00Z`);
const NINE_TO_FIVE = [{ start: t("09:00"), end: t("17:00") }]; // host in UTC
const EARLY = new Date("2026-01-01T00:00:00Z"); // "now" before everything, unless a test says otherwise

describe("dayLoad", () => {
  it("an empty working day is all free", () => {
    expect(dayLoad(NINE_TO_FIVE, [], "2026-11-09", "UTC", EARLY)).toEqual({
      workingMinutes: 480,
      bookedMinutes: 0,
      freeMinutes: 480,
    });
  });

  it("subtracts meetings, counting overlapping ones once", () => {
    const meetings = [
      { start: t("10:00"), end: t("11:00") },
      { start: t("10:30"), end: t("11:30") },
      { start: t("14:00"), end: t("14:30") },
    ];
    expect(dayLoad(NINE_TO_FIVE, meetings, "2026-11-09", "UTC", EARLY)).toEqual({
      workingMinutes: 480,
      bookedMinutes: 120,
      freeMinutes: 360,
    });
  });

  it("a meeting outside working hours is booked time, but free time never goes negative", () => {
    const load = dayLoad(NINE_TO_FIVE, [{ start: t("18:00"), end: t("19:00") }], "2026-11-09", "UTC", EARLY);
    expect(load).toEqual({ workingMinutes: 480, bookedMinutes: 60, freeMinutes: 480 });
  });

  it("a day off has no working or free time", () => {
    expect(dayLoad([], [], "2026-11-09", "UTC", EARLY)).toEqual({
      workingMinutes: 0,
      bookedMinutes: 0,
      freeMinutes: 0,
    });
  });

  it("only counts the part of a window or meeting that falls on that day", () => {
    // 22:00–02:00 Dhaka night shift seen on the Monday: only 22:00–24:00 Dhaka counts.
    const shift = [{ start: new Date("2026-11-09T16:00:00Z"), end: new Date("2026-11-09T20:00:00Z") }];
    expect(dayLoad(shift, [], "2026-11-09", "Asia/Dhaka", EARLY).workingMinutes).toBe(120);
  });

  it("measures real time on a 25-hour DST day", () => {
    // London, Sun 25 Oct 2026: clocks go back, the day is 25 hours long.
    const allDay = [{ start: new Date("2026-10-24T23:00:00Z"), end: new Date("2026-10-26T00:00:00Z") }];
    expect(dayLoad(allDay, [], "2026-10-25", "Europe/London", EARLY).workingMinutes).toBe(25 * 60);
  });

  it("doesn't count time that has already passed as free", () => {
    // At 13:00: 09:00–13:00 is gone; 13:00–17:00 is 4 h, minus the 14:00 meeting.
    const load = dayLoad(
      NINE_TO_FIVE,
      [{ start: t("14:00"), end: t("15:00") }],
      "2026-11-09",
      "UTC",
      t("13:00"),
    );
    expect(load).toEqual({ workingMinutes: 480, bookedMinutes: 60, freeMinutes: 180 });
    expect(dayLoad(NINE_TO_FIVE, [], "2026-11-09", "UTC", t("18:00")).freeMinutes).toBe(0);
  });
});
