import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cityName } from "@/lib/scheduling/daylight";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db";
import { env } from "@/lib/env";
import { formatDateKey, formatTime } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { requireOnboardedUser } from "@/server/auth/session";
import { getAvailability } from "@/server/availability";
import { listHostBookings } from "@/server/manage-booking";
import { CopyLinkButton } from "./copy-link-button";
import { WeekGlance } from "./week-glance";

export const metadata: Metadata = { title: "Dashboard · MeetReady" };

/*
 * Answers the three things a host opens this page for: what's my link,
 * what does my week look like, what's next. Settings live in the nav.
 * Cache Components: the shell is static; the session-dependent part streams.
 */
export default function DashboardPage() {
  return (
    <main>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  // The real auth check. proxy.ts only checked that a cookie exists.
  const user = await requireOnboardedUser();
  const now = new Date();
  const [availability, upcoming] = await Promise.all([
    getAvailability(db, user.id),
    listHostBookings(db, user.id, "upcoming", now, 50),
  ]);
  const tz = user.timeZone;
  const path = `/${user.username}`;
  const url = new URL(path, env.BETTER_AUTH_URL).toString();

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Hi {user.name.split(" ")[0]}</h1>
        <Card className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">Your booking page</p>
            <p className="font-display truncate text-xl font-semibold">{url.replace(/^https?:\/\//, "")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <CopyLinkButton url={url} />
            <Button asChild variant="outline">
              <Link href={path}>Open</Link>
            </Button>
          </div>
        </Card>
      </section>

      <section aria-labelledby="week-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="week-heading" className="text-xl font-semibold">
            Your next 7 days
          </h2>
          <p className="text-muted-foreground text-sm">
            {cityName(tz)} time.{" "}
            <Link href="/dashboard/availability" className="text-foreground underline underline-offset-4">
              Change your hours
            </Link>
          </p>
        </div>
        <Card className="gap-4">
          <WeekGlance
            availability={availability}
            meetings={upcoming.map((b) => ({ start: b.startsAt, end: b.endsAt }))}
            now={now}
          />
          <p className="text-muted-foreground border-t pt-3 text-sm">
            Outlined: your working hours. Filled: booked meetings. The white line is now.
          </p>
        </Card>
      </section>

      <section aria-labelledby="next-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="next-heading" className="text-xl font-semibold">
            Coming up
          </h2>
          {upcoming.length > 0 && (
            <Link href="/dashboard/bookings" className="text-sm underline underline-offset-4">
              All bookings
            </Link>
          )}
        </div>
        {upcoming.length === 0 ? (
          <Card className="py-8 text-center">
            <p className="text-muted-foreground">
              No meetings booked yet. Share your link and they&apos;ll appear here.
            </p>
          </Card>
        ) : (
          <ul className="bg-card divide-y rounded-xl border">
            {upcoming.slice(0, 3).map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-0.5 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <span className="tabular shrink-0 font-medium sm:w-48">
                  {formatDateKey(dateKeyInZone(b.startsAt, tz), "short")}, {formatTime(b.startsAt, tz)}
                </span>
                <span className="min-w-0">
                  {b.eventTitle} with {b.guestName}
                  {b.guestTimeZone !== tz && (
                    <span className="text-muted-foreground block text-sm">
                      {formatTime(b.startsAt, b.guestTimeZone)} for them in {cityName(b.guestTimeZone)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="bg-muted h-9 w-40 rounded" />
        <div className="bg-muted h-24 rounded-xl" />
      </div>
      <div className="bg-muted h-80 rounded-xl" />
    </div>
  );
}
