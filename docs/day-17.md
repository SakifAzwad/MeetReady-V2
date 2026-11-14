# Day 17: Background jobs (Inngest), automatic retries and reminder emails

**Result:**

- **Reminder emails:** guests get one a day before and one an hour before the meeting. Each has the time in their
  timezone, the location (with the Google Meet link) and their reschedule/cancel link. Hosts get none (their own
  calendar alerts them).
- **Automatic retries:**
  - a failed Google Calendar write is retried with growing gaps (8 tries), instead of waiting for the host's
    Retry click. Retry still exists for when every try has failed;
  - a failed email is retried (4 tries) without sending the other recipient's email twice.
- **Backfill on connect:** when a host connects Google Calendar, their upcoming bookings go into it too (until now,
  only new or changed bookings did).
- **Concurrent syncs are ordered** (Day 16 backlog): one booking's Google jobs run one at a time, and an email
  about a change that's been overtaken by a newer one is skipped.
- **Still works without Inngest:** in local dev and in the E2E tests, or if Inngest can't be reached, the same jobs
  run straight after the request, as before (no retries, no reminders).
- **The manage link is stored twice, never in the clear:** a hash to check it (as before) and an encrypted copy
  (AES-256-GCM) so emails sent later can include it.
- **Privacy page updated:** reminders, the encrypted copy of the link, and Inngest as a new service that sees
  booking ids and times only.
- **Tests:** 556 unit tests (42 new) and the 21 E2E tests, all green (they run the jobs inline). Plus one manual
  run against the real Inngest dev server: functions registered, a booking's emails sent through it with a working
  manage link, the sweep scheduled a reminder, a second sweep didn't duplicate it, and the reminder was sent at its
  minute. Typecheck, lint, format, `drizzle-kit check`, the build and the race tests on real Postgres are green.
- **Setup:** `npm install` (adds `inngest`), migration 0007 (one column, one table, one index: additive, runs in
  the build), and runbook step 15 (the Inngest Vercel integration).

```
src/server/jobs/events.ts        # the four events (Zod schemas): ids and times only
src/server/jobs/handlers.ts      # what each job does, as plain functions over `steps` (testable, reused inline)
src/server/jobs/functions.ts     # the Inngest functions: triggers, retries, one-at-a-time per booking, scrubbed errors
src/server/jobs/inline.ts        # the fallback: same handlers, run in after() with no queue
src/server/jobs/index.ts         # wiring: Inngest client, deps, jobs.bookingChanged / calendarConnected
src/app/api/inngest/route.ts     # where Inngest calls in (signed requests only)
src/server/reminders.ts          # findDueReminders (the sweep's query), sendReminder, the rules
src/server/manage-token.ts       # sealManageToken / openManageToken (AES-256-GCM, HKDF key, booking id as AAD)
src/server/manage-link.ts        # sealToken with the app's secret (server only)
src/server/calendar/sync.ts      # attemptSync (reports nothing, says if retrying helps); upcomingBookingsToSync
src/server/email/notifications.tsx  # one composer per recipient; the reminder email and its heading
src/server/email/sender.ts       # idempotency keys (Resend), "already sent" treated as success
src/lib/monitoring.ts            # scrubError: what a failed step may tell a third party
src/db/schema.ts + drizzle/0007  # bookings.manage_token_encrypted, booking_reminders, a partial index
actions + calendar-connected     # after(): jobs.bookingChanged(...) / jobs.calendarConnected(...)
src/app/privacy/page.tsx         # reminders, the encrypted link, Inngest
```

## 1. Decisions

### Why a job queue now

- **What `after()` gave us (Days 5–16):** the work ran once, in the same serverless function, after the response.
  Fine for "usually works", but:
  - nothing tried again: a Google hiccup meant the host had to press Retry, a mail hiccup meant a lost email;
  - nothing could happen LATER: a reminder 24 hours before needs something that wakes up on its own.
