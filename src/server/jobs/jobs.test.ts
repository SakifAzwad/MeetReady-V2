import { eq } from "drizzle-orm";
import { Inngest } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings } from "@/db/schema";
import type { Database } from "@/db/types";
import { APP, book, connectCalendar, SECRET, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { CalendarUnavailableError } from "../calendar/google-api";
import type { SyncAttempt } from "../calendar/sync";
import { createMemorySender, type EmailMessage, type EmailSender } from "../email/sender";
import { cancelBookingAsHost, rescheduleBookingByToken } from "../manage-booking";
import { reminderEventId } from "../reminders";
import {
  BOOKING_CHANGED,
  CALENDAR_SYNC,
  REMINDER_DUE,
  type BookingChangedData,
  type JobEvent,
} from "./events";
import { createJobFunctions } from "./functions";
import {
  onBookingChanged,
  onCalendarConnected,
  onCalendarSync,
  onReminderDue,
  onReminderSweep,
  RetryLaterError,
  type JobDeps,
  type Steps,
} from "./handlers";
import { runInline } from "./inline";

/*
 * Day 17 background jobs, on a real (in-memory) Postgres with a fake Google
 * and an in-memory mailbox. Two ways to run a handler:
 *  - durable(): behaves like Inngest. Each finished step's result is saved
 *    (as JSON, as Inngest stores it) and returned instead of re-running the
 *    step when the function runs again after a failure.
 *  - runInline(): the fallback, exactly as production uses it.
 */

const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const NOW = new Date("2026-11-19T00:00:00Z");
const START = new Date("2026-11-20T04:00:00Z");

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

function makeDeps(opts: { attempt?: (id: string) => Promise<SyncAttempt>; sender?: EmailSender } = {}) {
  const sender = opts.sender ?? createMemorySender();
  const report = vi.fn();
  const attemptSync = vi.fn(opts.attempt ?? (async () => ({ outcome: "synced" }) as SyncAttempt));
  const deps: JobDeps = {
    db,
    sender,
    appUrl: APP,
    secret: SECRET,
    calendar: { attemptSync },
    report,
    now: () => NOW,
  };
  return { deps, sender, report, attemptSync };
}

function durable() {
  const memo = new Map<string, unknown>();
  const sent: JobEvent[] = [];
  const sleeps: Date[] = [];
  const steps: Steps = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      if (memo.has(id)) return memo.get(id) as T;
      const value = await fn();
      memo.set(id, JSON.parse(JSON.stringify(value ?? null)));
      return memo.get(id) as T;
    },
    async sleepUntil(_id, until) {
      sleeps.push(until);
    },
    async sendEvent(id, events) {
      if (memo.has(id)) return;
      memo.set(id, true);
      sent.push(...events);
    },
  };
  return { steps, memo, sent, sleeps };
}

const changed = (
  bookingId: string,
  sequence = 0,
  extra: Partial<BookingChangedData> = {},
): BookingChangedData => ({
  bookingId,
  change: "created",
  sequence,
  at: LONG_AGO.toISOString(),
  ...extra,
});

const recipients = (sent: EmailMessage[]) => sent.map((m) => m.to).sort();

