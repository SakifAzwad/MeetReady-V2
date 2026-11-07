import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card } from "@/components/ui/card";
import { db } from "@/db";
import { cityName } from "@/lib/scheduling/daylight";
import { formatDateKey, formatTime, formatTimeRange } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";
import { requireOnboardedUser } from "@/server/auth/session";
import { listHostBookings, type BookingsView, type HostBookingRow } from "@/server/manage-booking";
import { CancelBookingButton } from "./cancel-booking-button";

export const metadata: Metadata = { title: "Bookings · MeetReady" };

const VIEWS: { view: BookingsView; label: string }[] = [
  { view: "upcoming", label: "Upcoming" },
  { view: "past", label: "Past" },
  { view: "cancelled", label: "Cancelled" },
];

type SearchParams = PageProps<"/dashboard/bookings">["searchParams"];

export default function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Bookings</h1>
        <p className="text-muted-foreground text-sm">
          Meetings guests have booked with you, in your timezone.
        </p>
      </div>
      <Suspense fallback={<div className="bg-muted h-64 animate-pulse rounded-xl" />}>
        <BookingsList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function BookingsList({ searchParams }: { searchParams: SearchParams }) {
  const [{ view: raw }, user] = await Promise.all([searchParams, requireOnboardedUser()]);
  // ?view= is user-controlled: anything unexpected falls back to "upcoming".
  const view: BookingsView = VIEWS.some((v) => v.view === raw) ? (raw as BookingsView) : "upcoming";
  const now = new Date();
  const rows = await listHostBookings(db, user.id, view, now); // scoped to this host

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Booking filters" className="flex gap-1 border-b">
        {VIEWS.map((v) => (
          <Link
            key={v.view}
            href={`/dashboard/bookings?view=${v.view}`}
            aria-current={v.view === view ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:text-foreground -mb-px border-b-2 px-3 py-2 text-sm",
              v.view === view ? "border-primary text-foreground font-medium" : "border-transparent",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <p className="font-medium">No {view} bookings</p>
          {view === "upcoming" && (
            <p className="text-muted-foreground text-sm">
              Share your booking link and they&apos;ll show up here.
            </p>
          )}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((b) => (
            <BookingRow key={b.id} booking={b} timeZone={user.timeZone} view={view} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BookingRow({
  booking: b,
  timeZone,
  view,
  now,
}: {
  booking: HostBookingRow;
  timeZone: string;
  view: BookingsView;
  now: Date;
}) {
  const day = dateKeyInZone(b.startsAt, timeZone);
  const inProgress = b.startsAt <= now && b.endsAt > now;
  return (
    <li>
      <Card className="relative gap-3 overflow-hidden p-5 sm:flex-row sm:items-start sm:gap-6">
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: b.eventColor }}
        />
        <div className="w-40 shrink-0">
          <p className={cn("font-medium", view === "cancelled" && "line-through")}>
            {formatDateKey(day, "short")}
          </p>
          <p className="text-muted-foreground tabular text-sm">
            {formatTimeRange(b.startsAt, b.endsAt, timeZone)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {b.eventTitle} with {b.guestName}
          </p>
          <p className="text-muted-foreground truncate text-sm">{b.guestEmail}</p>
          {b.guestTimeZone !== timeZone && (
            <p className="text-muted-foreground text-sm">
              {formatTime(b.startsAt, b.guestTimeZone)} for them in {cityName(b.guestTimeZone)}
            </p>
          )}
          {b.guestNotes && <p className="mt-2 text-sm whitespace-pre-line">&ldquo;{b.guestNotes}&rdquo;</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {inProgress && <Badge className="border-primary/40 text-primary">Happening now</Badge>}
            {b.rescheduledAt && <Badge>Rescheduled</Badge>}
            {b.status === "cancelled" && (
              <Badge>
                Cancelled by {b.cancelledBy === "host" ? "you" : "guest"}
                {b.cancellationReason && `: ${b.cancellationReason}`}
              </Badge>
            )}
          </div>
        </div>
        {view === "upcoming" && !inProgress && (
          <CancelBookingButton bookingId={b.id} guestName={b.guestName} />
        )}
      </Card>
    </li>
  );
}