- **A queue adds both:** work is written down first (an event), then run, and run again if it fails.

### Why Inngest

- **No worker to host.** BullMQ or pg-boss need a process that's always running and polling. Vercel only runs code
  when a request arrives. Inngest calls our app over HTTP (`/api/inngest`) for each step, so the "worker" is just
  another route on Vercel.
- **Steps, not just retries.** A plain queue (Upstash QStash, say) retries a whole message. Inngest saves the result
  of each finished step, so a retry only repeats the step that failed. That matters here: "write Google, email the
  guest, email the host" must not email the guest again because the host's email failed.
- **Cron, sleeps and per-key concurrency** come with it, and a local dev server shows every run.
- **Cost:** the free plan includes 50,000 executions a month (a run and each of its steps count). The sweep, every
  15 minutes, uses about 6,000; each booking about 10 (its change plus two reminders).
- **Not Vercel Cron:** the Hobby plan runs it once a day.

### Events carry ids, never data

- An event is `{ bookingId, change, sequence, at }`. No names, emails or tokens.
- **Why:** Inngest stores every event and every step's result (that's how it retries). Whatever goes in is copied to
  a third party. The job reads the rest from our database when it runs, which also means it acts on the booking as
  it is then, not as it was when queued.
- **Step results** are status words (`"sent"`, `"superseded"`, `"retry"`), and the sweep's list is ids and times.
  A test checks no name or address ends up in them.
- **Errors too:** Inngest stores the error of a failed step. A database error carries the query's values (guest
  names, notes), so each step's error goes through `scrubError` first (the same rules as Sentry's scrubber). See
  the story below.

### One step per side effect, and every step safe to repeat

- `booking-changed` has three steps: `calendar`, then `email-guest` and `email-host` side by side. If the host's
  email fails, Inngest runs the function again from the top, but `calendar` and `email-guest` return their saved
  results instead of running.
- **The two emails run in parallel** (`Promise.allSettled` over two steps), not one after the other: a failing step
  holds back the steps after it, so one recipient's problem must not block the other's email (story below).
- **A step can still run twice:** it finished, then the request died before Inngest heard back. So:
  - Google writes were already idempotent (Day 16: the event id comes from the booking id);
  - every email has an **idempotency key** built from what it is: `booking/{id}/{sequence}/{guest|host}`,
    `reminder/{id}/{kind}/{start}`. Resend sends a key once and answers repeats with the first result. A random key
    per try would dedupe nothing.
- **Same key, different content** is an error at Resend (`409`). A retried email could differ: the `.ics` carries a
  timestamp. So the timestamp is the change's own time (`at`, from the event), not "now", and the sender treats that
  `409` (`invalid_idempotent_request`) as "already sent".

### Emails don't wait for Google

- `booking-changed` tries Google **once**, then sends the emails. If Google failed for a reason that can pass
  (timeout, 5xx, 429), it sends a `calendar/sync` event to a separate job that retries with growing gaps.
- **Why not retry inside `booking-changed`:** the emails come after Google (they need the Meet link it creates).
  Retries there would hold the guest's confirmation for minutes. A confirmation without the Meet link now beats a
  complete one in an hour. (The reminders then carry the link, once Google has made it.)
- **Lost access isn't retried:** only the host reconnecting fixes it. It's reported once and the dashboard shows
  "Not in Google Calendar", as on Day 16.
- **Sentry hears about the final failure only:** `attemptSync` reports nothing and returns whether retrying helps.
  The retrying job reports when it gives up (`onFailure`). One Google outage = one report per booking, not eight.
- **Retry button:** unchanged and still synchronous (the host wants an answer now).

### Ordering: one at a time per booking, and stale emails skipped

- **The Day 16 race:** two quick reschedules, two syncs in parallel, and the older time could reach Google last.
- **Fix, part 1:** both functions that write to Google share a concurrency key, `"booking-" + bookingId`, limit 1,
  scope `env`. One booking's jobs take turns; other bookings aren't held up. Each sync reads the booking as it is
  when it runs, so whichever runs last writes the latest time.
