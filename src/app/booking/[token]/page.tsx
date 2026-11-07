import { CalendarX2, Clock, MapPin, User } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import { formatMinutes } from "@/lib/format";
import { formatWhen, locationText } from "@/lib/booking-format";
import { getBookingByToken } from "@/server/manage-booking";
import { ManageBooking } from "./manage-booking";

/*
 * The guest's private page, reached from the link in their email. The URL
 * contains the manage token, so:
 *  - noindex: search engines must never store it;
 *  - no-referrer: clicking the Zoom link (or anything else) from here must not
 *    send this URL to another site in the Referer header.
 */
export const metadata: Metadata = {
  title: "Your booking · MeetReady",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = PageProps<"/booking/[token]">["params"];

export default function ManageBookingPage({ params }: { params: Params }) {
  return (
    <main className="bg-muted/40 flex flex-1 items-start justify-center px-4 py-8 sm:py-16">
      <Suspense fallback={<div className="bg-muted h-96 w-full max-w-4xl animate-pulse rounded-xl" />}>
        <BookingPanel params={params} />
      </Suspense>
    </main>
  );
}

async function BookingPanel({ params }: { params: Params }) {
  const { token } = await params;
  const booking = await getBookingByToken(db, token);
  if (!booking) notFound(); // wrong token and missing booking look the same

  const now = new Date();
  const cancelled = booking.status === "cancelled";
  const started = booking.startsAt <= now;
  const changeable = !cancelled && !started && booking.eventActive && booking.hostUsername !== null;

  return (
    <div className="bg-card grid w-full max-w-4xl overflow-hidden rounded-xl border shadow-sm md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 border-b p-6 md:border-r md:border-b-0">
        <p className="text-muted-foreground text-sm">Your booking</p>
        <h1 className="text-2xl font-semibold tracking-tight">{booking.eventTitle}</h1>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex gap-2">
            <User className="text-muted-foreground mt-0.5 size-4 shrink-0" /> with {booking.hostName}
          </li>
          <li className={cancelled ? "flex gap-2 line-through" : "flex gap-2"}>
            <Clock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            {/* The guest's timezone from when they booked; they can change it below when rescheduling. */}
            {formatWhen(booking.startsAt, booking.endsAt, booking.guestTimeZone)}
          </li>
          <li className="flex gap-2">
            <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span className="break-all">{locationText(booking)}</span>
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">
          {formatMinutes(booking.durationMinutes)} · booked by {booking.guestName}
        </p>
      </aside>

      {cancelled ? (
        <div role="status" className="flex flex-col items-center gap-3 p-10 text-center">
          <CalendarX2 className="text-muted-foreground size-10" />
          <h2 className="text-xl font-semibold">This meeting is cancelled</h2>
          <p className="text-muted-foreground text-sm">
            {booking.cancelledBy === "host" ? `${booking.hostName} cancelled it.` : "You cancelled it."}
            {booking.cancellationReason && ` Reason: ${booking.cancellationReason}`}
          </p>
        </div>
      ) : started ? (
        <div role="status" className="p-10 text-center">
          <h2 className="text-xl font-semibold">This meeting has already started</h2>
          <p className="text-muted-foreground text-sm">It can&apos;t be changed any more.</p>
        </div>
      ) : (
        <ManageBooking
          token={token}
          changeable={changeable}
          username={booking.hostUsername ?? ""}
          slug={booking.eventSlug}
          hostName={booking.hostName}
          hostTimeZone={booking.hostTimeZone}
          locationLabel={locationText(booking)}
          currentStartsAt={booking.startsAt.toISOString()}
          currentEndsAt={booking.endsAt.toISOString()}
        />
      )}
    </div>
  );
}
