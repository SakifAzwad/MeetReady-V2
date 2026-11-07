# Day 5: After the booking — emails, invites, cancel and reschedule

**Result:** 229 tests (31 new), typecheck, lint, format and production build green. Browser run against the
production build and real Postgres: a guest books, opens the manage link **from the email that was actually
generated**, reschedules, and cancels; the host sees everything in the dashboard and cancels another booking;
9 emails with the right calendar invites, no console errors.

```
drizzle/0003_booking_management.sql      # hand-edited: safe on a database that already has bookings
src/
├── server/
│   ├── manage-token.ts                  # random token -> SHA-256 hash
│   ├── manage-booking.ts                # guest cancel/reschedule (token), host list/cancel (session)
│   └── email/
│       ├── ics.ts                       # RFC 5545 invites (UID, SEQUENCE, METHOD, folding)
│       ├── booking-email.tsx            # React Email template (6 variants)
│       ├── sender.ts                    # Resend | dev outbox folder | in-memory (tests)
│       ├── notifications.tsx            # who gets which email
│       └── index.ts                     # picks the sender from env
├── lib/booking-format.ts                # "Monday, 9 November 2026, 4:00 AM – 4:30 AM (Europe/London)"
└── app/
    ├── booking/[token]/                 # guest manage page: cancel or reschedule, no login
    └── (app)/dashboard/bookings/        # host: upcoming / past / cancelled, cancel with reason
```

## 1. Guest manage links

The guest has no account, so the link in their email is their authorisation: `/booking/{token}`.

- **Token:** 32 random bytes from the OS's secure generator, base64url (43 characters, URL-safe).
- **Only `SHA-256(token)` is stored**, like a password. A leaked backup or a curious admin can't turn hashes back
  into working links. Tested: the token never appears in the database row.
- **SHA-256, not bcrypt:** bcrypt is deliberately slow to protect weak human passwords from guessing. A 256-bit
  random token can't be guessed, and an unsalted hash can be looked up with an index (`WHERE manage_token_hash = ?`).
- **Not a signed JWT carrying the booking id:** a random token in the database can be revoked or rotated; a
  signed token stays valid until it expires.
- **Malformed tokens never reach the database** (regex first). Wrong token and missing booking both give 404.
- **The page leaks nothing outward:** `noindex` (search engines never store the URL) and `Referrer-Policy:
no-referrer` (clicking the Zoom link from the page doesn't send the URL, token included, to Zoom). Both
  checked in the rendered HTML.

## 2. Cancelling and rescheduling

### Cancel = one conditional UPDATE

```sql
UPDATE bookings SET status='cancelled', cancelled_at=now, cancelled_by='guest', sequence=sequence+1
WHERE manage_token_hash = $1 AND status = 'confirmed' AND starts_at > now
```

The conditions are in the `WHERE`, so there's no "read, check, then write" gap for a second request to slip into.
If nothing was updated, a second query tells "no such booking" apart from "already cancelled / already started".
The host's version is the same with `WHERE id = $1 AND host_id = <session user>`: another host's booking id
gives `not_found` (tested, IDOR again).

### Reschedule = the Day 4 layers again, plus one detail

Per-host lock → re-read the booking under the lock (the guest might have cancelled in another tab) → re-check
with `generateSlots()` → update. **The booking being moved is excluded from the busy times**, otherwise a 60-minute
meeting couldn't move 30 minutes later (its old time overlaps its new one). Tested, and the mutation (no
exclusion) fails exactly that test. Also raced on real Postgres: a reschedule and a new booking going for the same
time at the same moment → exactly one wins.

**In place, not cancel + rebook:** the booking keeps its id, its manage link and its calendar `UID`;
`rescheduled_at` records that it moved and `sequence` goes up. One row per meeting keeps the history simple and
the guest's link valid.

### Database rules added

- `manage_token_hash` NOT NULL + UNIQUE.
- `(status = 'cancelled') = (cancelled_at IS NOT NULL)`: a cancelled booking always says when; a confirmed one
  never does. It immediately caught two of my own tests that cancelled without setting `cancelled_at`.
- `cancelled_by` enum (`host` | `guest`).

## 3. Emails and calendar invites

### Who gets what

| Event              | Guest                     | Host                       |
| ------------------ | ------------------------- | -------------------------- |
| Booked             | ✓ with manage link        | ✓ with guest email + notes |
| Rescheduled        | ✓ old time struck through | ✓                          |
| Cancelled by guest | ✓ receipt                 | ✓ with reason              |
| Cancelled by host  | ✓ with reason             | (they did it)              |

Each person sees times in **their own timezone** (guest's from booking, host's from their profile).

### `.ics` invites (hand-written, RFC 5545)

- **Same `UID` for the life of the booking, `SEQUENCE` +1 on every change, `METHOD:REQUEST` or `METHOD:CANCEL`.**
  That's how Google Calendar, Outlook and Apple Calendar know to _update_ or _remove_ the existing event instead
  of adding a second one. Checked in the browser run: SEQUENCE 0 → 1 (moved) → 2 (cancelled), same UID.