- **Fix, part 2:** each event carries the booking's `sequence` after the change. An email job that finds a higher
  sequence skips ("superseded"): the newer change sends its own email. Order then doesn't matter.
- The actions needed the new sequence: cancel and reschedule now return it (`RETURNING sequence`).

### Reminders: a sweep, not a sleep

- **The textbook way** is one run per booking that sleeps until "24 hours before". Rejected:
  - bookings can be 60+ days ahead, longer than the free plan lets a run live (30 days, sleeps included);
  - every reschedule or cancel would have to find and cancel that run. The queue would hold a second copy of the
    schedule that can drift from the database.
- **Instead:** every 15 minutes, a cron job asks the database which reminders fall due in the next 30 minutes and
  queues one short job each. That job sleeps until the exact minute (at most half an hour), reads the booking again,
  and sends only if it's still confirmed at the same start time.
- **The database stays the only copy of the schedule:** a cancelled booking stops matching the query; a moved one
  matches again at its new time.
- **"Sent once" is a table,** `booking_reminders`, keyed by (booking, kind, **start time**). Moving a meeting gives it
  a new start, so its reminders are due again with nothing to reset. Inngest also drops a second event with the
  same id (`reminder-{kind}-{booking}-{start}`), so overlapping sweeps can't queue one twice.
- **Rules** (`REMINDERS` in `reminders.ts`):
  - **horizon 30 minutes,** twice the cron interval, so one late or failed sweep misses nothing;
  - **late but useful:** a reminder missed during an outage is still sent while it can help (day-before until 12
    hours before, hour-before until 15 minutes before);
  - **not right after booking:** no reminder within 30 minutes of the booking being made or moved (the confirmation
    just arrived). Booked 3 hours ahead: no day-before reminder, but the hour-before one goes;
  - **the heading comes from the time actually left** ("Starts in 40 minutes" if it woke late), and "today" or
    "tomorrow" in the guest's own timezone.
- **Send, then record:** recording first would lose the reminder if sending failed. A crash between the two could
  send twice; the idempotency key stops that.
- **A partial index** (`starts_at WHERE status = 'confirmed'`) keeps the 15-minute query cheap.
- **Also rejected:** Resend's scheduled emails (at most 30 days ahead, the Meet link frozen at scheduling, and each
  reschedule must cancel the scheduled email).

### The manage link: hashed and encrypted

- **The problem:** since Day 5 only `sha256(token)` is stored. A hash checks a token; it can't give it back. A
  reminder, or a confirmation sent on retry, needs the link itself.
- **Options:** (a) store an encrypted copy, (b) a table of tokens where each email mints its own, (c) carry the token
  in the event with Inngest's encryption middleware. Chose (a): one column, and the events stay id-only. (b) keeps
  the stronger "only hashes" property but changes the manage lookup; (c) still puts the secret in a third party's
  logs, just encrypted.
- **The scheme** (`sealManageToken`):
  - AES-256-GCM: encrypts and authenticates, so a changed value fails to open instead of decrypting to garbage;
  - a fresh random 12-byte IV per token (GCM must never reuse one with the same key);
  - the key is derived from `BETTER_AUTH_SECRET` with HKDF and its own label, so it differs from anything Better
    Auth derives from the same secret;
  - the booking id is the "additional authenticated data": the value only opens for its own row;
  - format `v1.<iv>.<ciphertext+tag>`, so the scheme can change later.
- **What it costs:** a database backup alone still gives no working links. The backup **and** the secret would.
  That's the same as the Google refresh tokens (encrypted since Day 15), which are worth far more.
- **Rule:** hash what you only verify; encrypt what you must send again.
- **Bookings from before today** have no encrypted copy. It's saved the first time the guest reschedules (they just
  proved they hold the token). Until then their reminder says "use the link in your booking confirmation email".
  The same fallback covers a rotated secret.
