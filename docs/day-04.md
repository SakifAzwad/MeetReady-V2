# Day 4: The public booking page

**Result:** 198 tests (36 new), including 4 race tests on a real multi-connection PostgreSQL. Typecheck, lint,
format and production build green. Browser run (Chrome) against the production build and real Postgres: a guest
in London books a host in Dhaka, sees the right times in both zones, and two tabs racing for the same slot end
with exactly one booking.

```
src/
├── server/booking.ts                # public lookups, getBookableSlots, createBooking (lock + re-check)
├── server/booking.test.ts           # rules (PGlite)
├── server/booking.race.test.ts      # races (real Postgres, skipped without TEST_DATABASE_URL)
├── test/postgres.ts                 # fresh real-Postgres database per test
├── lib/validation/booking.ts        # guest form, booking request, slots query
├── lib/scheduling/calendar.ts       # month grid, month range in a timezone, formatting
└── app/
    ├── api/slots/route.ts           # GET free slots (JSON)
    └── [username]/
        ├── page.tsx                 # host profile: active event types
        └── [slug]/                  # booking page, widget (calendar → form → confirmation), action
.github/workflows/ci.yml             # + postgres:17 service container for the race tests
```

## 1. How a booking works

1. **Guest opens `/sakif/intro`.** The server finds the event type by username + slug: only **active** event
   types of **onboarded** hosts. What reaches the browser is display data only: no host email, no booking rules.
2. **The browser asks for slots:** `GET /api/slots?username=…&slug=…&from=…&to=…`, where from/to is the month
   **as the guest sees it** in their timezone, converted to UTC instants.
3. **Server:** loads the host's rules, overrides and confirmed bookings (with each booking's own buffers), and
   calls Day 1's pure `generateSlots()`. Returns UTC ISO strings.
4. **Browser:** groups them by the guest's local date (`groupSlotsByDate`, Day 1) and renders the calendar.
5. **Guest picks a time, fills the form →** `bookSlotAction` → `createBooking()`.

## 2. `createBooking`: three layers against double booking

| Layer                                                                     | What it stops                                                                                        | Why it's needed                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **1. Re-check** with `generateSlots()`                                    | Any time the host wouldn't offer: outside hours, too soon, past, buffer clash, daily limit, off-grid | The slot list in the browser is a suggestion. A guest can POST any time they like.                                            |
| **2. Per-host lock** `pg_advisory_xact_lock(hashtextextended(hostId, 0))` | Two guests passing the re-check at the same moment                                                   | Neither sees the other's uncommitted booking. Bookings for one host take turns; the second re-checks after the first commits. |
| **3. Exclusion constraint** (Day 1)                                       | Two overlapping confirmed bookings, whatever the code does                                           | The last line of defence if layers 1–2 are ever bypassed.                                                                     |

### Why each layer, proven by removing it

- **Without the lock**, deterministic race tests (see Stories) fail every run: a 10:00 booking with a 30-minute
  buffer and a 10:30 booking both succeed, and a "max 1 per day" event gets 2 bookings. One random run let 5
  through.
- **But even without the lock, the same slot was never double-booked:** the exclusion constraint rejected 7 of 10
  racers (`slot_taken`). That's the point of layer 3: the constraint guards the hard invariant (no overlapping
  meetings); the lock guards the softer rules only the app knows (buffers, daily limits).

### Why an advisory lock, and not…

- **…`SERIALIZABLE` isolation?** Also correct, but conflicting transactions fail with error `40001` and need a
  retry loop. The lock makes the second booking simply wait, a few milliseconds.
- **…`SELECT … FOR UPDATE` on the host's `user` row?** Works, but it borrows a real row as a mutex and blocks
  unrelated updates to it (profile edits, timezone changes).
- **…a lock per slot?** Buffers and daily limits span several slots, so per-slot locks can't protect them.
- **Contention?** The lock is per **host**: other hosts never wait. One host getting several bookings in the
  same millisecond is rare, and each waits only for one short transaction.
- **Hash collisions?** `hashtextextended` is 64-bit. A collision would only make two hosts take turns, never
  produce a wrong result.
- **Transaction-scoped (`_xact_`):** released automatically on commit or rollback, so it can't leak.

### Error handling

A failed INSERT aborts the transaction, so `23P01` is caught **outside** `db.transaction()`, after rollback.
`slot_taken` (lost at the database) and `slot_unavailable` (failed the re-check) both reach the guest as
"someone just booked that time, pick another", and the slot list refetches.

## 3. The page

- **Route handler for reads, server action for the write.** Reads should be `GET`: can run in parallel, be
  retried, be cached. Server actions are `POST` and queue one after another. Slots are `Cache-Control: no-store`,
  since every booking changes them.
- **TanStack Query, only here.** The one place the browser fetches data itself (month or timezone changes). The
  `QueryClient` lives inside the widget, not app-wide. After a booking (or a lost race), the slots query is
  invalidated and refetched.
- **The guest's timezone exists only in the browser.** `useSyncExternalStore` returns `null` on the server →
  skeleton; then the real zone. No hydration mismatch. "Today" and the current month are computed in the guest's
  zone too.
- **The month range is computed in the guest's zone:** November in Dhaka starts at `2026-10-31T18:00Z`. A month
  with a DST change isn't a whole number of days (tested for London in March).
- **Times in two zones on the confirmation:** "3:00 AM (Europe/London). That's 9:00 AM for Sakif (Asia/Dhaka)."
- **First available day is pre-selected,** so a guest sees times immediately.
- **Accessible calendar:** a real `<table>`; each day is a button labelled "Monday, 9 November 2026, 16 times
  available" with `aria-pressed` for the selected day; days without times are disabled.
