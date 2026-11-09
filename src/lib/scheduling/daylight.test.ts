import { describe, expect, it } from "vitest";
import { availabilityWindows } from "./generate-slots";
import {
  bandSegments,
  dayBounds,
  daytimeOverlap,
  nearestToDaytime,
  nowPosition,
  offsetDifference,
  partOfDay,
  utcOffsetMinutes,
} from "./daylight";

// Sakif in Dhaka (UTC+6), Monday 9 Nov 2026, 09:00–17:00 = 03:00–11:00 UTC.
const dhakaHost = {
  timeZone: "Asia/Dhaka",
  weeklyRules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
  dateOverrides: [],
};
const week = { start: new Date("2026-11-07T00:00:00Z"), end: new Date("2026-11-14T00:00:00Z") };

describe("bandSegments", () => {
  it("London guest: one segment, 3–11 AM = 12.5% to 45.8% of their day", () => {
    const [seg, ...rest] = bandSegments(availabilityWindows(week, dhakaHost), "2026-11-09", "Europe/London");
    expect(rest).toEqual([]);
    expect(seg!.start.toISOString()).toBe("2026-11-09T03:00:00.000Z");
    expect(seg!.left).toBeCloseTo(12.5);
    expect(seg!.width).toBeCloseTo(33.33, 1);
  });

  it("New York guest: the host's day crosses their midnight, so two segments", () => {
    // Mon 9 Nov in New York (EST, UTC-5): 00:00–06:00 from Sakif's Monday,
    // and 22:00–24:00 from Sakif's Tuesday.
    const segs = bandSegments(availabilityWindows(week, dhakaHost), "2026-11-09", "America/New_York");
    expect(segs.map((s) => [s.start.toISOString(), s.end.toISOString()])).toEqual([
      ["2026-11-09T05:00:00.000Z", "2026-11-09T11:00:00.000Z"],
      ["2026-11-10T03:00:00.000Z", "2026-11-10T05:00:00.000Z"],
    ]);
    expect(segs[0]!.left).toBeCloseTo(0);
    expect(segs[1]!.left + segs[1]!.width).toBeCloseTo(100);
  });

  it("a day off has no segments", () => {
    const off = {
      ...dhakaHost,
      dateOverrides: [{ date: "2026-11-09" as const, startTime: null, endTime: null }],
    };
    expect(bandSegments(availabilityWindows(week, off), "2026-11-09", "Asia/Dhaka")).toEqual([]);
  });

  it("measures real time on a 23-hour DST day", () => {
    // London springs forward on 29 Mar 2026: that day is 23 hours long.
    const { start, end } = dayBounds("2026-03-29", "Europe/London");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    const window = { start: new Date("2026-03-29T11:00:00Z"), end: new Date("2026-03-29T12:00:00Z") };
    const [seg] = bandSegments([window], "2026-03-29", "Europe/London");
    expect(seg!.width).toBeCloseTo(100 / 23);
  });
});

describe("nowPosition", () => {
  it("places now on today's band and nowhere else", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    expect(nowPosition(now, "2026-11-09", "Europe/London")).toBeCloseTo(50);
    expect(nowPosition(now, "2026-11-10", "Europe/London")).toBeNull();
  });
});

describe("partOfDay", () => {
  it.each([
    ["2026-11-09T03:00:00Z", "early"],
    ["2026-11-09T06:00:00Z", "morning"],
    ["2026-11-09T13:00:00Z", "afternoon"],
    ["2026-11-09T18:00:00Z", "evening"],
    ["2026-11-09T22:00:00Z", "night"],
  ])("%s in London is %s", (iso, part) => {
    expect(partOfDay(new Date(iso), "Europe/London")).toBe(part);
  });

  it("depends on the viewer's zone: the same instant is early in London, morning in Dhaka", () => {
    const instant = new Date("2026-11-09T03:00:00Z");
    expect(partOfDay(instant, "Europe/London")).toBe("early");
    expect(partOfDay(instant, "Asia/Dhaka")).toBe("morning");
  });
});

