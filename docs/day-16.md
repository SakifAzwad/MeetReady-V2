# Day 16: Google Calendar, part 2 (bookings go into the host's calendar)

**Result:**

- **Every booking becomes an event in the host's Google Calendar** once a calendar is connected. Rescheduling
  moves the event, and cancelling (by guest or host) removes it.
- **Google Meet links are real now:** for "Google Meet" event types, Google creates the link with the event. It's
  in both emails, on the guest's booking page and on the host's Bookings page, replacing "link to follow".
- **No duplicate invites:**
  - the guest isn't added to the Google event, so Google sends nothing; MeetReady's own email and `.ics` stay
    the only invite;
  - the host's email skips its `.ics` when the event is already in their calendar.
- **If Google fails, the booking stands:**
  - it's marked **"Not in Google Calendar"** on the Bookings page, with a **Retry** button;
  - Sentry is told;
  - the guest is unaffected.
- **A reschedule isn't blocked by its own event:** the booking's old time is cut out of Google's busy blocks,
  both in the times list and in the live check.
- **Privacy page updated:** guests are told their name and email go into the host's calendar, but not their
  notes or answers.
- **Tests:** 514 unit tests (27 new) and 21 E2E tests (2 new, each run 3 times in a row with no flakes), against
  the fake Google, which now stores events and, like Google, counts them as busy. Typecheck, lint, format,
  `drizzle-kit check` and the build are green.
- **Setup:** migration 0006 (three nullable columns on `bookings` and one enum, additive, runs in the build).
  Nothing to do in Google Cloud: the permission was granted on Day 15.

```
src/server/calendar/google-api.ts   # upsertGoogleEvent (create, 409 → update), deleteGoogleEvent, googleEventId
src/server/calendar/sync.ts         # syncBooking: make Google match the booking as it is now; never throws
src/server/calendar/index.ts        # calendarSync wiring (Better Auth tokens, fetch, Sentry)
src/db/schema.ts + drizzle/0006     # bookings.calendar_event_id, meet_url, calendar_sync (synced | failed)
src/lib/scheduling/intervals.ts     # subtractInterval: cut a booking's own time out of busy blocks
src/server/manage-booking.ts        # reschedule: subtract own time; details carry event id, Meet link, sync state
src/app/api/slots/route.ts          # rescheduling: the times list subtracts it too
actions (book, reschedule, cancel)  # after(): sync first, then the emails (they need the Meet link)
src/server/email/notifications.tsx  # host's email: no .ics when the event is already in their calendar
dashboard/bookings/*                # Meet link, "Not in Google Calendar" + Retry (scoped to the host)
src/app/booking/[token]/page.tsx    # "Join with Google Meet" for the guest
src/app/privacy/page.tsx            # what goes into the host's calendar about a guest
e2e/support/fake-google.mjs, e2e/calendar-sync.spec.ts   # events in the fake; book → move → cancel; fail → Retry
```

## 1. Decisions

### One operation: "make Google match the booking"

- **`syncBooking(id)` reads the booking as it is NOW, then:**
  - confirmed → the event exists at the booking's time (create it, or update it);
  - cancelled → the event is gone.
- **Booking, rescheduling, cancelling and Retry all call it.** There's no separate "create", "move" and "delete"
  code path to keep consistent, and Retry needs no idea of what failed.
- **Running it twice is harmless (idempotent):**
  - the Google event id is derived from the booking id (`googleEventId`). Google lets clients choose ids, from
    `0-9a-v`, and a UUID without dashes is hex, which fits;
  - if a create times out after Google saved it, the retry gets `409 already exists` and updates instead of
    making a second event;
  - deleting something already gone (`404`/`410`) counts as done.
- **The state lives on the booking:** `calendar_sync` is `synced`, `failed`, or `null` (the host had no calendar
  connected). The Bookings page reads it; Sentry gets one report per failure.

### When it runs: after the booking, before the emails

- **After the commit, in `after()`:** Google can't be rolled back with Postgres, and the guest shouldn't wait on
  Google to see "You're booked".
- **Before the emails:** the confirmation needs the Meet link that Google creates with the event.
- **It never throws.** Anything unexpected (even a database error) is caught, reported and counted as "failed".
  Otherwise one Google problem could stop the booking emails from being sent.

### If Google fails

- **The booking stands.** It's committed and the guest has been told; undoing it because of Google would be
  worse.
- **The host sees it:** "Not in Google Calendar" (or "Still in Google Calendar" on a cancelled one) with
  **Retry**. Retry runs the same sync, after checking the booking belongs to the signed-in host (same IDOR rule as
  everywhere).
- **The guest is unaffected:** their email says "Google Meet (link to follow)", and the link appears on their
  booking page once a retry succeeds. Retrying never emails the guest again.
- **Automatic retries wait for a job queue** (Inngest, with the reminders): today a failure waits for the host to
  click.

### What goes into the host's event

- **Title:** "Intro call with Ada". **Description:** "Booked through MeetReady", the guest's name and email, and
  a link to the dashboard.
- **Not the guest's notes or answers.** Same rule as Day 10: those are for the host, in MeetReady and the host's
  email.
