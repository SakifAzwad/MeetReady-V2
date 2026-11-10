import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { ViewTransition } from "react";
import { Band } from "@/components/daylight/band";
import { Card } from "@/components/ui/card";
import { formatHours } from "@/lib/format";
import { formatDateKey, formatTimeRange } from "@/lib/scheduling/calendar";
import { dayLoad, type DayLoad } from "@/lib/scheduling/day-load";
import { bandSegments, cityName, dayBounds, nowPosition } from "@/lib/scheduling/daylight";
import { availabilityWindows } from "@/lib/scheduling/generate-slots";
import { skyGradient } from "@/lib/scheduling/sky";
import type { Interval } from "@/lib/scheduling/intervals";
import { dateKeyInZone, type DateKey } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";
import { MAX_WEEK_OFFSET, weekDays } from "@/lib/week";
import type { HostAvailability } from "@/server/availability";

const STEP = { "step-forward": "step-forward", "step-back": "step-back", default: "none" };

/*
 * Seven days, each as a daylight band in the host's own timezone: brackets
 * are working hours (date overrides included), filled blocks are booked
 * meetings, and each row says how much is booked and how much is still free.
 * Arrows page by 7 days; the rows slide in the direction you went.
 */
export function WeekGlance({
  availability,
  meetings,
  now,
  offset,
}: {
  availability: HostAvailability;
  meetings: Interval[];
  now: Date;
  offset: number;
}) {
  const tz = availability.timeZone;
  const today = dateKeyInZone(now, tz);
  const days = weekDays(now, tz, offset);
  const windows = availabilityWindows(
    { start: dayBounds(days[0]!, tz).start, end: dayBounds(days[6]!, tz).end },
    {
      timeZone: tz,
      weeklyRules: availability.rules,
      // Postgres `date` arrives as a "YYYY-MM-DD" string: exactly the DateKey format.
      dateOverrides: availability.overrides.map((o) => ({ ...o, date: o.date as DateKey })),
    },
  );
  const loads = days.map((day) => dayLoad(windows, meetings, day, tz, now));
  const total = loads.reduce(
    (sum, l) => ({ booked: sum.booked + l.bookedMinutes, free: sum.free + l.freeMinutes }),
    { booked: 0, free: 0 },
  );
  const title =
    offset === 0
      ? "Your next 7 days"
      : `${formatDateKey(days[0]!, "short")} to ${formatDateKey(days[6]!, "short")}`;

  return (
    <section aria-labelledby="week-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h2 id="week-heading" className="text-xl font-semibold">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">
            {formatHours(total.booked)} booked, {formatHours(total.free)} free, in {cityName(tz)} time.{" "}
            <Link href="/dashboard/availability" className="text-foreground underline underline-offset-4">
              Change your hours
            </Link>
          </p>
        </div>
        <nav aria-label="Weeks" className="flex items-center gap-1">
          {offset !== 0 && (
            <Link
              href="/dashboard"
              transitionTypes={[offset > 0 ? "step-back" : "step-forward"]}
              className="hover:bg-accent mr-1 rounded-md px-2.5 py-1.5 text-sm"
            >
              Back to today
            </Link>
          )}
          <WeekLink offset={offset - 1} label="Previous 7 days" direction="step-back">
            <ChevronLeft className="size-4" />
          </WeekLink>
          <WeekLink offset={offset + 1} label="Next 7 days" direction="step-forward">
            <ChevronRight className="size-4" />
          </WeekLink>
        </nav>
      </div>

      <Card className="gap-4">
        <ViewTransition key={offset} enter={STEP} exit={STEP} default="none">
          <ul className="flex flex-col gap-2.5">
            {days.map((day, i) => (
              <DayRow
                key={day}
                day={day}
                today={today}
                tz={tz}
                load={loads[i]!}
                hours={bandSegments(windows, day, tz)}
                booked={bandSegments(meetings, day, tz)}
                nowAt={nowPosition(now, day, tz)}
              />
            ))}
          </ul>
        </ViewTransition>
        <p className="text-muted-foreground border-t pt-3 text-sm">
          Outlined: your working hours. Filled: booked meetings. The white line is now.
        </p>
      </Card>
    </section>
  );
}

function WeekLink({
  offset,
  label,
  direction,
  children,
}: {
  offset: number;
  label: string;
  direction: "step-forward" | "step-back";
  children: React.ReactNode;
}) {
  const disabled = Math.abs(offset) > MAX_WEEK_OFFSET;
  const className = "grid size-9 place-items-center rounded-md border transition-colors";
  if (disabled)
    return (
      <span aria-disabled className={cn(className, "opacity-40")} title={label}>
        {children}
      </span>
    );
  return (
    <Link
      href={offset === 0 ? "/dashboard" : `/dashboard?week=${offset}`}
      aria-label={label}
      transitionTypes={[direction]}
      scroll={false}
      className={cn(className, "bg-card hover:bg-accent active:scale-95")}
    >
      {children}
    </Link>
  );
}

function DayRow({
  day,
  today,
  tz,
  load,
  hours,
  booked,
  nowAt,
}: {
  day: DateKey;
  today: DateKey;
  tz: string;
  load: DayLoad;
  hours: { start: Date; end: Date; left: number; width: number }[];
  booked: { left: number; width: number }[];
  nowAt: number | null;
}) {
  const past = day < today;
  return (
    <li
      className={cn(
        "grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[4.5rem_minmax(0,1fr)_11rem]",
        past && "opacity-60",
      )}
    >
      <span className={day === today ? "font-semibold" : "text-muted-foreground"}>
        {dayLabel(day, today)}
      </span>
      <Band
        segments={hours}
        nowAt={nowAt}
        gradient={skyGradient(tz, dayBounds(day, tz))}
        className="h-8 rounded-lg"
      >
        {booked.map((m) => (
          <span
            key={m.left}
            className="absolute inset-y-2 rounded-[3px] bg-[rgb(24_33_58)]"
            style={{ left: `calc(${m.left}% + 1px)`, width: `max(calc(${m.width}% - 2px), 4px)` }}
          />
        ))}
      </Band>
      <span className="tabular col-start-2 text-sm sm:col-start-auto">
        <span className="text-muted-foreground">
          {hours.length === 0 ? "Day off" : hours.map((h) => formatTimeRange(h.start, h.end, tz)).join(", ")}
        </span>
        <span className="sm:block">
          <span className="text-muted-foreground sm:hidden">, </span>
          {loadText(load)}
        </span>
      </span>
    </li>
  );
}

/**
 * "1.5 h booked, 6.5 h free", "8 h free", "No free time left" (today after
 * hours, past days), or "" for an empty day off.
 */
function loadText({ workingMinutes, bookedMinutes, freeMinutes }: DayLoad): string {
  const booked = bookedMinutes ? `${formatHours(bookedMinutes)} booked` : "";
  if (workingMinutes === 0) return booked;
  const free = freeMinutes ? `${formatHours(freeMinutes)} free` : "no free time left";
  const text = [booked, free].filter(Boolean).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayLabel(day: DateKey, today: DateKey): string {
  if (day === today) return "Today";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}
