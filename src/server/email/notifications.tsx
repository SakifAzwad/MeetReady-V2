import { render } from "@react-email/components";
import type { Database } from "@/db/types";
import { formatWhen, locationText } from "@/lib/booking-format";
import { formatDateKey } from "@/lib/scheduling/calendar";
import { addDaysToKey, dateKeyInZone } from "@/lib/scheduling/time";
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
 *   reminder (Day 17)  -> guest only, a day and an hour before
 *
 * Each recipient sees times in THEIR timezone, and every change email carries
 * a .ics: REQUEST to add/update the event, CANCEL to remove it. One exception
 * (Day 16): when the booking is already in the host's Google Calendar
 * (calendarSync = "synced"), the HOST's email has no .ics, or they could end
 * up with the meeting twice. Guests always get one. Reminders carry none: the
 * meeting is already in the guest's calendar.
 *
 * Day 17: one email = one recipient, built by composeChangeEmail(). The
 * background job sends each one in its own step, so a retry of the host's
 * email can never send the guest's twice. The notify* functions below send
 * every email for a change at once (tests use them to check the content).
 *
 * These run AFTER the booking is committed, never inside the database
 * transaction: an email can't be rolled back, and a slow mail provider
 * shouldn't hold the per-host lock.
 */

type Context = { db: Database; sender: EmailSender; appUrl: string; now: Date };

/** What happened to the booking. `previousStartsAt`: where a moved meeting was before. */
export type BookingChange =
  { kind: "created" } | { kind: "rescheduled"; previousStartsAt: Date } | { kind: "cancelled" };

export type Audience = "guest" | "host";

/** The table above, as code. */
export function audiencesFor(b: Pick<BookingDetails, "cancelledBy">, change: BookingChange): Audience[] {
  if (change.kind === "cancelled" && b.cancelledBy === "host") return ["guest"];
  return ["guest", "host"];
}

