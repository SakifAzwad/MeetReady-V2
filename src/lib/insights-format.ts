import type { DateKey } from "./scheduling/time";

/*
 * Small, pure pieces of the Insights charts (Day 25), kept out of the
 * components so they're tested on their own.
 */

/** Clean axis ticks from 0 up to at least `max`: steps of 1, 2 or 5 × 10ⁿ, at most 5 ticks. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw && s >= 1) ?? Math.ceil(raw);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** "33%", or a dash when there was nothing to divide by. */
export function percent(rate: number | null): string {
  if (rate === null) return "–";
  const value = rate * 100;
  return `${value > 0 && value < 1 ? "<1" : Math.round(value)}%`;
}

/** A week by its Monday ("16 Nov"), a month by its name ("Nov"). */
export function bucketLabel(key: DateKey, unit: "week" | "month"): string {
  return new Intl.DateTimeFormat("en-GB", {
    ...(unit === "week" ? { day: "numeric" } : {}),
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00Z`));
}

/** The full name, for tooltips and the table: "Week of 16 Nov 2026", "November 2026". */
export function bucketName(key: DateKey, unit: "week" | "month"): string {
  const date = new Date(`${key}T12:00:00Z`);
  return unit === "week"
    ? `Week of ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)}`
    : new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/**
 * A heat-grid cell's step, 0 (none) to 3: thirds of the busiest cell. Three
 * steps because the dataviz validator passes only three of one navy against
 * the card (a fourth, lighter step falls below 2:1 contrast).
 */
export function heatLevel(meetings: number, busiest: number): 0 | 1 | 2 | 3 {
  if (meetings <= 0 || busiest <= 0) return 0;
  const share = meetings / busiest;
  return share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1;
}

/** "1 meeting", "3 meetings". */
export const meetings = (n: number) => `${n} ${n === 1 ? "meeting" : "meetings"}`;
