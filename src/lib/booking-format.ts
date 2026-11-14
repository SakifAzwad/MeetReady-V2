import { formatDateKey, formatTime } from "./scheduling/calendar";
import { dateKeyInZone } from "./scheduling/time";
import type { LocationType } from "./validation/event-type";

/** "Monday, 9 November 2026, 4:00 AM – 4:30 AM (Europe/London)" */
export function formatWhen(start: Date, end: Date, timeZone: string): string {
  return `${formatDateKey(dateKeyInZone(start, timeZone))}, ${formatTime(start, timeZone)} – ${formatTime(end, timeZone)} (${timeZone.replaceAll("_", " ")})`;
}

export function locationText(b: {
  locationType: LocationType;
  locationValue: string | null;
  /** Created with the host's Google Calendar event (Day 16). */
  meetUrl?: string | null;
}): string {
  switch (b.locationType) {
    case "google_meet":
      return b.meetUrl ? `Google Meet: ${b.meetUrl}` : "Google Meet (link to follow)";
    case "zoom":
      return b.locationValue ?? "Zoom";
    case "phone":
      return `Phone: ${b.locationValue ?? ""}`;
    case "in_person":
      return b.locationValue ?? "In person";
  }
}
