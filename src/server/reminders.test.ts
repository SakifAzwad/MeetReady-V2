import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookingReminders, bookings } from "@/db/schema";
import type { Database } from "@/db/types";
import { APP, book, SECRET, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { reminderHeading } from "./email/notifications";
import { createMemorySender } from "./email/sender";
import { cancelBookingAsHost, rescheduleBookingByToken } from "./manage-booking";
import { findDueReminders, reminderEventId, sendReminder } from "./reminders";

/*
 * Day 17 reminders: which ones the sweep finds, and when one is actually sent.
 * The sweep runs at NOW and looks 30 minutes ahead.
 */

const NOW = new Date("2026-11-20T00:10:00Z");
const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const t = (iso: string) => new Date(`${iso}:00Z`);
const minutesBefore = (d: Date, m: number) => new Date(d.getTime() - m * 60_000);

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

const found = async (now = NOW) =>
  (await findDueReminders(db, now)).map((r) => ({
    kind: r.kind,
    startsAt: r.startsAt.toISOString(),
    remindAt: r.remindAt.toISOString(),
  }));

describe("findDueReminders", () => {
  it("finds the day-before reminder due within the next 30 minutes, at its exact time", async () => {
    await book(db, t("2026-11-21T00:30"), LONG_AGO);
    expect(await found()).toEqual([
      { kind: "day", startsAt: "2026-11-21T00:30:00.000Z", remindAt: "2026-11-20T00:30:00.000Z" },
    ]);
  });

  it("finds the hour-before reminder the same way", async () => {
    await book(db, t("2026-11-20T01:30"), LONG_AGO);
    expect(await found()).toEqual([
      { kind: "hour", startsAt: "2026-11-20T01:30:00.000Z", remindAt: "2026-11-20T00:30:00.000Z" },
    ]);
  });

  it("leaves reminders further out for a later sweep", async () => {
    await book(db, t("2026-11-21T01:00"), LONG_AGO); // day reminder at 01:00, 50 minutes away
    await book(db, t("2026-11-20T02:00"), LONG_AGO, { slug: "deep" }); // hour reminder at 01:00
    expect(await found()).toEqual([]);
  });

  it("catches up an overdue reminder that's still useful, to send right away", async () => {
    // The day-before reminder was due at 20:00 yesterday (say the queue was down); 19h50m is still worth it.
    await book(db, t("2026-11-20T20:00"), LONG_AGO);
    expect(await found()).toEqual([
      { kind: "day", startsAt: "2026-11-20T20:00:00.000Z", remindAt: NOW.toISOString() },
    ]);
  });

  it("drops a reminder once it's too late to help", async () => {
    await book(db, t("2026-11-20T00:30"), LONG_AGO); // 20 minutes away at NOW
    expect((await found()).map((r) => r.kind)).toEqual(["hour"]); // 20 > 15 minutes: still sent
    expect(await found(t("2026-11-20T00:20"))).toEqual([]); // 10 minutes away: not any more
  });

  it("skips a reminder that would land minutes after the booking was made", async () => {
    const start = t("2026-11-21T00:30");
    await book(db, start, minutesBefore(start, 24 * 60 + 10)); // booked 24h10m ahead
    expect(await found()).toEqual([]);
    // The hour-before one still goes, much later.
    expect((await found(minutesBefore(start, 70))).map((r) => r.kind)).toEqual(["hour"]);
  });

  it("ignores cancelled bookings and reminders already sent", async () => {
    const a = await book(db, t("2026-11-21T00:30"), LONG_AGO);
    await book(db, t("2026-11-20T01:30"), LONG_AGO, { slug: "deep" });
    await cancelBookingAsHost(db, "host", a.booking.id, null, LONG_AGO);
    const [hour] = await findDueReminders(db, NOW);
    await db
      .insert(bookingReminders)
      .values({ bookingId: hour!.bookingId, kind: "hour", startsAt: hour!.startsAt });
    expect(await found()).toEqual([]);
  });

  it("makes reminders due again when the meeting moves (the start time is part of the key)", async () => {
    const r = await book(db, t("2026-11-20T01:30"), LONG_AGO);
    await db
      .insert(bookingReminders)
      .values({ bookingId: r.booking.id, kind: "hour", startsAt: t("2026-11-20T01:30") });
    expect(await found()).toEqual([]);
    const moved = await rescheduleBookingByToken(db, r.manageToken, t("2026-11-20T01:00"), LONG_AGO);
    expect(moved.ok).toBe(true);
    expect(await found()).toEqual([
      { kind: "hour", startsAt: "2026-11-20T01:00:00.000Z", remindAt: NOW.toISOString() },
    ]);
  });

  it("gives each reminder a queue id that changes with the start time", () => {
    const r = { bookingId: "b", kind: "hour" as const };
    expect(reminderEventId({ ...r, startsAt: t("2026-11-20T01:00") })).toBe(
      reminderEventId({ ...r, startsAt: "2026-11-20T01:00:00.000Z" }),
    );
    expect(reminderEventId({ ...r, startsAt: t("2026-11-20T01:00") })).not.toBe(
      reminderEventId({ ...r, startsAt: t("2026-11-20T01:30") }),
    );
  });
});

describe("sendReminder", () => {
  const start = t("2026-11-20T01:30");
  const oneHourBefore = minutesBefore(start, 60);

  function deps() {
    const sender = createMemorySender();
    return { sender, deps: { db, sender, appUrl: APP, secret: SECRET } };
  }

  it("emails the guest the time, the Meet link and their manage link", async () => {
    const r = await book(db, start, LONG_AGO);
    await db
      .update(bookings)
      .set({ meetUrl: "https://meet.google.com/abc-defg-hij" })
      .where(eq(bookings.id, r.booking.id));
    const { sender, deps: d } = deps();

    expect(
      await sendReminder(d, { bookingId: r.booking.id, kind: "hour", startsAt: start }, oneHourBefore),
    ).toBe("sent");
    expect(sender.sent).toHaveLength(1);
    const email = sender.sent[0]!;
    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("Reminder: Intro call with Sakif Azwad – Fri 20 Nov");
    expect(email.html).toContain("Starts in 1 hour");
    expect(email.text).toContain("Friday, 20 November 2026, 1:30 AM – 2:00 AM (Europe/London)");
    expect(email.text).toContain("https://meet.google.com/abc-defg-hij");
    expect(email.html).toContain(`${APP}/booking/${r.manageToken}`);
    expect(email.ics).toBeUndefined();
    // Host-only details never reach the guest.
    expect(email.text).not.toContain("Private notes");
  });

  it("sends once: a second run finds it recorded", async () => {
    const r = await book(db, start, LONG_AGO);
    const { sender, deps: d } = deps();
    const reminder = { bookingId: r.booking.id, kind: "hour" as const, startsAt: start };
    expect(await sendReminder(d, reminder, oneHourBefore)).toBe("sent");
    expect(await sendReminder(d, reminder, oneHourBefore)).toBe("already_sent");
    expect(sender.sent).toHaveLength(1);
  });

  it("sends once even if it crashed after sending but before recording (idempotency key)", async () => {
    const r = await book(db, start, LONG_AGO);
    const { sender, deps: d } = deps();
    const reminder = { bookingId: r.booking.id, kind: "hour" as const, startsAt: start };
    await sendReminder(d, reminder, oneHourBefore);
    await db.delete(bookingReminders); // as if the record never happened
    expect(await sendReminder(d, reminder, oneHourBefore)).toBe("sent");
    expect(sender.sent).toHaveLength(1);
    expect(sender.keys).toEqual([`reminder/${r.booking.id}/hour/${start.getTime()}`]);
  });

  it("doesn't send for a meeting that moved or was cancelled since it was scheduled", async () => {
    const moved = await book(db, start, LONG_AGO);
    const cancelled = await book(db, t("2026-11-20T03:00"), LONG_AGO);
    await rescheduleBookingByToken(db, moved.manageToken, t("2026-11-20T02:00"), LONG_AGO);
    await cancelBookingAsHost(db, "host", cancelled.booking.id, null, LONG_AGO);
    const { sender, deps: d } = deps();
    for (const [b, s] of [
      [moved, start],
      [cancelled, t("2026-11-20T03:00")],
    ] as const) {
      expect(
        await sendReminder(d, { bookingId: b.booking.id, kind: "hour", startsAt: s }, oneHourBefore),
      ).toBe("changed");
    }
    expect(sender.sent).toHaveLength(0);
  });

  it("doesn't send when it woke too late to help", async () => {
    const r = await book(db, start, LONG_AGO);
    const { sender, deps: d } = deps();
    const reminder = { bookingId: r.booking.id, kind: "hour" as const, startsAt: start };
    expect(await sendReminder(d, reminder, minutesBefore(start, 10))).toBe("too_late");
    expect(sender.sent).toHaveLength(0);
  });

  it("still reminds when there's no usable manage link (made before Day 17), pointing to the first email", async () => {
    const r = await book(db, start, LONG_AGO, { seal: false });
    const { sender, deps: d } = deps();
    await sendReminder(d, { bookingId: r.booking.id, kind: "hour", startsAt: start }, oneHourBefore);
    expect(sender.sent[0]!.text).toContain("use the link in your booking confirmation email");
    expect(sender.sent[0]!.html).not.toContain("/booking/");
  });
});

describe("reminderHeading", () => {
  const start = t("2026-11-21T10:00");
  it("says how long is actually left when it's soon", () => {
    expect(reminderHeading(minutesBefore(start, 60), start, "Europe/London")).toBe("Starts in 1 hour");
    expect(reminderHeading(minutesBefore(start, 42), start, "Europe/London")).toBe("Starts in 40 minutes");
    expect(reminderHeading(minutesBefore(start, 2), start, "Europe/London")).toBe("Starts in 5 minutes");
  });
  it("uses the guest's own calendar day for today and tomorrow", () => {
    const now = t("2026-11-20T22:00"); // 12 hours before
    expect(reminderHeading(now, start, "Europe/London")).toBe("Your meeting is tomorrow");
    expect(reminderHeading(now, start, "Asia/Dhaka")).toBe("Your meeting is today"); // already the 21st there
    expect(reminderHeading(t("2026-11-18T10:00"), start, "Europe/London")).toBe("Your meeting is coming up");
  });
});
