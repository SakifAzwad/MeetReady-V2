"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useHour12, useMinuteClock } from "@/components/daylight/preferences";
import { Button } from "@/components/ui/button";
import { DaylightBand } from "@/app/[username]/[slug]/daylight-band";
import { FactsPanel } from "@/app/[username]/[slug]/facts-panel";
import { TimeList } from "@/app/[username]/[slug]/time-list";
import { formatDateKey, formatTime } from "@/lib/scheduling/calendar";
import { cityName, dayBounds, isInDaytime } from "@/lib/scheduling/daylight";
import { availabilityWindows, generateSlots, type Slot } from "@/lib/scheduling/generate-slots";
import { addDaysToKey, dateKeyInZone, wallTimeToInstant } from "@/lib/scheduling/time";
import { HOST, useBrowserZone } from "./hero-bands";

/*
 * "What your guests see": the real booking-page components (facts panel,
 * band, time list) fed with sample data instead of the API. The times come
 * from the real generateSlots, with two meetings already booked so the gaps
 * show that taken times disappear. Selecting a time works like the real page.
 */
const EVENT = {
  username: "sakif",
  slug: "intro",
  title: "Intro call",
  description: null,
  durationMinutes: 30,
  hostName: "Sakif Azwad",
  hostTimeZone: HOST.timeZone,
  locationLabel: "Google Meet",
};
const SHOWN = 6;

export function GuestPreview() {
  const zone = useBrowserZone();
  const now = useMinuteClock();
  const [hour12] = useHour12();
  const [selected, setSelected] = useState<Slot | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);

  if (!zone || !now) return <div aria-hidden className="bg-muted h-[34rem] rounded-2xl" />;

  // The visitor's next day (from tomorrow) on which the sample host works.
  const tomorrow = addDaysToKey(dateKeyInZone(now, zone), 1);
  const lookahead = {
    start: dayBounds(tomorrow, zone).start,
    end: dayBounds(addDaysToKey(tomorrow, 7), zone).end,
  };
  const windows = availabilityWindows(lookahead, HOST);
  const day = dateKeyInZone(windows[0]?.start ?? lookahead.start, zone);
  const hostDay = dateKeyInZone(windows[0]?.start ?? lookahead.start, HOST.timeZone);
  const booked = (from: string, to: string) => ({
    start: wallTimeToInstant(hostDay, from, HOST.timeZone),
    end: wallTimeToInstant(hostDay, to, HOST.timeZone),
  });
  const slots = generateSlots({
    range: dayBounds(day, zone),
    now,
    host: HOST,
    eventType: {
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minimumNoticeMinutes: 0,
      bookingWindowDays: null,
      maxBookingsPerDay: null,
    },
    busy: [booked("10:00", "11:00"), booked("14:00", "15:00")],
  });

  // With daytime times, the list folds the rest away itself. Without any (New York),
  // nothing is folded, so cap the sample at a few rows to keep the section short.
  const shown = slots.some((s) => isInDaytime(s, zone)) ? slots : slots.slice(0, SHOWN);

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-[0_24px_60px_-30px_rgb(24_33_58/0.35)]">
      <div className="text-muted-foreground flex items-center justify-center border-b px-4 py-2.5 text-xs">
        <span className="bg-muted rounded-md px-3 py-1">meetready.app/sakif/intro</span>
      </div>
      <div className="grid md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <FactsPanel event={EVENT} timeZone={zone} hour12={hour12} titleAs="h3" />
        <div className="flex flex-col gap-6 p-6 md:p-8">
          <DaylightBand
            windows={windows}
            day={day}
            timeZone={zone}
            hostTimeZone={HOST.timeZone}
            hostName={EVENT.hostName}
            hour12={hour12}
            headingAs="h4"
          />
          {picked ? (
            <div role="status" className="animate-in-up flex flex-col items-start gap-3 py-4">
              <p className="font-display text-2xl font-bold">
                {formatTime(picked.start, zone, hour12)} it is.
              </p>
              <p className="text-muted-foreground max-w-[48ch]">
                On a real booking page you&apos;d add your name and email next, and you&apos;d both get an
                email with a calendar invite. Sakif would see it as{" "}
                {formatTime(picked.start, HOST.timeZone, hour12)} in {cityName(HOST.timeZone)}.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPicked(null);
                  setSelected(null);
                }}
              >
                <RotateCcw />
                Pick again
              </Button>
            </div>
          ) : (
            <div>
              <h4 className="mb-2 text-lg font-semibold">{formatDateKey(day)}</h4>
              <TimeList
                slots={shown}
                timeZone={zone}
                hostTimeZone={HOST.timeZone}
                hour12={hour12}
                selected={selected}
                onSelect={setSelected}
                onContinue={setPicked}
                label={`Sample times on ${formatDateKey(day)}`}
              />
              {slots.length > shown.length && (
                <p className="text-muted-foreground mt-3 text-sm">
                  and {slots.length - shown.length} more times
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
