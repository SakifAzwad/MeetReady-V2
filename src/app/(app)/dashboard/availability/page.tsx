import type { Metadata } from "next";
import { Suspense } from "react";
import { db } from "@/db";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { rulesToSchedule } from "@/lib/validation/availability";
import { requireOnboardedUser } from "@/server/auth/session";
import { getAvailability } from "@/server/availability";
import { DateOverrides } from "./date-overrides";
import { WeeklyScheduleForm } from "./weekly-schedule-form";

export const metadata: Metadata = { title: "Availability · MeetReady" };

export default function AvailabilityPage() {
  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold">Availability</h1>
        <p className="text-muted-foreground text-sm">
          When guests can book you. Bookings and buffers are subtracted automatically.
        </p>
      </div>
      <Suspense fallback={<div className="bg-muted h-[32rem] animate-pulse rounded-xl" />}>
        <AvailabilityEditor />
      </Suspense>
    </main>
  );
}

async function AvailabilityEditor() {
  const user = await requireOnboardedUser();
  // "Upcoming" means from today in the HOST's timezone, not the server's (UTC on Vercel).
  const today = dateKeyInZone(new Date(), user.timeZone);
  const availability = await getAvailability(db, user.id, { overridesFrom: today });
  const timeZones = Intl.supportedValuesOf("timeZone");

  // minmax(0, …): grid items default to min-width:auto, so a long timezone
  // name in the select would stretch the column past a phone screen.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <WeeklyScheduleForm
        defaultValues={rulesToSchedule(availability.timeZone, availability.rules)}
        timeZones={timeZones}
      />
      <DateOverrides overrides={availability.overrides} today={today} />
    </div>
  );
}
