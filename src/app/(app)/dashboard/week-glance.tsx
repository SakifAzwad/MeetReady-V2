import { Band } from "@/components/daylight/band";
import { formatTimeRange } from "@/lib/scheduling/calendar";
import { bandSegments, dayBounds, nowPosition } from "@/lib/scheduling/daylight";
import { availabilityWindows } from "@/lib/scheduling/generate-slots";
import type { Interval } from "@/lib/scheduling/intervals";
import { addDaysToKey, dateKeyInZone, type DateKey } from "@/lib/scheduling/time";
import type { HostAvailability } from "@/server/availability";

/*
 * The host's next seven days, each as a daylight band in their own timezone:
 * brackets are working hours (date overrides included), filled blocks are
 * booked meetings. Same drawing as the booking page, so hosts learn to read
 * it once. Rendered on the server: it's the host's own zone, known from the DB.
 */
export function WeekGlance({
  availability,
  meetings,
  now,
}: {
  availability: HostAvailability;
  meetings: Interval[];
  now: Date;
}) {
  const tz = availability.timeZone;
  const today = dateKeyInZone(now, tz);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(today, i));
  const windows = availabilityWindows(
    { start: dayBounds(today, tz).start, end: dayBounds(days[6]!, tz).end },
    {
      timeZone: tz,
      weeklyRules: availability.rules,
      // Postgres `date` arrives as a "YYYY-MM-DD" string: exactly the DateKey format.
      dateOverrides: availability.overrides.map((o) => ({ ...o, date: o.date as DateKey })),
    },
  );

  return (
    <ul className="flex flex-col gap-2.5">
      {days.map((day) => {
        const hours = bandSegments(windows, day, tz);
        const booked = bandSegments(meetings, day, tz);
        return (
          <li
            key={day}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[4.5rem_minmax(0,1fr)_9rem]"
          >
            <span className={day === today ? "font-semibold" : "text-muted-foreground"}>
              {dayLabel(day, today)}
            </span>
            <Band segments={hours} nowAt={nowPosition(now, day, tz)} className="h-8 rounded-lg">
              {booked.map((m) => (
                <span
                  key={m.left}
                  className="absolute inset-y-2 rounded-[3px] bg-[rgb(24_33_58)]"
                  style={{ left: `calc(${m.left}% + 1px)`, width: `max(calc(${m.width}% - 2px), 4px)` }}
                />
              ))}
            </Band>
            <span className="text-muted-foreground tabular col-start-2 text-sm sm:col-start-auto">
              {hours.length === 0
                ? "Day off"
                : hours.map((h) => formatTimeRange(h.start, h.end, tz)).join(", ")}
              {booked.length > 0 && (
                <span className="text-foreground sm:block">
                  <span className="sm:hidden">, </span>
                  {booked.length} meeting{booked.length === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function dayLabel(day: DateKey, today: DateKey): string {
  if (day === today) return "Today";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}
