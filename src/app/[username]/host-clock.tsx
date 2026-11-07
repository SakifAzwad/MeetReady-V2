"use client";

import { useMinuteClock } from "@/components/daylight/preferences";
import { formatTime } from "@/lib/scheduling/calendar";
import { cityName } from "@/lib/scheduling/daylight";

/** "Based in Dhaka, where it's 2:52 AM now." Renders the city at once and the time once the clock hydrates. */
export function HostClock({ timeZone }: { timeZone: string }) {
  const now = useMinuteClock();
  return (
    <p className="text-muted-foreground">
      Based in {cityName(timeZone)}
      {now && <>, where it&apos;s {formatTime(now, timeZone)} now</>}.
    </p>
  );
}