describe("booking-changed", () => {
  it("writes Google first, then emails both sides; the guest's has their manage link", async () => {
    const r = await book(db, START, LONG_AGO);
    const { deps, sender, attemptSync } = makeDeps();
    const run = durable();

    const result = await onBookingChanged(changed(r.booking.id), run.steps, deps);

    expect(result).toEqual({ calendar: "synced", guest: "sent", host: "sent" });
    expect(attemptSync).toHaveBeenCalledWith(r.booking.id);
    const mail = sender as ReturnType<typeof createMemorySender>;
    expect(recipients(mail.sent)).toEqual(["ada@example.com", "sakif@example.com"]);
    const guest = mail.sent.find((m) => m.to === "ada@example.com")!;
    expect(guest.html).toContain(`${APP}/booking/${r.manageToken}`);
    expect(mail.keys.sort()).toEqual([`booking/${r.booking.id}/0/guest`, `booking/${r.booking.id}/0/host`]);
    // What Inngest would store: status words, no names or emails.
    expect(JSON.stringify([...run.memo.values()])).not.toMatch(/Ada|@|Private/);
  });

  it("a retry repeats only the step that failed: the guest isn't emailed twice", async () => {
    const r = await book(db, START, LONG_AGO);
    const inbox: EmailMessage[] = [];
    let hostFails = true;
    const sender: EmailSender = {
      async send(m) {
        if (m.to === "sakif@example.com" && hostFails) throw new Error("mail provider down");
        inbox.push(m); // no idempotency here: this test proves the step memo on its own
      },
    };
    const { deps } = makeDeps({ sender });
    const run = durable();

    await expect(onBookingChanged(changed(r.booking.id), run.steps, deps)).rejects.toThrow(
      "mail provider down",
    );
    hostFails = false;
    await onBookingChanged(changed(r.booking.id), run.steps, deps); // Inngest's retry

    expect(recipients(inbox)).toEqual(["ada@example.com", "sakif@example.com"]);
  });

  it("a guest email that keeps failing doesn't hold back the host's", async () => {
    const r = await book(db, START, LONG_AGO);
    const inbox: EmailMessage[] = [];
    const sender: EmailSender = {
      async send(m) {
        if (m.to === "ada@example.com") throw new Error("address bounces");
        inbox.push(m);
      },
    };
    const { deps } = makeDeps({ sender });
    const run = durable();
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(onBookingChanged(changed(r.booking.id), run.steps, deps)).rejects.toThrow(
        "address bounces",
      );
    }
    expect(recipients(inbox)).toEqual(["sakif@example.com"]); // sent once, on the first attempt
  });

  it("skips the emails of a change that's been overtaken by a newer one", async () => {
    const r = await book(db, START, LONG_AGO);
    await rescheduleBookingByToken(db, r.manageToken, new Date("2026-11-20T05:00:00Z"), LONG_AGO);
    const { deps, sender } = makeDeps();

    const result = await onBookingChanged(changed(r.booking.id, 0), durable().steps, deps);

    expect(result).toMatchObject({ guest: "superseded", host: "superseded" });
    expect((sender as ReturnType<typeof createMemorySender>).sent).toHaveLength(0);
  });

  it("emails only the guest when the host cancelled, and the guest's moved-meeting email keeps its link", async () => {
    const r = await book(db, START, LONG_AGO);
    const moved = await rescheduleBookingByToken(
      db,
      r.manageToken,
      new Date("2026-11-20T05:00:00Z"),
      LONG_AGO,
    );
    if (!moved.ok) throw new Error("setup");
    const { deps, sender } = makeDeps();
    const mail = sender as ReturnType<typeof createMemorySender>;

    await onBookingChanged(
      changed(r.booking.id, 1, { change: "rescheduled", previousStartsAt: START.toISOString() }),
      durable().steps,
      deps,
    );
    expect(mail.sent.find((m) => m.to === "ada@example.com")!.html).toContain(`/booking/${r.manageToken}`);

    const cancelled = await cancelBookingAsHost(db, "host", r.booking.id, null, LONG_AGO);
    if (!cancelled.ok) throw new Error("setup");
    const result = await onBookingChanged(
      changed(r.booking.id, cancelled.sequence, { change: "cancelled" }),
      durable().steps,
      deps,
    );
    expect(result).toMatchObject({ guest: "sent", host: "not_needed" });
  });

  it("hands a temporary Google failure to the retrying job, without waiting or reporting", async () => {
    const r = await book(db, START, LONG_AGO);
    const { deps, sender, report } = makeDeps({
      attempt: async () => ({ outcome: "failed", error: new Error("503"), retryable: true }),
    });
    const run = durable();

    const result = await onBookingChanged(changed(r.booking.id), run.steps, deps);

    expect(result.calendar).toBe("retry");
    expect(run.sent).toEqual([{ name: CALENDAR_SYNC, data: { bookingId: r.booking.id } }]);
    expect(report).not.toHaveBeenCalled(); // the retrying job reports the final failure
    expect((sender as ReturnType<typeof createMemorySender>).sent).toHaveLength(2);
  });

  it("reports lost access once and doesn't retry it (only reconnecting fixes it)", async () => {
    const r = await book(db, START, LONG_AGO);
    const error = new CalendarUnavailableError("access_lost", "revoked");
    const { deps, report } = makeDeps({
      attempt: async () => ({ outcome: "failed", error, retryable: false }),
    });
    const run = durable();

    expect((await onBookingChanged(changed(r.booking.id), run.steps, deps)).calendar).toBe("failed");
    expect(run.sent).toEqual([]);
    expect(report).toHaveBeenCalledExactlyOnceWith(error, { area: "calendar-sync", bookingId: r.booking.id });
  });
});

