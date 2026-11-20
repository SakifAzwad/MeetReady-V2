"use client";

import { useRouter } from "next/navigation";
import { BookingWidget, type EventInfo } from "@/app/[username]/[slug]/booking-widget";
import { moveBookingAsHostAction } from "../../actions";

/**
 * Day 25: the booking widget in its host mode. The move action is given to the
 * widget here, so the public widget never imports dashboard code; the action
 * itself checks the session and the booking's host.
 */
export function MoveWidget({
  bookingId,
  guestName,
  event,
  currentStartsAt,
  currentEndsAt,
}: {
  bookingId: string;
  guestName: string;
  event: EventInfo;
  currentStartsAt: string;
  currentEndsAt: string;
}) {
  const router = useRouter();
  return (
    <BookingWidget
      layout="embedded"
      event={event}
      reschedule={{
        host: { bookingId, guestName, move: (startsAt) => moveBookingAsHostAction({ bookingId, startsAt }) },
        currentStartsAt,
        currentEndsAt,
        onExit: () => router.push("/dashboard/bookings"),
        onMoved: () => router.refresh(),
      }}
    />
  );
}
