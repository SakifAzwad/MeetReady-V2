import { beforeEach, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "../availability";
import { createBooking } from "../booking";
import { createEventType } from "../event-types";
import { cancelBookingAsHost, cancelBookingByToken, rescheduleBookingByToken } from "../manage-booking";
import { notifyBookingCancelled, notifyBookingConfirmed, notifyBookingRescheduled } from "./notifications";
import { createMemorySender, type EmailMessage, type EmailSender } from "./sender";

// Host in Dhaka (09:00–17:00 Monday = 03:00–11:00 UTC); guest in London (UTC in November).
const NOW = new Date("2026-11-01T00:00:00Z");
const APP = "https://meetready.test";
const COMPANY = "3f1c2a7e-8b4d-4c9a-9e2f-1a2b3c4d5e6f";
const TOPICS = "7a9b8c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("booking emails", () => {
  let db: Database;
  let bookingId: string;
  let token: string;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(user).values({
      id: "host",
      name: "Sakif Azwad",
      email: "sakif@example.com",
      username: "sakif",
      timeZone: "Asia/Dhaka",
    });
    await saveWeeklySchedule(db, "host", {
      timeZone: "Asia/Dhaka",
      rules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    });
    await createEventType(
      db,
      "host",
      eventTypeSchema.parse({
        ...EVENT_TYPE_DEFAULTS,
        title: "Intro call",
        slug: "intro",
        locationType: "zoom",
        locationValue: "https://us05web.zoom.us/j/123",
        minimumNoticeMinutes: 0,
        bookingWindowDays: null,
        questions: [
          { id: COMPANY, type: "text", label: "Company", required: true, multiline: false },
          {
            id: TOPICS,
            type: "multi_choice",
            label: "Topics",
            required: false,
            options: ["Pricing", "Hiring", "Roadmap"],
          },
        ],
      }),
    );
    const r = await createBooking(
      db,
      {
        username: "sakif",
        slug: "intro",
        startsAt: new Date("2026-11-09T04:00:00Z"), // 10:00 Dhaka, 4:00 London
        guestName: "Ada",
        guestEmail: "ada@example.com",
        guestTimeZone: "Europe/London",
        guestNotes: "<script>alert('x')</script> Let's talk about the role",
        answers: { [COMPANY]: "Acme Corp", [TOPICS]: ["Roadmap", "Hiring"] },
      },
      NOW,
    );
    if (!r.ok) throw new Error("setup failed");
    bookingId = r.booking.id;
    token = r.manageToken;
  }, 30_000);

  const to = (sent: EmailMessage[], email: string) => sent.find((m) => m.to === email)!;

  it("confirmation: guest and host each get one, in their own timezone, with an invite", async () => {
    const sender = createMemorySender();
    await notifyBookingConfirmed({ db, sender, appUrl: APP, now: NOW }, bookingId, token);

    expect(sender.sent.map((m) => m.to).sort()).toEqual(["ada@example.com", "sakif@example.com"]);
    const guest = to(sender.sent, "ada@example.com");
    const host = to(sender.sent, "sakif@example.com");

    expect(guest.subject).toBe("Confirmed: Intro call with Sakif Azwad – Mon 9 Nov");
    expect(guest.text).toContain("4:00 AM – 4:30 AM (Europe/London)");
    expect(host.text).toContain("10:00 AM – 10:30 AM (Asia/Dhaka)");

    // Only the guest gets the manage link; only the host sees guest email + notes.
    expect(guest.html).toContain(`${APP}/booking/${token}`);
    expect(host.html).not.toContain(token);
    expect(host.text).toContain("ada@example.com");
    expect(host.text).toContain("Let's talk about the role");

    expect(guest.ics?.method).toBe("REQUEST");
    expect(guest.ics?.content).toContain(`UID:${bookingId}@meetready`);
    expect(guest.ics?.content).toContain("SEQUENCE:0");
    expect(guest.ics?.content).toContain("LOCATION:https://us05web.zoom.us/j/123");
  });

  it("booking answers go to the host's email only, never the guest's email or the invite", async () => {
    const sender = createMemorySender();
    await notifyBookingConfirmed({ db, sender, appUrl: APP, now: NOW }, bookingId, token);
    const guest = to(sender.sent, "ada@example.com");
    const host = to(sender.sent, "sakif@example.com");

    expect(host.text).toContain("Company");
    expect(host.text).toContain("Acme Corp");
    expect(host.text).toContain("Hiring, Roadmap"); // the host's option order, not the click order
    for (const leak of [guest.text, guest.html, guest.ics?.content, host.ics?.content]) {
      expect(leak).not.toContain("Acme Corp");
    }
  });

  it("escapes guest-supplied text in the host's email (no HTML injection)", async () => {
    const sender = createMemorySender();
    await notifyBookingConfirmed({ db, sender, appUrl: APP, now: NOW }, bookingId, token);
    const host = to(sender.sent, "sakif@example.com");
    expect(host.html).not.toContain("<script>");
    expect(host.html).toContain("&lt;script&gt;");
  });

  it("reschedule: shows old and new times, invite is an update (same UID, SEQUENCE 1)", async () => {
    const moved = await rescheduleBookingByToken(db, token, new Date("2026-11-09T06:00:00Z"), NOW);
    if (!moved.ok) throw new Error("reschedule failed");
    const sender = createMemorySender();
    await notifyBookingRescheduled(
      { db, sender, appUrl: APP, now: NOW },
      bookingId,
      moved.previousStartsAt,
      token,
    );

    const guest = to(sender.sent, "ada@example.com");
    expect(guest.subject).toMatch(/^Rescheduled:/);
    expect(guest.text).toContain("6:00 AM – 6:30 AM (Europe/London)");
    expect(guest.text).toContain("4:00 AM – 4:30 AM (Europe/London)"); // previous time, struck through in HTML
    expect(guest.ics?.content).toContain(`UID:${bookingId}@meetready`);
    expect(guest.ics?.content).toContain("SEQUENCE:1");
  });

  it("guest cancels: guest gets a receipt, host is told, invites remove the event", async () => {
    await cancelBookingByToken(db, token, "Found another slot", NOW);
    const sender = createMemorySender();
    await notifyBookingCancelled({ db, sender, appUrl: APP, now: NOW }, bookingId);

    expect(sender.sent).toHaveLength(2);
    const host = to(sender.sent, "sakif@example.com");
    expect(host.html).toContain("Ada cancelled"); // plain text upper-cases headings
    expect(host.text).toContain("Found another slot");
    for (const m of sender.sent) {
      expect(m.ics?.method).toBe("CANCEL");
      expect(m.ics?.content).toContain("METHOD:CANCEL");
    }
  });

  it("host cancels: only the guest is emailed", async () => {
    await cancelBookingAsHost(db, "host", bookingId, "Sorry, I'm ill", NOW);
    const sender = createMemorySender();
    await notifyBookingCancelled({ db, sender, appUrl: APP, now: NOW }, bookingId);

    expect(sender.sent.map((m) => m.to)).toEqual(["ada@example.com"]);
    expect(sender.sent[0]!.html).toContain("Sakif cancelled your meeting");
  });

  it("one failed send doesn't stop the other, and doesn't throw", async () => {
    const delivered: string[] = [];
    const flaky: EmailSender = {
      async send(m) {
        if (m.to === "sakif@example.com") throw new Error("provider down");
        delivered.push(m.to);
      },
    };
    const original = console.error;
    console.error = () => {}; // keep the expected failure out of the test output
    try {
      await expect(
        notifyBookingConfirmed({ db, sender: flaky, appUrl: APP, now: NOW }, bookingId, token),
      ).resolves.toBeUndefined();
    } finally {
      console.error = original;
    }
    expect(delivered).toEqual(["ada@example.com"]);
  });
});