- **Input caps:** the slots API rejects ranges over 62 days (`400`), so one request can't ask for years of slots.
  Start times must have an explicit offset: a bare `2026-11-09T10:00` is ambiguous (10:00 where?).

## 4. Testing

- **Rules (PGlite, 14 tests):** URL lookup (case-insensitive, inactive hidden, no email leaked), DB → slots, and
  every way to ask for an un-offered time.
- **Races (real Postgres, 4 tests):** 10 guests same slot → exactly 1; buffer race; daily-limit race; 8 guests,
  8 times, limit 1. Each test gets its own freshly migrated database, dropped afterwards.
- **Where the races run:** CI starts a `postgres:17` service container and sets `TEST_DATABASE_URL`. Locally
  they skip unless you set it (e.g. with Docker:
  `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17`).
- **Browser run:** London guest books a Dhaka host; Dhaka view shows the same slot as 9:00 AM; booked slot
  disappears for the next guest; two tabs race → one confirmation, one "just taken"; switched-off event → 404;
  bad API input → 400/404; mobile overflow 0.

## 5. Not done yet (on purpose)

- **Rate limiting** the public action and API (Upstash, planned): today a script could fill a host's calendar.
- **Emails, `.ics`, cancel/reschedule links, bookings in the dashboard:** Day 5.
- **Custom booking questions:** later in Phase 1.

## 6. Likely interview questions

- **"How do you prevent double booking?"** Three layers; show the table and the "remove the lock" results.
- **"Isn't the constraint enough?"** For overlapping meetings, yes. Not for buffers or daily limits: two
  non-overlapping bookings can still break those, and only the app knows the rules.
- **"Why an advisory lock?"** vs SERIALIZABLE (retries), FOR UPDATE (borrowed row), per-slot locks (rules span
  slots).
- **"How do you test a race condition?"** Real Postgres, a barrier to force both transactions past the check
  together, and a mutation run showing the test fails without the fix.
- **"How do you handle timezones on the booking page?"** Host rules in host zone → UTC instants → guest zone for
  display. Month boundaries and "today" in the guest's zone.
- **"Why a route handler and not a server action for slots?"** GET semantics: parallel, retryable, cacheable.

## 7. Stories (problems hit and how they were solved)

### Proving the lock is necessary: making a race test deterministic

- **What happened:** with the lock removed, the "10 guests at once" style tests still mostly passed. Each
  transaction takes a few milliseconds, so the bookings rarely overlap. A test that only catches a race by luck
  proves nothing.
- **What I did:** added a test hook (`afterCheck`) that runs between the re-check and the insert, plus a
  barrier that holds each booking there until both arrive (or 500 ms pass). Without the lock, both bookings pass
  the check, meet at the barrier, and both insert: the buffer and daily-limit tests fail **every run** with 2
  bookings. With the lock, the second can't start its check until the first commits, so the first times out at
  the barrier and goes ahead alone. 5 out of 5 runs pass.
- **Bonus finding:** even without the lock, the same slot was never double-booked; the exclusion constraint
  caught 7 of 10 racers. Each layer is visible in the results.
- **Lesson:** a race test should force the dangerous interleaving, then be shown to fail without the fix.

### PGlite can't test races

- **What happened:** all earlier database tests ran on PGlite (in-process Postgres). It has one connection, so
  two transactions can't run at the same time, and race tests there would pass vacuously.
- **What I did:** found a PostgreSQL 16 on my build machine (it refuses to run as root, so it runs as a separate
  user), wrote a helper that creates a fresh migrated database per test and drops it after, gated the suite on
  `TEST_DATABASE_URL`, and added a Postgres service container to CI.
- **Lesson:** pick the test database for what the test needs. Fast in-process for logic, real server for
  concurrency.

### Teardown crashed the run after the tests passed

- **What happened:** all race tests passed, but Vitest reported unhandled errors: `57P01 terminating connection
due to administrator command`.
- **Why:** dropping the test database `WITH (FORCE)` killed pool connections that were still closing, and those
  connections had no error listener.
- **Fix:** attach a no-op error listener to the pool only during shutdown.
- **Lesson:** read the whole test output. Green tests plus "2 errors" can still fail CI.

### Not silencing the type checker

- **What happened:** override dates come from Postgres as strings; `generateSlots` wants a `DateKey`. My first
  draft passed them with `as never`, which silences every type error on that line.
- **Fix:** map each override with an explicit `date as DateKey`, with a comment on why it's safe (Postgres `date`
  serialises as `YYYY-MM-DD`).
- **Lesson:** a cast should be the narrowest true statement you can make, not an off switch.

### Locale strings differ between runtimes

- **What happened:** a formatting test expected "Monday 9 November 2026"; Node's ICU produced
  "Monday, 9 November 2026" (and the short form has no comma).
- **What I did:** printed the real output before changing anything, then pinned the tests to it.
- **Lesson:** `Intl` output depends on the ICU data in the runtime. Test the parts that matter (right day, right
  time, right zone), and keep exact-string tests few.

### A streaming page fooled my test script

- **What happened:** the browser script reported that a host with no active event types did _not_ show "No
  meetings available".
- **Why:** that part of the page streams in behind `<Suspense>`, and I'd used `isVisible()`, which checks once
  and doesn't wait. Re-checked with `waitFor()`: the message was there.
- **Lesson:** with streaming UIs, assertions must wait for content. Check the test before blaming the app.

## Next (day 5)

After booking: confirmation emails with an `.ics` calendar invite (Resend + React Email), cancel and reschedule
links that work without logging in (signed tokens), and a bookings list in the host dashboard
(upcoming / past / cancelled).
