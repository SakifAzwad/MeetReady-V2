import { describe, expect, it } from "vitest";
import { momentReadout } from "./readout";

// Sakif, Dhaka 09:00–17:00 on Tue 10 Nov 2026 = 03:00–11:00 UTC.
const windows = [{ start: new Date("2026-11-10T03:00:00Z"), end: new Date("2026-11-10T11:00:00Z") }];
const base = { hostZone: "Asia/Dhaka", hostName: "Sakif Azwad", windows };

describe("momentReadout", () => {
  it("London afternoon: evening and dark in Dhaka, outside his hours", () => {
    const r = momentReadout({
      ...base,
      instant: new Date("2026-11-10T14:00:00Z"),
      guestZone: "Europe/London",
    });
    expect(r.lines).toEqual([
      "2:00 PM for you",
      "8:00 PM in Dhaka, after sunset",
      "Outside Sakif's working hours",
    ]);
    expect(r.text).toBe("2:00 PM for you. 8:00 PM in Dhaka, after sunset. Outside Sakif's working hours.");
  });

  it("London early morning: dark for the guest, working hours in Dhaka", () => {
    const r = momentReadout({
      ...base,
      instant: new Date("2026-11-10T04:00:00Z"),
      guestZone: "Europe/London",
    });
    expect(r.lines).toEqual([
      "4:00 AM for you, before sunrise",
      "10:00 AM in Dhaka",
      "In Sakif's working hours",
    ]);
  });

  it("same timezone: one clock", () => {
    const r = momentReadout({ ...base, instant: new Date("2026-11-10T06:00:00Z"), guestZone: "Asia/Dhaka" });
    expect(r.lines).toEqual(["12:00 PM", "In Sakif's working hours"]);
  });

  it("24-hour clocks, and the end of the hours is exclusive", () => {
    const r = momentReadout({
      ...base,
      instant: new Date("2026-11-10T11:00:00Z"),
      guestZone: "Europe/Berlin",
      hour12: false,
    });
    expect(r.lines[0]).toBe("12:00 for you");
    expect(r.lines.at(-1)).toBe("Outside Sakif's working hours");
  });
});
