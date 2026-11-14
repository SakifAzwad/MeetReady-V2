import { CalendarX2, Clock, MapPin, User } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingAnswers } from "@/components/booking-answers";
import { Reveal } from "@/components/motion";
import { PoweredBy } from "@/components/site/powered-by";
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
  title: "Your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = PageProps<"/booking/[token]">["params"];

export default function ManageBookingPage({ params }: { params: Params }) {
  return (
    <main className="flex flex-1 flex-col items-center gap-8 px-4 py-8 sm:py-16">
      <Reveal fallback={<div className="bg-muted h-96 w-full max-w-6xl rounded-xl" />}>
        <BookingPanel params={params} />
      </Reveal>
      <PoweredBy />
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
  // Their answers, read-only, plus their notes. A reschedule keeps both.
  const shared = [
    ...booking.answers,
    ...(booking.guestNotes ? [{ questionId: "notes", label: "Notes", value: booking.guestNotes }] : []),
  ];

  return (
    // As wide as the public booking page (max-w-6xl), so rescheduling looks the same: times beside the
    // calendar. At max-w-4xl the widget's area was under its 42rem side-by-side width (Day 16 follow-up).
    <div className="bg-card grid w-full max-w-6xl overflow-hidden rounded-xl border shadow-sm md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 border-b p-6 md:border-r md:border-b-0">
        <p className="text-muted-foreground text-sm">Your booking</p>
        <h1 className="text-2xl font-bold">{booking.eventTitle}</h1>
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
            {booking.meetUrl && !cancelled ? (
              <a
                href={booking.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary break-all underline underline-offset-4"
              >
                Join with Google Meet
              </a>
            ) : (
              <span className="break-all">{locationText(booking)}</span>
            )}
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">
          {formatMinutes(booking.durationMinutes)}, booked by {booking.guestName}
        </p>
        {shared.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-4">
            <h2 className="text-sm font-medium">What you shared</h2>
            <BookingAnswers answers={shared} />
          </section>
        )}
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
          title={booking.eventTitle}
          durationMinutes={booking.durationMinutes}
          currentStartsAt={booking.startsAt.toISOString()}
          currentEndsAt={booking.endsAt.toISOString()}
        />
      )}
    </div>
  );
}
