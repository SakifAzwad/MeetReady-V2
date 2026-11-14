import { and, asc, eq, gt, lte, notExists, sql } from "drizzle-orm";
import { bookingReminders, bookings } from "@/db/schema";
import type { Database } from "@/db/types";
import { composeReminderEmail, type ReminderKind } from "./email/notifications";
import type { EmailSender } from "./email/sender";
import { getBookingDetails, readManageToken } from "./manage-booking";

/*
 * Reminder emails (Day 17): to the guest, a day and an hour before.
 *
 * How they're scheduled: a sweep, not a sleeping job per booking.
 *  - Every 15 minutes a cron job asks the database which reminders fall due in
 *    the next 30 minutes (the overlap means a late or skipped run misses
 *    nothing). Each one becomes a short job that sleeps until the exact minute,
 *    reads the booking again and sends.
 *  - Why not one job per booking that sleeps until "24 hours before": bookings
 *    can be 60+ days out, longer than Inngest's free plan lets a run live; and
 *    every reschedule or cancel would have to find and cancel that job. The
 *    queue would hold a second copy of the schedule that can drift from the
 *    database. Here the database is the only copy: a cancelled booking simply
 *    stops matching the query, a moved one matches again at its new time.
 *  - "Sent once" is the booking_reminders table: its primary key includes the
 *    start time, so a moved meeting gets fresh reminders with nothing to reset.
 */

type ReminderRule = {
  /** Minutes before the start that the reminder goes out. */
  before: number;
  /**
   * Still worth sending until this many minutes before the start. Used when a
   * reminder is late (the queue was down): a day-before reminder 18 hours out
   * still helps; an hour-before reminder 5 minutes out doesn't.
   */
  latest: number;
};

export const REMINDERS: Record<ReminderKind, ReminderRule> = {
  day: { before: 24 * 60, latest: 12 * 60 },
  hour: { before: 60, latest: 15 },
};

/** How far ahead each sweep looks. Twice the cron interval (15 min), so one late run is covered. */
export const SWEEP_HORIZON_MINUTES = 30;

/**
 * A reminder this soon after the booking was made (or moved) is noise: the
 * confirmation email just arrived. Booked 24h10m ahead → no day-before
 * reminder (it would come 10 minutes later), but the hour-before one still goes.
 */
export const MIN_GAP_MINUTES = 30;

export type DueReminder = { bookingId: string; kind: ReminderKind; startsAt: Date; remindAt: Date };

const minutes = (n: number) => n * 60_000;

/** Reminders to schedule now: due within the horizon (or overdue but still useful), not sent yet. */
export async function findDueReminders(db: Database, now: Date): Promise<DueReminder[]> {
  const due: DueReminder[] = [];
  for (const [kind, rule] of Object.entries(REMINDERS) as [ReminderKind, ReminderRule][]) {
    const rows = await db
      .select({ id: bookings.id, startsAt: bookings.startsAt })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "confirmed"),
          // remindAt (= start - before) is at most `horizon` from now…
          lte(bookings.startsAt, new Date(now.getTime() + minutes(SWEEP_HORIZON_MINUTES + rule.before))),
          // …and the meeting is still far enough away for this reminder to help.
          gt(bookings.startsAt, new Date(now.getTime() + minutes(rule.latest))),
          // The booking existed (at this time) a while before the reminder moment.
          sql`${bookings.startsAt} >= coalesce(${bookings.rescheduledAt}, ${bookings.createdAt}) + ${rule.before + MIN_GAP_MINUTES} * interval '1 minute'`,
          notExists(
            db
              .select({ one: sql`1` })
              .from(bookingReminders)
              .where(
                and(
                  eq(bookingReminders.bookingId, bookings.id),
                  eq(bookingReminders.kind, kind),
                  eq(bookingReminders.startsAt, bookings.startsAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(bookings.startsAt))
      .limit(500);
    for (const row of rows) {
      const remindAt = new Date(row.startsAt.getTime() - minutes(rule.before));
      due.push({
        bookingId: row.id,
        kind,
        startsAt: row.startsAt,
        // Overdue (caught up after an outage): send right away.
        remindAt: remindAt < now ? now : remindAt,
      });
    }
  }
  return due;
}

/**
 * The queue's event id for one reminder. Inngest drops a second event with
 * the same id, so two overlapping sweeps can't schedule a reminder twice.
 * The start time is part of it: after a reschedule it's a different reminder.
 */
export function reminderEventId(r: {
  bookingId: string;
  kind: ReminderKind;
  startsAt: Date | string;
}): string {
  return `reminder-${r.kind}-${r.bookingId}-${new Date(r.startsAt).getTime()}`;
}

export type ReminderOutcome = "sent" | "already_sent" | "changed" | "too_late";

/**
 * Sends one reminder, if it still makes sense: the booking is confirmed and
 * still starts when the reminder was scheduled for (a moved meeting gets its
 * own reminders from a later sweep), and there's still time for it to help.
 *
 * Order: check → send → record. Recording first would lose the reminder if the
 * send failed; sending first means a crash between send and record could send
 * twice, which the idempotency key stops at Resend.
 */
export async function sendReminder(
  deps: { db: Database; sender: EmailSender; appUrl: string; secret: string },
  r: { bookingId: string; kind: ReminderKind; startsAt: Date },
  now: Date,
): Promise<ReminderOutcome> {
  const b = await getBookingDetails(deps.db, r.bookingId);
  if (!b || b.status !== "confirmed" || b.startsAt.getTime() !== r.startsAt.getTime()) return "changed";
  if (b.startsAt.getTime() - now.getTime() < minutes(REMINDERS[r.kind].latest)) return "too_late";

  const [sent] = await deps.db
    .select({ sentAt: bookingReminders.sentAt })
    .from(bookingReminders)
    .where(
      and(
        eq(bookingReminders.bookingId, b.id),
        eq(bookingReminders.kind, r.kind),
        eq(bookingReminders.startsAt, b.startsAt),
      ),
    );
  if (sent) return "already_sent";

  const token = await readManageToken(deps.db, b.id, deps.secret);
  const message = await composeReminderEmail({ appUrl: deps.appUrl, now }, b, token);
  await deps.sender.send(message, { idempotencyKey: `reminder/${b.id}/${r.kind}/${b.startsAt.getTime()}` });
  await deps.db
    .insert(bookingReminders)
    .values({ bookingId: b.id, kind: r.kind, startsAt: b.startsAt, sentAt: now })
    .onConflictDoNothing();
  return "sent";
}