- **The booking id is now made in the app** (`randomUUID()`) instead of by the database default, because the
  encryption is bound to it before the insert.

### The inline fallback

- With no `INNGEST_EVENT_KEY` or `INNGEST_DEV`, `jobs.*` runs the same handlers right away in `after()`. Same
  pattern as the email outbox and the in-memory rate limiter: the app works with no accounts.
- **Also used when sending to Inngest fails in production:** the booking is already saved, so its emails must not
  be lost to an Inngest outage. Reported to Sentry (`area: jobs-dispatch`).
- **What's different:** no retries (a failed step is reported and the next one still runs), a follow-up runs
  immediately (so a failed Google write gets one second try), and no reminders (only Inngest runs the cron).
- The E2E tests set the Inngest variables to empty, so they always run inline and read emails from the outbox.

### Backfill when a calendar is connected

- The OAuth return route sends `calendar/connected`. One job lists the host's upcoming confirmed bookings that
  aren't in Google yet (never written, or the last write failed) and queues one `calendar/sync` per booking.
- **Fan-out, not a loop of steps:** each booking retries on its own, and one bad booking can't hold up the rest.
- **Bookings already written stay as they are:** if the host deleted one of those events in Google, that was their
  choice (Day 16 rule). Capped at the next 500.

### Things left as they are, on purpose

- **Previews run jobs inline:** runbook step 15 keeps the Inngest keys in Production only. Previews send no real
  email (no Resend key), and Vercel's preview protection would block Inngest from calling them anyway.
- **No transactional outbox:** the textbook fix for "booking saved, event lost" is an outbox table in the same
  transaction plus a relay. The inline fallback covers an Inngest outage at this size. Backlog.
- **No reminder settings** (per event type, or for hosts). Backlog, when someone asks.
- **A late Meet link isn't emailed on its own:** if Google's first try failed and a retry made the link later, the
  guest sees it on their booking page and in the reminders.

## 2. Likely interview questions

- **"How do you make retries safe?"** Every side effect is idempotent: Google events have ids we choose, emails
  have idempotency keys built from what they are, reminders are recorded under a primary key. The queue gives
  at-least-once delivery; idempotency turns that into effectively once.
- **"What's a step, and why several?"** A unit of work whose result Inngest saves. On retry, finished steps return
  their saved result, so only the failed one repeats. One step per side effect means a failure can't repeat a
  different side effect.
- **"Why not sleep until the reminder?"** Long sleeps duplicate the schedule outside the database, need cancelling
  on every change, and hit plan limits. A sweep reads the truth every 15 minutes; the only sleep is under half an
  hour.
- **"Two reschedules in a second: what does Google end up with?"** The latest. Jobs for one booking run one at a
  time (shared concurrency key), each reads the current booking, and a stale change's emails are skipped by
  sequence.
- **"You stored the token now. Isn't that weaker?"** It's encrypted, not stored in the clear: a leaked database
  alone still gives nothing. It's the same trade-off as OAuth refresh tokens, which every calendar app stores.
- **"What does the third party see?"** Booking ids, times and status words. Errors are scrubbed before they're
  stored.
- **"What if Inngest is down?"** Sending the event fails, the request runs the jobs itself (no retries), and Sentry
  is told. Bookings never depend on Inngest.

## 3. Stories (problems hit and how they were solved)

### A hash can't be emailed

- **What happened:** planning reminders, I hit the Day 5 decision: only the hash of the guest's link is stored.
  That was the point (a database leak gives no links), but it also means nothing can put the link in an email sent
  later. Retried confirmations had the same problem, because the raw token used to live only in the request's
  memory.
- **What I did:** compared three options (an encrypted copy, a token per email, the token in the event, encrypted by
  Inngest) and stored an AES-GCM copy, bound to the booking id, with the key outside the database. Old bookings get
  their copy when the guest next uses the link.
