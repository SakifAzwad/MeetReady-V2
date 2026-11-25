import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTransition } from "@/components/motion";
import { Card } from "@/components/ui/card";
import { db } from "@/db";
import { bookingEventInfo } from "@/lib/booking-event-info";
import { requireOnboardedUser } from "@/server/auth/session";
import { getHostBookingDetails } from "@/server/manage-booking";
import { MoveWidget } from "./move-widget";

export const metadata: Metadata = { title: "Move a meeting" };

/*
 * Day 25: the host moves one of their upcoming bookings. The booking page's own
 * widget in a host mode: the same calendar, daylight band and timezone
 * handling a guest gets when they reschedule, and the same rules (Day 24's
 * rescheduleBookingAsHost). The booking is looked up by id AND host: another
 * host's booking id is a 404, not a way in. Day 30: any host of a team meeting
 * can move it; the widget then works on the team's page with the meeting's hosts.
 */
export default function MoveBookingPage({ params }: PageProps<"/dashboard/bookings/[id]/move">) {
  return (
    <PageTransition>
      <main className="flex flex-col gap-6">
        <Link
          href="/dashboard/bookings"
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Bookings
        </Link>
        <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
          <MoveBody params={params} />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function MoveBody({ params }: Pick<PageProps<"/dashboard/bookings/[id]/move">, "params">) {
  const [{ id }, user] = await Promise.all([params, requireOnboardedUser()]);
  const b = await getHostBookingDetails(db, user.id, id); // only if this user is one of its hosts
  if (!b) notFound();

  const heading = (
    <div>
      <h1 className="text-3xl font-bold">Move a meeting</h1>
      <p className="text-muted-foreground text-sm">
        {b.eventTitle} with {b.guestName}. They&apos;ll get an email from MeetReady with the new time and a
        link to change it again.
        {b.team && " The other hosts are told too, and the new time must suit all of them."}
      </p>
    </div>
  );
  // Only a confirmed meeting that hasn't started, of a meeting type that's still on, can move (the same
  // rule the server checks again under the lock).
  const reason =
    b.status === "cancelled"
      ? "This meeting is cancelled."
      : b.startsAt <= new Date()
        ? "This meeting has already started."
        : !b.eventActive || !b.hostUsername
          ? `"${b.eventTitle}" is switched off, so its meetings can't be moved. Switch it on first.`
          : null;

  return (
    <div className="flex flex-col gap-6">
      {heading}
      {reason ? (
        <Card className="p-8 text-center">
          <p className="font-medium">{reason}</p>
          <p className="text-muted-foreground text-sm">It can&apos;t be moved.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <MoveWidget
            bookingId={b.id}
            guestName={b.guestName}
            event={bookingEventInfo(b)}
            currentStartsAt={b.startsAt.toISOString()}
            currentEndsAt={b.endsAt.toISOString()}
          />
        </Card>
      )}
    </div>
  );
}