- **No attendees.** If the guest were an attendee, Google would send a second invite (or, with notifications off,
  they'd get a second calendar entry with a different id). The guest's invite is MeetReady's `.ics`.
- **No emails from Google at all:** `sendUpdates=none` on every call.
- **Meet:** `conferenceDataVersion=1` with a `createRequest` (`hangoutsMeet`). Its `requestId` is the booking id,
  so Google's side is idempotent too. Zoom, phone and in-person types put their link or address in the event's
  location instead.

### No duplicates for the host either

- **The problem:** the host's own email has always carried an `.ics`. With the event already written to their
  calendar, accepting that `.ics` would add the meeting twice.
- **The rule:** when `calendar_sync` is `synced`, the host's email has no `.ics`. The guest's always does. If
  syncing failed, the host gets the `.ics` as before: then it's the only way the meeting reaches their calendar.

### Rescheduling past its own event

- **The problem:** the booking's own event is now busy time in Google. Without a fix, a guest moving their
  meeting would see their own time, and anything overlapping it, as taken.
- **Why not "drop the matching busy block":** Google's free/busy answer has no event ids, and it MERGES touching
  events. A booking at 10:00–10:30 followed by another meeting at 10:30–11:00 comes back as one block, 10:00–11:00,
  which matches nothing.
- **The fix:** `subtractInterval` cuts the booking's old time out of every busy block. In the example, 10:30–11:00
  survives, so the real meeting still blocks.
- **Applied in two places:** the live check in `rescheduleBookingByToken`, and the times list (`/api/slots` with
  a reschedule token).

### Things left as they are, on purpose

- **A host who deleted the event in Google:** a later update gets `404`/`410` and doesn't recreate it. It's their
  calendar.
- **A host who disconnects:** events already written stay; MeetReady no longer has access to remove them.
- **Bookings made before connecting** aren't copied in. They're added the first time they change (a reschedule
  creates the event).

## 2. Likely interview questions

- **"How do you keep two systems in sync without a distributed transaction?"** The database is the source of
  truth and commits first. A reconciliation step then makes Google match the current state. It's idempotent
  (client-chosen event ids, `409` → update, `404` on delete = done), so any failure is fixed by running it again:
  a Retry button today, a job queue later.
- **"What if Google is down when someone books?"** For reading busy times, the booking is refused (Day 15: fail
  closed). For writing the event afterwards, the booking stands and is flagged for retry. Different moments,
  different risks: before committing, a clash is the danger; after, losing a confirmed booking would be.
- **"Why not add the guest as an attendee?"** Two invites for one meeting, with different ids. One invite, from
  us, with a stable UID and SEQUENCE, is cleaner.
- **"How does rescheduling avoid blocking itself?"** Interval subtraction of the old time from the busy blocks,
  because free/busy merges adjacent events and has no ids.
- **"Why does the sync never throw?"** It runs before the emails in the same `after()`. A Google problem must not
  cost the guest their confirmation.

## 3. Stories (problems hit and how they were solved)

### A timeout would have made two events

- **What happened:** planning the retry path: a create can time out on our side after Google has already saved
  the event. A plain "create again" would then make a second event.
- **What I did:** we choose the event id (derived from the booking id). The second create gets `409 already
exists` and turns into an update. A Retry, an automatic retry later, or a double click all end up with one event.
- **Lesson:** anything that can be retried needs an idempotency key. If the API lets you choose ids, that's the
  key.

### The host would have had the meeting twice

- **What happened:** wiring the emails, I noticed the host's confirmation has always carried an `.ics`. Now the
  same meeting is also written straight into their calendar. Accepting the `.ics` would add a second copy.
- **What I did:** the host's email skips the `.ics` when the booking is synced, and keeps it when syncing failed
  (then it's the only way in). Tests check both.
- **Lesson:** a new path into the same place (the host's calendar) means checking the old paths into it.

### The times list needed the fix too

- **What happened:** the plan covered the live check when a reschedule is confirmed. But the times list a guest
  picks from asks Google too. With only half the fix, the booking's own time would have disappeared from the list
  while still being allowed.
- **What I did:** the slots API subtracts the booking's own time as well. The E2E test checks that the guest's
  original time is still the first one offered when they reschedule, with the event busy in the fake Google.
- **Lesson:** a rule that decides what's bookable has to hold everywhere availability is computed: list and check.

### One Google bug could have eaten the booking emails

- **What happened:** the sync runs before the emails in the same `after()`, so the emails can carry the Meet link.
  If the sync ever threw (a database hiccup, an unexpected response), the emails after it would never be sent.
- **What I did:** `syncBooking` catches everything, reports it, and returns "failed". A test breaks the database
  on purpose and checks it still returns.
- **Lesson:** when two steps share a sequence, the optional one must never be able to stop the essential one.

### A test that passed by checking nothing

- **What happened:** "without a calendar, both emails still get an `.ics`" looped over the sent emails and checked
  each. It passed. But my helper built the memory sender the wrong way, so the list was empty: the loop checked
  zero emails.
- **What I did:** fixed the helper, and the test now asserts there are exactly two emails before looping.
- **Lesson:** an assertion inside a loop proves nothing if the loop can run zero times. Assert the count first.

## Next

- **You:** push, then book yourself with a Google Meet event type and check the event and the link in your
  calendar (runbook step 14).
- **Then:** reminder emails with Inngest (a day and an hour before), which also brings automatic retries for
  calendar writes and emails.