describe("calendar-sync", () => {
  it("throws on a temporary failure so Inngest tries again", async () => {
    const { deps, report } = makeDeps({
      attempt: async () => ({ outcome: "failed", error: new Error("timeout"), retryable: true }),
    });
    await expect(onCalendarSync({ bookingId: "b" }, durable().steps, deps)).rejects.toBeInstanceOf(
      RetryLaterError,
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("gives up quietly on lost access after reporting it", async () => {
    const error = new CalendarUnavailableError("access_lost", "revoked");
    const { deps, report } = makeDeps({
      attempt: async () => ({ outcome: "failed", error, retryable: false }),
    });
    expect(await onCalendarSync({ bookingId: "b" }, durable().steps, deps)).toBe("failed");
    expect(report).toHaveBeenCalledOnce();
  });
});

describe("calendar-backfill", () => {
  it("queues one sync per upcoming booking that isn't in Google yet", async () => {
    await connectCalendar(db);
    const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
    const notYet = await book(db, at(48), LONG_AGO);
    const failed = await book(db, at(72), LONG_AGO);
    const synced = await book(db, at(96), LONG_AGO);
    const cancelled = await book(db, at(120), LONG_AGO);
    await db.update(bookings).set({ calendarSync: "failed" }).where(eq(bookings.id, failed.booking.id));
    await db
      .update(bookings)
      .set({ calendarSync: "synced", calendarEventId: "x" })
      .where(eq(bookings.id, synced.booking.id));
    await cancelBookingAsHost(db, "host", cancelled.booking.id, null, LONG_AGO);
    const { deps } = makeDeps();
    const run = durable();

    expect(await onCalendarConnected({ userId: "host" }, run.steps, deps)).toEqual({ bookings: 2 });
    expect(run.sent).toEqual([
      { name: CALENDAR_SYNC, data: { bookingId: notYet.booking.id } },
      { name: CALENDAR_SYNC, data: { bookingId: failed.booking.id } },
    ]);
  });
});

describe("reminders", () => {
  it("the sweep queues each due reminder under its own event id", async () => {
    // Booked long ago, starting 90 minutes from now: its hour-before reminder is due in 30.
    const start = new Date(NOW.getTime() + 90 * 60_000);
    const r = await book(db, start, LONG_AGO);
    const { deps } = makeDeps();
    const run = durable();

    await onReminderSweep(run.steps, deps);

    const data = { bookingId: r.booking.id, kind: "hour", startsAt: start.toISOString() };
    expect(run.sent).toEqual([
      {
        name: REMINDER_DUE,
        id: reminderEventId(data as never),
        data: { ...data, remindAt: expect.any(String) },
      },
    ]);
  });

  it("a reminder job sleeps until its minute, then sends", async () => {
    const start = new Date(NOW.getTime() + 3 * 3_600_000);
    const r = await book(db, start, LONG_AGO);
    const { deps, sender } = makeDeps();
    const run = durable();
    const remindAt = new Date(start.getTime() - 3_600_000);

    const outcome = await onReminderDue(
      {
        bookingId: r.booking.id,
        kind: "hour",
        startsAt: start.toISOString(),
        remindAt: remindAt.toISOString(),
      },
      run.steps,
      deps,
    );

    expect(run.sleeps).toEqual([remindAt]);
    expect(outcome).toBe("sent");
    expect((sender as ReturnType<typeof createMemorySender>).sent).toHaveLength(1);
  });
});

describe("inline fallback", () => {
  const event = (bookingId: string): JobEvent => ({ name: BOOKING_CHANGED, data: changed(bookingId) });

  it("runs the same job right away: Google, then both emails", async () => {
    const r = await book(db, START, LONG_AGO);
    const { deps, sender, attemptSync } = makeDeps();
    await runInline(event(r.booking.id), deps);
    expect(attemptSync).toHaveBeenCalledOnce();
    expect(recipients((sender as ReturnType<typeof createMemorySender>).sent)).toEqual([
      "ada@example.com",
      "sakif@example.com",
    ]);
  });

  it("reports a failed email and still sends the other one", async () => {
    const r = await book(db, START, LONG_AGO);
    const inbox: EmailMessage[] = [];
    const sender: EmailSender = {
      async send(m) {
        if (m.to === "ada@example.com") throw new Error("bounced");
        inbox.push(m);
      },
    };
    const { deps, report } = makeDeps({ sender });
    await runInline(event(r.booking.id), deps);
    expect(recipients(inbox)).toEqual(["sakif@example.com"]);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      area: "booking-emails",
      bookingId: r.booking.id,
    });
  });

  it("gives a temporary Google failure one immediate second try, and reports it once", async () => {
    const r = await book(db, START, LONG_AGO);
    const { deps, report, attemptSync } = makeDeps({
      attempt: async () => ({ outcome: "failed", error: new Error("503"), retryable: true }),
    });
    await runInline(event(r.booking.id), deps);
    expect(attemptSync).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(RetryLaterError), {
      area: "calendar-sync",
      bookingId: r.booking.id,
    });
  });
});

describe("Inngest functions", () => {
  it("registers five functions; the two that touch Google share one queue per booking", () => {
    const { deps } = makeDeps();
    const fns = createJobFunctions(new Inngest({ id: "test", isDev: true }), deps);
    const byId = Object.fromEntries(fns.map((f) => [f.opts.id, f.opts]));
    expect(Object.keys(byId).sort()).toEqual([
      "booking-changed",
      "calendar-backfill",
      "calendar-sync",
      "reminder-send",
      "reminder-sweep",
    ]);
    expect(byId["booking-changed"]!.concurrency).toEqual(byId["calendar-sync"]!.concurrency);
    expect(byId["booking-changed"]!.concurrency).toMatchObject({ limit: 1, scope: "env" });
    expect(byId["reminder-sweep"]!.triggers).toEqual([{ cron: "*/15 * * * *" }]);
  });
});
