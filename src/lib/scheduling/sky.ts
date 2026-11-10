import { formatTime } from "./calendar";
import type { Interval } from "./intervals";
import { solarPosition, sunDay, sunPhase, type SunDay } from "./sun";
import { addDaysToKey, wallTimeToInstant, type DateKey } from "./time";
import { ZONE_ALIASES, ZONES } from "./zone-data.generated";

/*
 * The band's colours, from the real sun: for a timezone and a stretch of
 * time (usually one local day), a CSS gradient whose dawn, day and dusk sit
 * where the sun actually rises and sets in that zone's principal city on
 * those dates. London in November gets a short day; London in June a long
 * one; Svalbard in December none at all.
 *
 * Positions are in real elapsed time across `range`, like the brackets, so a
 * band of the HOST's sky drawn on the GUEST's timeline (the landing page)
 * needs nothing special: same function, different zone.
 */

const DAY_MS = 86_400_000;
const COLOR = {
  night: "var(--night)",
  dawn: "var(--dawn)",
  day: "var(--band-day)",
  noon: "var(--band-noon)",
  duskLight: "color-mix(in oklab, var(--dusk), white 35%)",
  dusk: "var(--dusk)",
} as const;
type Stop = { at: number; color: string };

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10) as DateKey;

/** [lat, lon] of the zone's principal city, or null (UTC, Etc/GMT+5…: no place, no sun). */
export function zoneCoordinates(zone: string): readonly [number, number] | null {
  const row = ZONES[ZONE_ALIASES[zone] ?? zone];
  return row ? [row[1], row[2]] : null;
}

/** Colour keyframes (instants) for one sun day. */
function keyframes(d: SunDay, lat: number | null, lon: number | null): Stop[] {
  const noon = d.solarNoon.getTime();
  if (d.polar === "day") {
    return [
      { at: noon - DAY_MS / 2, color: COLOR.day },
      { at: noon, color: COLOR.noon },
    ];
  }
  if (d.polar === "night") {
    // Some polar-night days still get a twilight glow at noon (sun within 6° of the horizon).
    const glow = lat !== null && lon !== null && sunPhase(d.solarNoon, lat, lon) === "twilight";
    return [
      { at: noon - DAY_MS / 2, color: COLOR.night },
      { at: noon, color: glow ? COLOR.dusk : COLOR.night },
    ];
  }
  const rise = d.sunrise!.getTime();
  const set = d.sunset!.getTime();
  const stops: Stop[] = [];
  // White nights: no civil darkness, so the night is a dusk glow instead of navy.
  if (d.dawn) stops.push({ at: d.dawn.getTime(), color: COLOR.night });
  else stops.push({ at: noon - DAY_MS / 2, color: COLOR.dusk });
  stops.push(
    { at: rise, color: COLOR.dawn },
    { at: rise + 0.3 * (noon - rise), color: COLOR.day },
    { at: noon, color: COLOR.noon },
    { at: set - 0.3 * (set - noon), color: COLOR.day },
    { at: set, color: COLOR.duskLight },
  );
  if (d.dusk) {
    const dusk = d.dusk.getTime();
    stops.push({ at: dusk, color: COLOR.dusk }, { at: dusk + 0.7 * (dusk - set), color: COLOR.night });
  }
  return stops;
}

/**
 * For zones with no place (UTC): the same fixed, symbolic day the bands used
 * before real sun data (first light 4 AM, sunrise 6, sunset 6:30 PM, dark by
 * about 8), so they still read as a day.
 */
function symbolicDay(day: DateKey, zone: string): SunDay {
  const at = (t: string) => wallTimeToInstant(day, t, zone);
  return {
    solarNoon: at("12:30"),
    sunrise: at("06:00"),
    sunset: at("18:30"),
    dawn: at("04:00"),
    dusk: at("19:15"),
    polar: null,
  };
}

/** Sun days touching `range`, with a margin so the gradient is defined past both ends. */
function sunDays(zone: string, range: Interval): { days: SunDay[]; lat: number | null; lon: number | null } {
  const coords = zoneCoordinates(zone);
  // UTC dates straight from the ISO string, not dateKeyInZone(…, "UTC"): that builds a
  // TZDate, whose constructor reads the clock, which static pages may not do (see Day 9).
  const first = utcDate(range.start.getTime() - 2 * DAY_MS);
  const last = utcDate(range.end.getTime() + 2 * DAY_MS);
  const days: SunDay[] = [];
  for (let d = first; d <= last; d = addDaysToKey(d, 1)) {
    days.push(coords ? sunDay(d, coords[0], coords[1]) : symbolicDay(d, zone));
  }
  return { days, lat: coords?.[0] ?? null, lon: coords?.[1] ?? null };
}

/** The CSS gradient for `zone`'s sky across `range` (left = range.start). */
export function skyGradient(zone: string, range: Interval): string {
  const { days, lat, lon } = sunDays(zone, range);
  const start = range.start.getTime();
  const length = range.end.getTime() - start;
  const stops = days
    .flatMap((d) => keyframes(d, lat, lon))
    .sort((a, b) => a.at - b.at)
    .map((s) => ({ pos: ((s.at - start) / length) * 100, color: s.color }))
    // CSS accepts stops outside 0–100%; keep one day either side so both ends are right.
    .filter((s) => s.pos > -150 && s.pos < 250);
  return `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${s.pos.toFixed(2)}%`).join(", ")})`;
}

/** "Sunrise 7:10 AM, sunset 4:18 PM", "The sun doesn't rise", "The sun doesn't set", or null (no place). */
export function sunSummary(zone: string, day: DateKey, hour12 = true): string | null {
  const coords = zoneCoordinates(zone);
  if (!coords) return null;
  const midday = wallTimeToInstant(day, "12:00", zone);
  // The sun day whose noon is nearest this local midday.
  const candidates = [-1, 0, 1].map((n) =>
    sunDay(utcDate(midday.getTime() + n * DAY_MS), coords[0], coords[1]),
  );
  const d = candidates.reduce((best, c) =>
    Math.abs(c.solarNoon.getTime() - midday.getTime()) < Math.abs(best.solarNoon.getTime() - midday.getTime())
      ? c
      : best,
  );
  if (d.polar === "night") return "The sun doesn't rise";
  if (d.polar === "day") return "The sun doesn't set";
  return `Sunrise ${formatTime(d.sunrise!, zone, hour12)}, sunset ${formatTime(d.sunset!, zone, hour12)}`;
}

/** "after sunset", "before sunrise", "at twilight", or null (daylight, or no place). */
export function darkness(instant: Date, zone: string): string | null {
  const coords = zoneCoordinates(zone);
  if (!coords) return null;
  const phase = sunPhase(instant, coords[0], coords[1]);
  if (phase === "day") return null;
  const morning = solarPosition(instant, coords[0], coords[1]).hourAngle < 0;
  if (phase === "twilight") return morning ? "at first light" : "at dusk";
  return morning ? "before sunrise" : "after sunset";
}