async function compose(
  b: BookingDetails,
  props: Omit<BookingEmailProps, "eventTitle" | "hostName" | "guestName" | "when" | "kind"> & {
    kind: "confirmed" | "rescheduled" | "cancelled";
  },
  timeZone: string,
  to: string,
  now: Date,
  withIcs = true,
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
    ics: !withIcs
      ? undefined
      : {
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

/**
 * The email one recipient gets for one change. `manageToken` builds the
 * guest's link; null (no usable copy, see readManageToken) sends the email
 * without it rather than not at all.
 */
export async function composeChangeEmail(
  ctx: { appUrl: string; now: Date },
  b: BookingDetails,
  change: BookingChange,
  audience: Audience,
  manageToken: string | null,
): Promise<EmailMessage> {
  const location = locationText(b);
  const dashboard = `${ctx.appUrl}/dashboard/bookings`;
  const manage = manageToken ? `${ctx.appUrl}/booking/${manageToken}` : undefined;
  // The host's copy skips the .ics when Google Calendar already has the event (Day 16).
  const hostIcs = b.calendarSync !== "synced";
  const zone = audience === "guest" ? b.guestTimeZone : b.hostTimeZone;
  const to = audience === "guest" ? b.guestEmail : b.hostEmail;

  if (change.kind === "created") {
    return audience === "guest"
      ? compose(b, { kind: "confirmed", audience, location, actionUrl: manage }, zone, to, ctx.now)
      : compose(
          b,
          {
            kind: "confirmed",
            audience,
            location,
            guestEmail: b.guestEmail,
            guestNotes: b.guestNotes,
            answers: b.answers,
            actionUrl: dashboard,
          },
          zone,
          to,
          ctx.now,
          hostIcs,
        );
  }

  if (change.kind === "rescheduled") {
    const previousEnd = new Date(
      change.previousStartsAt.getTime() + (b.endsAt.getTime() - b.startsAt.getTime()),
    );
    const previousWhen = formatWhen(change.previousStartsAt, previousEnd, zone);
    return audience === "guest"
      ? compose(
          b,
          { kind: "rescheduled", audience, location, previousWhen, actionUrl: manage },
          zone,
          to,
          ctx.now,
        )
      : compose(
          b,
          {
            kind: "rescheduled",
            audience,
            location,
            guestEmail: b.guestEmail,
            previousWhen,
            actionUrl: dashboard,
          },
          zone,
          to,
          ctx.now,
          hostIcs,
        );
  }

  const common = {
    kind: "cancelled",
    cancelledBy: b.cancelledBy,
    cancellationReason: b.cancellationReason,
  } as const;
  return audience === "guest"
    ? compose(b, { ...common, audience }, zone, to, ctx.now)
    : compose(
        b,
        { ...common, audience, guestEmail: b.guestEmail, actionUrl: dashboard },
        zone,
        to,
        ctx.now,
        hostIcs,
      );
}

// ─── Reminders (Day 17) ─────────────────────────────────────────────────────────

export type ReminderKind = "day" | "hour";

/**
 * The reminder's heading from the time actually left, not from its kind: a
 * reminder that wakes late (the queue was down) mustn't say "in 1 hour" when
 * it's 40 minutes. "Today"/"tomorrow" are the GUEST's calendar days.
 */
export function reminderHeading(now: Date, start: Date, guestTimeZone: string): string {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (minutes <= 90) {
    const rounded = Math.max(5, Math.round(minutes / 5) * 5);
    return rounded >= 55 && rounded <= 65 ? "Starts in 1 hour" : `Starts in ${rounded} minutes`;
  }
  const today = dateKeyInZone(now, guestTimeZone);
  const day = dateKeyInZone(start, guestTimeZone);
  if (day === today) return "Your meeting is today";
  if (day === addDaysToKey(today, 1)) return "Your meeting is tomorrow";
  return "Your meeting is coming up";
}

export async function composeReminderEmail(
  ctx: { appUrl: string; now: Date },
  b: BookingDetails,
  manageToken: string | null,
): Promise<EmailMessage> {
  const props: BookingEmailProps = {
    kind: "reminder",
    audience: "guest",
    eventTitle: b.eventTitle,
    hostName: b.hostName,
    guestName: b.guestName,
    when: formatWhen(b.startsAt, b.endsAt, b.guestTimeZone),
    // The Meet link (Day 16) is the most useful line in a reminder.
    location: locationText(b),
    actionUrl: manageToken ? `${ctx.appUrl}/booking/${manageToken}` : undefined,
    reminderHeading: reminderHeading(ctx.now, b.startsAt, b.guestTimeZone),
  };
  const element = <BookingEmail {...props} />;
  return {
    to: b.guestEmail,
    subject: `Reminder: ${b.eventTitle} with ${b.hostName} – ${formatDateKey(dateKeyInZone(b.startsAt, b.guestTimeZone), "short")}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

// ─── All emails for a change at once ────────────────────────────────────────────

/** Sends all messages; one failure doesn't stop the others. Returns how many failed. */
async function sendAll(sender: EmailSender, messages: EmailMessage[]): Promise<number> {
  const results = await Promise.allSettled(messages.map((m) => sender.send(m)));
  const failures = results.filter((r) => r.status === "rejected");
  for (const f of failures) console.error("[email] send failed:", (f as PromiseRejectedResult).reason);
  return failures.length;
}

async function notify(ctx: Context, bookingId: string, change: BookingChange, manageToken: string | null) {
  const b = await getBookingDetails(ctx.db, bookingId);
  if (!b) return;
  if (change.kind === "cancelled" && b.status !== "cancelled") return;
  const messages = await Promise.all(
    audiencesFor(b, change).map((audience) => composeChangeEmail(ctx, b, change, audience, manageToken)),
  );
  await sendAll(ctx.sender, messages);
}

export const notifyBookingConfirmed = (ctx: Context, bookingId: string, manageToken: string) =>
  notify(ctx, bookingId, { kind: "created" }, manageToken);

export const notifyBookingRescheduled = (
  ctx: Context,
  bookingId: string,
  previousStartsAt: Date,
  manageToken: string,
) => notify(ctx, bookingId, { kind: "rescheduled", previousStartsAt }, manageToken);

export const notifyBookingCancelled = (ctx: Context, bookingId: string) =>
  notify(ctx, bookingId, { kind: "cancelled" }, null);
