"use client";

import { useState, useSyncExternalStore } from "react";
import { Band, BandTicks } from "@/components/daylight/band";
import { useHour12, useMinuteClock } from "@/components/daylight/preferences";
import {
  bandSegments,
  cityName,
  nowPosition,
  partOfDay,
  type PartOfDay,
  utcOffsetMinutes,
} from "@/lib/scheduling/daylight";
import { formatDateKey, formatTime, formatTimeRange } from "@/lib/scheduling/calendar";
import { availabilityWindows } from "@/lib/scheduling/generate-slots";
import { addDaysToKey, dateKeyInZone, wallTimeToInstant, type DateKey } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";

/*
 * The landing page demo: the host's day and the visitor's day on ONE timeline.
 * A vertical line through both bands is a single moment; only the colours
 * (each person's local time) differ. The working-hours brackets are the same
 * instants, so they line up: daylight on the host's band, often night on yours.
 *
 * The host is illustrative (not read from the database), but the maths is the
 * real thing: availabilityWindows is what generateSlots uses for bookings.
 */
export const HOST = {
  name: "Sakif",
  timeZone: "Asia/Dhaka",
  weeklyRules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
  dateOverrides: [],
};

const OTHER_CITIES = ["Europe/London", "America/New_York", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];

const STARTS: Record<PartOfDay, string> = {
  early: "before sunrise",
  morning: "in the morning",
  afternoon: "in the afternoon",
  evening: "in the evening",
  night: "late at night",
};

/** The browser's timezone; null on the server, so nothing guesses a zone. */
export function useBrowserZone(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}

export function HeroBands() {
  const browserZone = useBrowserZone();
  const now = useMinuteClock();
  const [hour12] = useHour12();
  const [picked, setPicked] = useState<string | null>(null);
  const zone = picked ?? browserZone;

  const cities = browserZone ? [browserZone, ...OTHER_CITIES.filter((c) => c !== browserZone)] : OTHER_CITIES;

  return (
    <div className="bg-card rounded-2xl border p-5 shadow-[0_1px_0_rgb(24_33_58/0.04)] sm:p-7">
      {zone && now ? <Timeline zone={zone} now={now} hour12={hour12} /> : <TimelineSkeleton />}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-5">
        <span className="text-muted-foreground mr-1 text-sm">See it from</span>
        {cities.map((city) => {
          const active = city === zone;
          return (
            <button
              key={city}
              type="button"
              aria-pressed={active}
              onClick={() => setPicked(city === browserZone ? null : city)}
              className={cn(
                "focus-visible:ring-ring/50 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px]",
                active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
              )}
            >
              {cityName(city)}
              {city === browserZone && <span className="sr-only"> (your timezone)</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Timeline({ zone, now, hour12 }: { zone: string; now: Date; hour12: boolean }) {
  const today = dateKeyInZone(now, zone);
  const windows = availabilityWindows(
    { start: new Date(now.getTime() - 86_400_000), end: new Date(now.getTime() + 9 * 86_400_000) },
    HOST,
  );

  // Today if the host works during it, otherwise the next day they do.
  let day: DateKey = today;
  for (let i = 0; i < 8; i++) {
    const candidate = addDaysToKey(today, i);
    if (bandSegments(windows, candidate, zone).length > 0) {
      day = candidate;
      break;
    }
  }

  const segments = bandSegments(windows, day, zone);
  const nowAt = nowPosition(now, day, zone);
  const noon = wallTimeToInstant(day, "12:00", zone);
  const shiftHours = (utcOffsetMinutes(noon, HOST.timeZone) - utcOffsetMinutes(noon, zone)) / 60;
  const sameZone = shiftHours === 0;

  const hostCity = cityName(HOST.timeZone);
  const yourCity = cityName(zone);
  const workday = windows.find((w) => segments[0] && w.end > segments[0].start && w.start < segments[0].end);

  return (
    <div>
      <p className="text-muted-foreground mb-4 text-sm">
        {day === today ? "Today" : `${formatDateKey(day)}. ${HOST.name} isn't working before then.`}
      </p>

      <div className="grid grid-cols-1 items-center gap-x-6 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Label who={HOST.name} city={hostCity} time={formatTime(now, HOST.timeZone, hour12)} />
        <Band segments={segments} nowAt={nowAt} shiftHours={shiftHours} />

        <Label who="You" city={yourCity} time={formatTime(now, zone, hour12)} className="mt-3 sm:mt-0" />
        <Band segments={segments} nowAt={nowAt} />

        <div className="hidden sm:block" />
        <BandTicks hour12={hour12} />
      </div>

      <p className="mt-5 max-w-[60ch] text-[17px] leading-relaxed">
        {!workday ? null : sameZone ? (
          <>
            You&apos;re on {hostCity} time too, so {HOST.name}&apos;s{" "}
            {formatTimeRange(workday.start, workday.end, zone, hour12)} is yours. Try another city below.
          </>
        ) : (
          <>
            {HOST.name} works {formatTimeRange(workday.start, workday.end, HOST.timeZone, hour12)} in{" "}
            {hostCity}. That&apos;s {formatTimeRange(workday.start, workday.end, zone, hour12)} for you in{" "}
            {yourCity}, starting {STARTS[partOfDay(workday.start, zone)]}.
          </>
        )}
      </p>
    </div>
  );
}

function Label({
  who,
  city,
  time,
  className,
}: {
  who: string;
  city: string;
  time: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 sm:flex-col sm:gap-0", className)}>
      <span className="font-display text-lg leading-tight font-semibold">
        {who} <span className="text-muted-foreground font-normal">in {city}</span>
      </span>
      <span className="text-muted-foreground tabular text-sm">{time} now</span>
    </div>
  );
}

/** Same shape as the timeline, so nothing jumps when the visitor's timezone arrives. */
function TimelineSkeleton() {
  return (
    <div aria-hidden>
      <div className="bg-muted mb-4 h-5 w-24 rounded" />
      <div className="grid grid-cols-1 items-center gap-x-6 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="bg-muted h-11 rounded" />
        <div className="bg-muted h-12 rounded-xl" />
        <div className="bg-muted mt-3 h-11 rounded sm:mt-0" />
        <div className="bg-muted h-12 rounded-xl" />
        <div className="hidden sm:block" />
        <div className="h-4" />
      </div>
      <div className="bg-muted mt-5 h-14 max-w-[60ch] rounded" />
    </div>
  );
}