- **Lesson:** hashing and encryption answer different questions. Hash what you only need to check; encrypt what
  you need to use again. Decide by what the system must do with the value later.

### The job queue would have stored guest data

- **What happened:** updating the privacy page, I wrote that Inngest "never receives names or email addresses".
  Before publishing it, I checked the claim against the code. Events and step results were clean, but Inngest also
  stores the error of a failed step, and a Drizzle error message ends with the query's values: guest names, notes,
  answers.
- **What I did:** every step's error goes through `scrubError` before Inngest sees it: messages (causes included)
  are joined and run through the Sentry scrubber, and the original cause objects aren't passed on. Tested with a
  database error and a Resend error.
- **Lesson:** a privacy promise covers every path out, including error paths. Writing the policy from the code
  found a leak the code review hadn't.

### Retries need emails that come out the same

- **What happened:** reading Resend's idempotency rules: the same key with **different** content is an error, not a
  repeat. Our `.ics` carries the time it was built, so a retried email would never match the first attempt: the
  retry would fail with `409`, again and again, until it gave up.
- **What I did:** the `.ics` timestamp is now the change's own time (from the event), so a retry builds the same
  bytes. Where content can still differ (a reminder's "Starts in 40 minutes"), the sender treats that `409` as
  "already sent".
- **Lesson:** an idempotency key only works if a retry sends the same request. Anything time-based in the payload
  has to come from the original request, not the clock.

### A test that depended on the time of day

- **What happened:** the first version of the job tests used the real clock: "book a meeting 75 minutes from now,
  then run the sweep". They passed. But the test host isn't available from 23:30 to midnight Dhaka time, so at
  certain times of day the setup booking would have failed.
- **What I did:** the jobs take a clock (`deps.now`), read inside each step so a retry sees the time of the retry.
  Tests pass a fixed one.
- **Lesson:** a test that reads the real clock is a test that fails at some time of day. Inject time, like any other
  input (the Day 7 and Day 9 rule about static pages, from the other side).

### A bouncing guest address would have cost the host their email

- **What happened:** reviewing the finished job, I compared it with the old `after()` code. There, both emails
  were sent with `Promise.allSettled`: one failing didn't stop the other. In the first version of the job they were
  two steps one after the other, and in Inngest a step that keeps failing holds back every step after it. A guest
  address that bounces forever would have meant the host never heard about the booking.
- **What I did:** the two email steps run side by side (`Promise.allSettled` over two steps, then fail if either
  did). Each one succeeds or retries on its own; a finished one is saved and not repeated. (`Promise.all` wasn't
  enough: it fails as soon as one step does, possibly before the other has finished and been saved. The test
  harness caught that.) A test makes the guest's email fail three times in a row and checks the host's was sent
  exactly once.
- **Lesson:** moving code onto a new runtime can quietly change its failure behaviour. Check what the old code
  guaranteed (here: "one failure doesn't stop the others") and test that the new one still does.

### One schedule, two sweeps

- **What happened:** the sweep looks 30 minutes ahead every 15 minutes on purpose (so a late run misses nothing), so
  every reminder is found twice. I needed to prove that didn't mean two emails.
- **What I did:** two layers. Each reminder event has an id made from booking, kind and start time, and Inngest
  drops a repeat. If one got through, `booking_reminders` and the idempotency key stop the second send. Checked on
  the real Inngest dev server: two sweeps, one reminder job, sent at its minute.
- **Lesson:** overlap makes a schedule robust; ids make overlap harmless. Design the duplicate in, then make it a
  no-op.

## Next

- **You:** push, then runbook step 15 (Inngest's Vercel integration, Production only), then the checks there: a
  booking's emails through Inngest, a reminder, and the backfill.
- **Then:** the AI features (booking assistant, MCP server, meeting brief). The AI routes get their own rate limits.
