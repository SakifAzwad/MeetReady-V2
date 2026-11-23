import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { intersectAll, intersectIntervals, mergeIntervals, overlaps, subtractInterval } from "./intervals";
import { addDaysToKey, dateKeyInZone, dayOfWeek, wallTimeToInstant } from "./time";

const i = (a: string, b: string) => ({
  start: new Date(`2026-11-09T${a}:00Z`),
  end: new Date(`2026-11-09T${b}:00Z`),
});

describe("overlaps (half-open)", () => {
  it.each([
    ["10:00", "11:00", "10:30", "11:30", true],
    ["10:00", "11:00", "10:15", "10:45", true], // containment
    ["10:00", "11:00", "11:00", "12:00", false], // touching is not overlapping
    ["10:00", "11:00", "12:00", "13:00", false],
  ])("[%s,%s) vs [%s,%s) -> %s", (a, b, c, e, expected) => {
    expect(overlaps(i(a, b), i(c, e))).toBe(expected);
    expect(overlaps(i(c, e), i(a, b))).toBe(expected); // symmetric
  });
});

describe("mergeIntervals", () => {
  it("merges overlapping and touching intervals, regardless of input order", () => {
    const merged = mergeIntervals([
      i("13:00", "14:00"),
      i("09:00", "10:00"),
      i("09:30", "11:00"),
      i("11:00", "12:00"),
    ]);
    expect(merged).toEqual([i("09:00", "12:00"), i("13:00", "14:00")]);
  });

  it("drops empty intervals", () => {
    expect(mergeIntervals([i("10:00", "10:00")])).toEqual([]);
  });
});

describe("time helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  it("returns the weekday of a date key", () => {
    expect(dayOfWeek("2026-11-09")).toBe(1);
  });

  it("finds the local date of an instant", () => {
    expect(dateKeyInZone(new Date("2026-11-09T20:00:00Z"), "UTC")).toBe("2026-11-09");
    expect(dateKeyInZone(new Date("2026-11-09T20:00:00Z"), "Asia/Dhaka")).toBe("2026-11-10");
  });

  it("treats 24:00 as midnight at the end of the day", () => {
    expect(wallTimeToInstant("2026-11-09", "24:00", "Asia/Dhaka").toISOString()).toBe(
      "2026-11-09T18:00:00.000Z",
    );
  });
});

describe("subtractInterval (rescheduling: cut the booking's own event out of busy times)", () => {
  const t = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00Z`);
  const iv = (a: string, b: string) => ({ start: t(a), end: t(b) });
  const show = (list: { start: Date; end: Date }[]) =>
    list.map((i) => `${i.start.toISOString().slice(11, 16)}-${i.end.toISOString().slice(11, 16)}`);

  it("removes a block that is exactly the booking", () => {
    expect(show(subtractInterval([iv("10:00", "10:30")], iv("10:00", "10:30")))).toEqual([]);
  });

  it("keeps a meeting right after it, even when Google merged the two into one block", () => {
    // Booking 10:00–10:30 + another meeting 10:30–11:00 arrive from free/busy as 10:00–11:00.
    expect(show(subtractInterval([iv("10:00", "11:00")], iv("10:00", "10:30")))).toEqual(["10:30-11:00"]);
  });

  it("splits a block when the booking is in the middle", () => {
    expect(show(subtractInterval([iv("09:00", "12:00")], iv("10:00", "10:30")))).toEqual([
      "09:00-10:00",
      "10:30-12:00",
    ]);
  });

  it("leaves blocks that don't overlap, including ones that only touch (half-open)", () => {
    expect(
      show(subtractInterval([iv("09:00", "10:00"), iv("10:30", "11:00")], iv("10:00", "10:30"))),
    ).toEqual(["09:00-10:00", "10:30-11:00"]);
  });
});

describe("intersectIntervals (Day 29: when are both free?)", () => {
  it("keeps only the shared part", () => {
    expect(intersectIntervals([i("09:00", "17:00")], [i("13:00", "21:00")])).toEqual([i("13:00", "17:00")]);
  });

  it("handles several pieces on each side, unsorted and overlapping", () => {
    const ada = [i("13:00", "15:00"), i("09:00", "11:00"), i("10:00", "12:00")]; // = 09–12, 13–15
    const grace = [i("11:00", "14:00"), i("14:30", "18:00")];
    expect(intersectIntervals(ada, grace)).toEqual([
      i("11:00", "12:00"),
      i("13:00", "14:00"),
      i("14:30", "15:00"),
    ]);
  });

  it("gives nothing for intervals that only touch, or don't meet", () => {
    expect(intersectIntervals([i("09:00", "12:00")], [i("12:00", "13:00")])).toEqual([]);
    expect(intersectIntervals([i("09:00", "10:00")], [])).toEqual([]);
  });

  it("intersectAll: three people, and no people", () => {
    expect(
      intersectAll([
        [i("09:00", "17:00")],
        [i("10:00", "18:00")],
        [i("08:00", "11:30"), i("16:00", "20:00")],
      ]),
    ).toEqual([i("10:00", "11:30"), i("16:00", "17:00")]);
    expect(intersectAll([])).toEqual([]);
  });

  it("property: a minute is in the result exactly when it's in both lists", () => {
    const day = Date.UTC(2026, 10, 9);
    const minute = 60_000;
    const interval = fc
      .tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 1, max: 300 }))
      .map(([s, len]) => ({
        start: new Date(day + s * minute),
        end: new Date(day + Math.min(1440, s + len) * minute),
      }));
    const list = fc.array(interval, { maxLength: 6 });
    const contains = (xs: { start: Date; end: Date }[], t: number) =>
      xs.some((x) => x.start.getTime() <= t && t < x.end.getTime());
    fc.assert(
      fc.property(list, list, (a, b) => {
        const both = intersectIntervals(a, b);
        for (let m = 0; m < 1440; m += 7) {
          const t = day + m * minute;
          if (contains(both, t) !== (contains(a, t) && contains(b, t))) return false;
        }
        // Sorted, and no two pieces touch or overlap.
        return both.every((x, k) => k === 0 || both[k - 1]!.end.getTime() < x.start.getTime());
      }),
    );
  });
});
