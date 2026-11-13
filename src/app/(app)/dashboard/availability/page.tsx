import type { Metadata } from "next";
import { Suspense } from "react";
import { db } from "@/db";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { rulesToSchedule } from "@/lib/validation/availability";
import { requireOnboardedUser } from "@/server/auth/session";
import { getAvailability } from "@/server/availability";
import { calendarStatus } from "@/server/calendar";
import { CalendarConnection, type CalendarCardStatus, type ConnectNotice } from "./calendar-connection";
import { DateOverrides } from "./date-overrides";
import { WeeklyScheduleForm } from "./weekly-schedule-form";
import { PageTransition } from "@/components/motion";

export const metadata: Metadata = { title: "Availability" };

const NOTICES = new Set(["connected", "missing_permission", "no_google_account", "error"]);

export default function AvailabilityPage({ searchParams }: PageProps<"/dashboard/availability">) {
  return (
    <PageTransition>
      <main className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold">Availability</h1>
          <p className="text-muted-foreground text-sm">
            When guests can book you. Bookings, buffers and busy times from your Google Calendar are
            subtracted automatically.
          </p>
        </div>
        <Suspense fallback={<div className="bg-muted h-40 animate-pulse rounded-xl" />}>
          <CalendarSection searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={<div className="bg-muted h-[32rem] animate-pulse rounded-xl" />}>
          <AvailabilityEditor />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function AvailabilityEditor() {
  const user = await requireOnboardedUser();
  // "Upcoming" means from today in the HOST's timezone, not the server's (UTC on Vercel).
  const today = dateKeyInZone(new Date(), user.timeZone);
  const availability = await getAvailability(db, user.id, { overridesFrom: today });

  // minmax(0, …): grid items default to min-width:auto, so long content
  // would stretch the column past a phone screen.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <WeeklyScheduleForm defaultValues={rulesToSchedule(availability.timeZone, availability.rules)} />
      <DateOverrides overrides={availability.overrides} today={today} />
    </div>
  );
}

async function CalendarSection({ searchParams }: Pick<PageProps<"/dashboard/availability">, "searchParams">) {
  const [user, { calendar }] = await Promise.all([requireOnboardedUser(), searchParams]);
  const status = await calendarStatus(user.id);
  const notice = typeof calendar === "string" && NOTICES.has(calendar) ? (calendar as ConnectNotice) : null;
  // Dates cross to the client component as strings.
  const cardStatus: CalendarCardStatus = status.connected
    ? { connected: true, lastError: status.lastError, lastErrorAt: status.lastErrorAt?.toISOString() ?? null }
    : { connected: false };
  return <CalendarConnection status={cardStatus} email={user.email} notice={notice} />;
}
