import { render } from "@react-email/components";
import type { Database } from "@/db/types";
import { formatWhen, locationText } from "@/lib/booking-format";
import { formatDateKey } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { getBookingDetails, type BookingDetails } from "../manage-booking";
import { BookingEmail, bookingEmailHeading, type BookingEmailProps } from "./booking-email";
import { buildIcs } from "./ics";
import type { EmailMessage, EmailSender } from "./sender";

/*
 * Who gets which email:
 *   booked        -> guest (with manage link) + host
 *   rescheduled   -> guest + host
 *   cancelled by guest -> guest (receipt) + host
 *   cancelled by host  -> guest only (the host did it)
 *
 * Each recipient sees times in THEIR timezone, and every email carries a
 * .ics: REQUEST to add/update the event, CANCEL to remove it.
 *
 * These run AFTER the booking is committed (see the actions' `after()`), never
 * inside the database transaction: an email can't be rolled back, and a slow
 * mail provider shouldn't hold the per-host lock.
 */

type Context = { db: Database; sender: EmailSender; appUrl: string; now: Date };

async function compose(
  b: BookingDetails,
  props: Omit<BookingEmailProps, "eventTitle" | "hostName" | "guestName" | "when">,
  timeZone: string,
  to: string,
  now: Date,
): Promise<EmailMessage> {
  const full: BookingEmailProps = {
    ...props,
    eventTitle: b.eventTitle,
    hostName: b.hostName,
    guestName: b.guestName,
    when: formatWhen(b.startsAt, b.endsAt, timeZone),
  };
  const element = <BookingEmail {...full} />;
  const method = props.kind === "cancelled" ? "CANCEL" : "REQUEST";
  const prefix = { confirmed: "Confirmed", rescheduled: "Rescheduled", cancelled: "Cancelled" }[props.kind];
  return {
    to,
    subject: `${prefix}: ${b.eventTitle} with ${props.audience === "guest" ? b.hostName : b.guestName} – ${formatDateKey(dateKeyInZone(b.startsAt, timeZone), "short")}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
    ics: {
      filename: "invite.ics",
      method,
      content: buildIcs({
        method,
        uid: `${b.id}@meetready`,
        sequence: b.sequence,
        start: b.startsAt,
        end: b.endsAt,
        createdAt: now,
        summary: `${b.eventTitle}: ${b.guestName} and ${b.hostName}`,
        description: bookingEmailHeading(full),
        location: locationText(b),
        url: props.actionUrl,
        organizer: { name: b.hostName, email: b.hostEmail },
        attendee: { name: b.guestName, email: b.guestEmail },
      }),
    },
  };
}

/** Sends all messages; one failure doesn't stop the others. Returns how many failed. */
async function sendAll(sender: EmailSender, messages: EmailMessage[]): Promise<number> {
  const results = await Promise.allSettled(messages.map((m) => sender.send(m)));
  const failures = results.filter((r) => r.status === "rejected");
  for (const f of failures) console.error("[email] send failed:", (f as PromiseRejectedResult).reason);
  return failures.length;
}

export async function notifyBookingConfirmed(ctx: Context, bookingId: string, manageToken: string) {
  const b = await getBookingDetails(ctx.db, bookingId);
  if (!b) return;
  const location = locationText(b);
  await sendAll(ctx.sender, [
    await compose(
      b,
      { kind: "confirmed", audience: "guest", location, actionUrl: `${ctx.appUrl}/booking/${manageToken}` },
      b.guestTimeZone,
      b.guestEmail,
      ctx.now,
    ),
    await compose(
      b,
      {
        kind: "confirmed",
        audience: "host",
        location,
        guestEmail: b.guestEmail,
        guestNotes: b.guestNotes,
        answers: b.answers,
        actionUrl: `${ctx.appUrl}/dashboard/bookings`,
      },
      b.hostTimeZone,
      b.hostEmail,
      ctx.now,
    ),
  ]);
}

export async function notifyBookingRescheduled(
  ctx: Context,
  bookingId: string,
  previousStartsAt: Date,
  manageToken: string,
) {
  const b = await getBookingDetails(ctx.db, bookingId);
  if (!b) return;
  const previousEnd = new Date(previousStartsAt.getTime() + (b.endsAt.getTime() - b.startsAt.getTime()));
  const location = locationText(b);
  await sendAll(ctx.sender, [
    await compose(
      b,
      {
        kind: "rescheduled",
        audience: "guest",
        location,
        previousWhen: formatWhen(previousStartsAt, previousEnd, b.guestTimeZone),
        actionUrl: `${ctx.appUrl}/booking/${manageToken}`,
      },
      b.guestTimeZone,
      b.guestEmail,
      ctx.now,
    ),
    await compose(
      b,
      {
        kind: "rescheduled",
        audience: "host",
        location,
        guestEmail: b.guestEmail,
        previousWhen: formatWhen(previousStartsAt, previousEnd, b.hostTimeZone),
        actionUrl: `${ctx.appUrl}/dashboard/bookings`,
      },
      b.hostTimeZone,
      b.hostEmail,
      ctx.now,
    ),
  ]);
}

export async function notifyBookingCancelled(ctx: Context, bookingId: string) {
  const b = await getBookingDetails(ctx.db, bookingId);
  if (!b || b.status !== "cancelled") return;
  const common = {
    kind: "cancelled",
    cancelledBy: b.cancelledBy,
    cancellationReason: b.cancellationReason,
  } as const;
  const messages = [
    await compose(b, { ...common, audience: "guest" }, b.guestTimeZone, b.guestEmail, ctx.now),
  ];
  if (b.cancelledBy === "guest") {
    messages.push(
      await compose(
        b,
        {
          ...common,
          audience: "host",
          guestEmail: b.guestEmail,
          actionUrl: `${ctx.appUrl}/dashboard/bookings`,
        },
        b.hostTimeZone,
        b.hostEmail,
        ctx.now,
      ),
    );
  }
  await sendAll(ctx.sender, messages);
}