- **Times in UTC (`…Z`)**, so no timezone definitions needed; each calendar shows them in its own zone.
- **Escaping** (`\` first, then `;` `,` newlines) and **folding at 75 bytes**, not characters: a Bangla name is
  3 bytes per character. A mutation that counts characters fails 2 tests.
- **CRLF line endings**, as the spec requires.
- Attached with `Content-Type: text/calendar; method=REQUEST`: that `method` parameter is what makes Gmail show an
  invitation card with "Add to calendar" instead of a plain file.

### Sending: after the response, never inside the transaction

```ts
after(() => notifyBookingConfirmed(emailContext(), id, manageToken));
```

- **Not inside the DB transaction:** an email can't be rolled back, and a slow mail provider would hold the
  per-host lock.
- **Not awaited in the action:** the guest sees "You're booked" without waiting for Resend.
- **`after()` (Next.js):** runs once the response is sent. A failed email is logged; it can't undo a booking.
- **One failure doesn't stop the other** (`Promise.allSettled`). Tested with a sender that fails for the host.
- **What's missing: retries.** If Resend is down, that email is lost. Inngest (planned) adds retries with backoff
  and the 24h/1h reminders.

### Senders behind one interface

`EmailSender.send(message)`: Resend in production; with no `RESEND_API_KEY`, a dev **outbox** that writes
`.html` + `.ics` files to the OS temp folder (the whole flow works with zero setup); an in-memory list in tests.
The notification code doesn't know which one it's using.

### Templates (React Email)

One component, six variants (3 kinds × 2 audiences). React escapes guest-supplied text like any JSX, so a guest
typing `<script>` in their notes shows up as text in the host's email. Tested.

## 4. Host dashboard: Bookings

- Tabs via `?view=upcoming|past|cancelled`. The param is user-controlled: anything else falls back to upcoming.
- Times in the host's zone, with the guest's local time beside it ("their time: 4:00 AM (Europe/London)").
- "Happening now" badge; can't cancel a meeting in progress.
- Cancel is two steps (click, then confirm with an optional reason), so a mis-click can't cancel a meeting.

## 5. Your migration and existing data

`npm run db:migrate` applies `0003`. Your existing test bookings get a random hash (their old confirmation
pages had no manage link anyway), and any cancelled booking without `cancelled_at` gets one. See Stories.

## 6. Likely interview questions

- **"How do guests manage bookings without an account?"** Unguessable token in the email, hashed in the DB;
  explain SHA-256 vs bcrypt vs JWT.
- **"How do you avoid leaking that token?"** Hash at rest, `no-referrer`, `noindex`, never logged.
- **"Why send email with `after()`?"** Not inside the transaction (can't roll back, holds the lock), not blocking
  the response; trade-off: no retries until a job queue.
- **"How do calendar updates work?"** UID + SEQUENCE + METHOD.
- **"How did you change the schema on a live database?"** Add nullable → backfill → set NOT NULL, tested on a
  database with existing rows.
- **"How do you stop a guest injecting HTML into the host's email?"** React escapes text; tested with `<script>`.

## 7. Stories (problems hit and how they were solved)

### The generated migration would have broken the production database

- **What happened:** `drizzle-kit generate` produced `ADD COLUMN "manage_token_hash" text NOT NULL`. On an empty
  test database that's fine. On your Neon database, which already has bookings, Postgres can't fill the new
  column for existing rows.
- **What I did:** proved it first: created a real Postgres database at the Day 4 schema, inserted bookings, and ran
  the generated statement: `column … contains null values`. Then hand-edited the migration: add the column
  nullable, backfill existing rows with a random hash, then `SET NOT NULL`. Same for the new check constraint:
  backfill `cancelled_at` before adding it. Ran the edited migration on that same database: both rows migrated.
- **Lesson:** generated migrations are a draft. Always ask "what happens to the rows that already exist?", and
  test the migration on data, not on an empty database.

### A new constraint caught bugs in my own tests

- **What happened:** after adding "cancelled ⇔ has `cancelled_at`", two older tests (Day 1, Day 4) started
  failing: they marked bookings cancelled without saying when.
- **What I did:** fixed the tests, not the constraint. That's exactly the inconsistent data the constraint exists
  to stop.
- **Lesson:** constraints are tests that run on every write, including the writes your tests make.

### A test assertion that could never fail

- **What happened:** the `.ics` folding test checked that no line contained the replacement character `\uFFFD`.
  Reading it again: a JavaScript string can't contain half a character, so this could never fail.
- **What I did:** replaced it with the real requirement: every line ≤ 75 **bytes**. Then mutated the code to
  count characters instead of bytes: the rewritten test fails, as does the separate whole-invite byte-limit test.
  (That second test already existed, so the suite as a whole would have caught this bug; the weak assertion just
  added nothing.)
- **Lesson:** ask of every assertion "what bug would make this fail?". If none can, it's decoration.

### The browser run found two UX bugs on the reschedule screen

- **What happened:** screenshots showed two "back" buttons at once ("Keep the current time" from the wrapper and
  "Back" from the widget), and after moving the meeting, the details panel still showed the old time.
- **What I did:** moved "Keep the current time" into the widget's time-picker step only; after a successful move,
  `router.refresh()` re-renders the server-rendered panel while the widget keeps its "moved" confirmation (client
  state survives a refresh). Re-ran the flow: panel shows 4:00 AM.
- **Lesson:** look at the screenshots, not just the green ticks.

### Plain-text emails shout

- **What happened:** a test expected "Ada cancelled" in the plain-text email and got "ADA CANCELLED": React
  Email's text renderer upper-cases headings.
- **What I did:** checked headings in the HTML version and kept the plain text for body content.
- **Lesson:** know what each output format does before asserting on it.

### Moving a meeting into its own old time

- **What happened:** a test moving a 60-minute meeting from 10:00 to 10:30 failed. The cause was my test, not the
  code: that event type only offered start times on the hour.
- **What I did:** gave it 30-minute start times so the test checks what it claims (overlapping its own old
  time), then removed the "exclude this booking" option to confirm the test fails without it.
- **Lesson:** when a test fails, first check the test is testing what its name says.

## Next

- **New chat:** Day 6, design. 2–3 visual directions as screenshots, pick one, apply to landing page, booking
  page, dashboard, emails, dark mode and mobile.
- Then: deploy to Vercel, Playwright end-to-end tests in CI, rate limiting, Inngest (email retries, reminders),
  and the AI features.
