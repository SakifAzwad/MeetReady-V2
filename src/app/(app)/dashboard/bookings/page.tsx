import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, ViewTransition } from "react";
import { BookingAnswers } from "@/components/booking-answers";
import { MeetingBriefCard } from "@/components/meeting-brief";
import { Badge, Card } from "@/components/ui/card";
import { db } from "@/db";
import { cancelledLabel, movedLabel } from "@/lib/booking-labels";
import { cityName } from "@/lib/scheduling/daylight";
import { formatDateKey, formatTime, formatTimeRange } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";
import { requireOnboardedUser } from "@/server/auth/session";
import { listHostBookings, type BookingsView, type HostBookingRow } from "@/server/manage-booking";
import { CancelBookingButton } from "./cancel-booking-button";
import { NoShowButton } from "./no-show-button";
import { RetryCalendarButton } from "./retry-calendar-button";
import { PageTransition } from "@/components/motion";

export const metadata: Metadata = { title: "Bookings" };

const VIEWS: { view: BookingsView; label: string }[] = [
  { view: "upcoming", label: "Upcoming" },
  { view: "past", label: "Past" },
  { view: "cancelled", label: "Cancelled" },
];

type SearchParams = PageProps<"/dashboard/bookings">["searchParams"];

export default function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageTransition>
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
    </PageTransition>
  );
}

async function BookingsList({ searchParams }: { searchParams: SearchParams }) {
  const [{ view: raw }, user] = await Promise.all([searchParams, requireOnboardedUser()]);
  // ?view= is user-controlled: anything unexpected falls back to "upcoming".
  const view: BookingsView = VIEWS.some((v) => v.view === raw) ? (raw as BookingsView) : "upcoming";
  const now = new Date();
  // Scoped to this user: their own bookings, and team meetings they're a host of (Day 30).
  const rows = await listHostBookings(db, user.id, view, now);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Booking filters" className="flex gap-1 border-b">
        {VIEWS.map((v) => (
          <Link
            key={v.view}
            href={`/dashboard/bookings?view=${v.view}`}
            aria-current={v.view === view ? "page" : undefined}
            className={cn(
              "relative -mb-px px-3 py-2 text-sm transition-colors",
              v.view === view ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
            {/* One shared underline that slides to the chosen tab (same idea as the dashboard nav). */}
            {v.view === view && (
              <ViewTransition name="bookings-tab-underline" share="morph" default="none">
                <span aria-hidden className="bg-primary absolute inset-x-0 bottom-0 h-0.5 rounded-full" />
              </ViewTransition>
            )}
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
            <BookingRow
              key={b.id}
              booking={b}
              viewerId={user.id}
              timeZone={user.timeZone}
              view={view}
              now={now}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

function BookingRow({
  booking: b,
  viewerId,
  timeZone,
  view,
  now,
}: {
  booking: HostBookingRow;
  viewerId: string;
  timeZone: string;
  view: BookingsView;
  now: Date;
}) {
  const day = dateKeyInZone(b.startsAt, timeZone);
  const inProgress = b.startsAt <= now && b.endsAt > now;
  // Day 30: a team meeting says which team and who else is in it. Google Calendar's state is about the
  // ORGANIZER's calendar (the event lives there, co-hosts are invited), so only the organizer sees it.
  const others = b.hosts.filter((h) => h.id !== viewerId).map((h) => h.name);
  const organizer = b.hostId === viewerId;
  const moved = movedLabel(b, viewerId);
  const cancelled = cancelledLabel(b, viewerId);
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
          {b.team && (
            <p className="text-muted-foreground text-sm">
              {b.team.name}
              {others.length > 0 && `, with ${names.format(others)}`}
            </p>
          )}
          {b.guestTimeZone !== timeZone && (
            <p className="text-muted-foreground text-sm">
              {formatTime(b.startsAt, b.guestTimeZone)} for them in {cityName(b.guestTimeZone)}
            </p>
          )}
          {b.meetUrl && b.status === "confirmed" && (
            <p className="text-sm">
              <a
                href={b.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4"
              >
                Join with Google Meet
              </a>
            </p>
          )}
          {b.brief && b.status === "confirmed" && (
            <MeetingBriefCard brief={b.brief} guestName={b.guestName} className="mt-3" />
          )}
          {b.guestNotes && <p className="mt-2 text-sm whitespace-pre-line">&ldquo;{b.guestNotes}&rdquo;</p>}
          <BookingAnswers answers={b.answers} className="mt-3" />
          <div className="mt-2 flex flex-wrap gap-2">
            {inProgress && <Badge className="border-primary/40 text-primary">Happening now</Badge>}
            {/* Day 24: who moved or cancelled it, and through which assistant (lib/booking-labels.ts). */}
            {moved && <Badge>{moved}</Badge>}
            {/* Day 22: the host booked it through an AI assistant, so the guest's email said so too. */}
            {b.source === "assistant" && (
              <Badge>Booked by you through {b.assistantName ?? "an AI assistant"}</Badge>
            )}
            {organizer && b.calendarSync === "failed" && (
              <>
                <Badge className="border-destructive/40">
                  {b.status === "cancelled" ? "Still in Google Calendar" : "Not in Google Calendar"}
                </Badge>
                <RetryCalendarButton bookingId={b.id} />
              </>
            )}
            {cancelled && <Badge>{cancelled}</Badge>}
            {b.noShowAt && <Badge>Didn&apos;t show up</Badge>}
          </div>
        </div>
        {view === "upcoming" && !inProgress && (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            {/* Day 25: the booking widget in a host mode, on its own page. */}
            <Link
              href={`/dashboard/bookings/${b.id}/move`}
              aria-label={`Move the meeting with ${b.guestName}`}
              className="hover:bg-accent rounded-md px-3 py-1.5 text-sm font-medium"
            >
              Move
            </Link>
            <CancelBookingButton bookingId={b.id} guestName={b.guestName} />
          </div>
        )}
        {/* Day 25: the Past view lists only confirmed meetings that have ended: exactly the ones that can be marked. */}
        {view === "past" && <NoShowButton bookingId={b.id} guestName={b.guestName} noShow={!!b.noShowAt} />}
      </Card>
    </li>
  );
}