describe("offsets", () => {
  const nov = new Date("2026-11-09T12:00:00Z");
  it.each([
    ["Asia/Dhaka", 360],
    ["Asia/Kolkata", 330],
    ["America/New_York", -300],
    ["UTC", 0],
  ])("%s is UTC%+d min in November", (zone, minutes) => {
    expect(utcOffsetMinutes(nov, zone)).toBe(minutes);
  });

  it("describes the difference from the guest's point of view", () => {
    expect(offsetDifference("Asia/Dhaka", "Europe/London", nov)).toBe("6 hours ahead");
    expect(offsetDifference("Asia/Dhaka", "Asia/Kolkata", nov)).toBe("30 minutes ahead");
    expect(offsetDifference("America/New_York", "Asia/Dhaka", nov)).toBe("11 hours behind");
    expect(offsetDifference("Asia/Dhaka", "Asia/Dhaka", nov)).toBeNull();
  });

  it("follows DST: London is 5 hours behind Dhaka in summer, 6 in winter", () => {
    expect(offsetDifference("Asia/Dhaka", "Europe/London", new Date("2026-07-01T12:00:00Z"))).toBe(
      "5 hours ahead",
    );
  });
});

describe("daytimeOverlap", () => {
  // Host: Dhaka 09:00–17:00 on Mon 9 Nov 2026 = 03:00–11:00 UTC.
  const dhakaDay = [{ start: new Date("2026-11-09T03:00:00Z"), end: new Date("2026-11-09T11:00:00Z") }];

  it("London: 3–11 AM for the guest, daytime part is 8–11 AM", () => {
    const overlap = daytimeOverlap(dhakaDay, "2026-11-09", "Europe/London");
    expect(overlap).toEqual([
      { start: new Date("2026-11-09T08:00:00Z"), end: new Date("2026-11-09T11:00:00Z") },
    ]);
  });

  it("New York: all of it is at night, so nothing overlaps", () => {
    // 10 PM Sun – 6 AM Mon in New York.
    expect(daytimeOverlap(dhakaDay, "2026-11-08", "America/New_York")).toEqual([]);
    expect(daytimeOverlap(dhakaDay, "2026-11-09", "America/New_York")).toEqual([]);
  });

  it("same timezone: the whole working day is daytime", () => {
    expect(daytimeOverlap(dhakaDay, "2026-11-09", "Asia/Dhaka")).toEqual(dhakaDay);
  });

  it("uses the guest's local 8 AM on a DST change day", () => {
    // London clocks go back on Sun 25 Oct 2026; 8 AM that day is 08:00 UTC (GMT).
    const all = [{ start: new Date("2026-10-25T00:00:00Z"), end: new Date("2026-10-26T00:00:00Z") }];
    expect(daytimeOverlap(all, "2026-10-25", "Europe/London")[0]?.start).toEqual(
      new Date("2026-10-25T08:00:00Z"),
    );
  });
});

describe("nearestToDaytime", () => {
  it("New York Monday: Sakif's hours end at 6 AM, before daytime starts", () => {
    const segments = [{ start: new Date("2026-11-09T05:00:00Z"), end: new Date("2026-11-09T11:00:00Z") }]; // 00:00–06:00 NY
    const near = nearestToDaytime(segments, "2026-11-09", "America/New_York");
    expect(near.endsBefore).toEqual(new Date("2026-11-09T11:00:00Z"));
    expect(near.startsAfter).toBeNull();
  });

  it("finds a window that starts after daytime ends", () => {
    const segments = [{ start: new Date("2026-11-09T03:00:00Z"), end: new Date("2026-11-09T05:00:00Z") }]; // 22:00–24:00 NY on the 8th
    const near = nearestToDaytime(segments, "2026-11-08", "America/New_York");
    expect(near.startsAfter).toEqual(new Date("2026-11-09T03:00:00Z"));
    expect(near.endsBefore).toBeNull();
  });
});
