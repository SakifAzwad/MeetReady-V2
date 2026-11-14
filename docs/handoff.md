# Handoff: starting a new chat (after Day 16)

Read this first in a new chat. It replaces the long Days 1–16 conversations. Details live in `docs/day-01.md` …
`docs/day-16.md`; the plan lives in `docs/backlog.md`.

## Where things stand

- **Built (Days 1–16):**
  - Google login and onboarding.
  - Event types; weekly availability with date overrides.
  - Pure, tested slot generation.
  - Public booking with three layers against double booking: re-check, per-host advisory lock, Postgres
    `EXCLUDE` constraint, proven with race tests.
  - Emails with `.ics` invites; guest cancel/reschedule through hashed token links; host dashboard.
  - The "Daylight" design: real sunrise/sunset, scrubbing, timezone search, share-as-text, week view, landing
    page, motion.
  - Custom booking questions (Day 10): text, pick one, pick several, checkbox. Questions are jsonb on the event
    type; answers are a snapshot on the booking; a `questionsVersion` check catches questions edited mid-booking.
  - Browser tests in CI (Day 11): 12 Playwright tests (booking, race, manage, questions, phone) against the
    production build and real Postgres, in a separate `e2e` job.
  - Deploy-ready (Day 12): migrations in the Vercel build (direct connection, advisory lock), real 404s from
    `proxy.ts`, security headers, app URL from Vercel's variables, smoke tests after each production deploy.
    Runbook: `docs/deploy.md`.
  - Error monitoring (Day 13): Sentry v11 on server and browser via the `/monitoring` tunnel; privacy in
    `src/lib/monitoring.ts` (`DATA_COLLECTION` all off + `scrubEvent`); errors only, no replay. Needs runbook step 10
    on Vercel to go live. The UI shows the real address (`appHost`), never `meetready.app`.
  - Rate limiting (Day 14): `src/server/rate-limit/`. Upstash Redis sliding window in production, the same
    algorithm in memory for dev/tests. Limits in `LIMITS`: book 5/10 min per IP + 3/hour per guest inbox, manage
    10/hour per token, slots 60/min per IP, proxy username lookups 120/min per IP. Fails open (reported to
    Sentry, throttled). Keys are HMAC hashes. Friendly "Try again in N minutes" (typed details kept); `429` +
    `Retry-After` on the API. Needs runbook step 11 to use Redis.
  - Google Calendar, read side (Day 15): `src/server/calendar/`. "Connect Google Calendar" on the Availability
    page = Better Auth `linkSocial` with `calendar.freebusy` + `calendar.events`, `access_type=offline`,
    `prompt=consent`; the callback route checks the granted scopes and a refresh token, then writes
    `calendar_connections` (ours; `account` stays Better Auth's). Busy times go into slot generation as
    `externalBusy` (no buffers of their own, never count to the daily limit). Booking/reschedule check Google
    LIVE before the lock and fail closed (`calendar_unavailable`); showing times uses a cache (1 min fresh, 1 h
    stale-if-error, Redis hash per host); no usable copy → slots API `503`. `last_error` (`access_lost` /
    `unavailable`) shows "New bookings are paused" on the card. Disconnect revokes at Google and clears tokens and
    calendar scopes. Needs runbook step 12.
  - Privacy policy and terms (Day 15 follow-up): `/privacy`, `/terms` (`src/components/site/legal-page.tsx`),
    linked from the footer and the login page, and from Google's consent screen (Branding). The privacy page
    describes what the code does: change one, change the other. App routes live in `src/lib/app-routes.ts`
    (used by `proxy.ts`); `app-routes.test.ts` checks every `src/app` folder is listed and reserved. The Google
    app is published (In production, unverified: "unverified app" warning on connect, 100-account cap).
  - Google Calendar, write side (Day 16): `src/server/calendar/sync.ts`. `calendarSync.syncBooking(id)` makes
    Google match the booking as it is now (confirmed → upsert event, cancelled → delete); runs in `after()` BEFORE
    the emails (they need the Meet link) and never throws. Event id = `googleEventId(bookingId)` (idempotent: 409 →
    PATCH). No attendees, `sendUpdates=none`, Meet via `conferenceData.createRequest`. Booking columns:
    `calendar_event_id`, `meet_url`, `calendar_sync` (`synced` | `failed` | null). Failed → "Not in Google
    Calendar" + Retry on Bookings (`retryCalendarSyncAction`, host-scoped) + Sentry (`area: calendar-sync`).
    Host's email has no `.ics` when synced. Reschedule (live check and `/api/slots`) subtracts the booking's own
    time from Google busy blocks (`subtractInterval`; free/busy merges adjacent events).
- **Numbers:** 514 unit tests + 21 E2E tests + 6 smoke tests; typecheck, lint, format, `drizzle-kit check` and
  build all green. 7 migrations (0000–0006).
- **Live:** <https://meetreadyv2.vercel.app> (Vercel project `meetreadyv2`), demo booking page
  `/sakifazwad18/intro`. Neon project `meetready`, AWS US East 1, Postgres 18; a branch per preview. Set up with
  `docs/deploy.md`.
- **Repo:** `SakifAzwad/MeetReady-V2`. Sakif applies each day from a zip, then commits and pushes. The new chat
  must clone the repo; it can't see the old machine.

## Next (from `docs/backlog.md`)

1. Sakif: push Day 16, then runbook step 14 (book a Google Meet type yourself; one event, Meet link, move, cancel).
2. **Reminder emails with Inngest** (a day and an hour before). Bring automatic retries for calendar writes and
   emails with it (today: Retry button). Backlog has the Day 16 follow-ups that fit a job queue (backfill on
   connect, ordering concurrent syncs by `sequence`).
3. Then AI features. The slot hold waits (Sakif's call).
4. Email: Resend's test sender only reaches Sakif's own address until he buys a domain (accepted for now).

## How Sakif works

- **Brief, direct answers.** He must be able to defend every decision in an interview, so explain the **why**,
  not just the code.
- **Every `docs/day-NN.md`** ends with a **Stories** section: problem → what I did → lesson. Also save it to the
  project as `claude/meetready-v2-day-NN.md`, and add a README link.
- **Delivery:** a zip of changed files, plus steps (unzip, any `npm install` or migration), a commit message and
  study points.
- **He reviews before moving on.** Suggestions are discussed ("opinions first") before building. Deferred ideas go
  in `docs/backlog.md`.
- **Usage is limited.** Keep checks light on non-UI days: unit tests plus one browser run. No videos unless the
  UI changes.
- **Repo access from a chat:** the repo is public, so `git clone` works, but Claude can't push (his GitHub isn't
  linked). That's fine: delivery is a zip. In the cloud workspace, E2E runs with the installed Chrome
  (`E2E_BROWSER_CHANNEL=chrome`; Playwright's download is blocked) and the local Postgres 16
  (`service postgresql start`, password `postgres`).

## Stack and commands

- **Stack:**
  - Next.js 16.4 (App Router, Cache Components, `proxy.ts`), React 19.3, TypeScript strict
    (`noUncheckedIndexedAccess`).
  - Zod 4, React Hook Form; TanStack Query only in the booking widget.
  - Drizzle ORM with `casing: "snake_case"`; Neon in production, `pg` locally.
  - Better Auth (Google, database sessions).
  - React Email + Resend; with no `RESEND_API_KEY`, emails go to a dev outbox folder.
  - Tailwind 4, Radix, self-hosted Bricolage Grotesque and Figtree.
  - Sentry v11 (errors only); Upstash Redis + `@upstash/ratelimit` (rate limits, calendar cache; one client in
    `src/server/redis.ts`).
  - Google Calendar over plain `fetch` (no SDK): `src/server/calendar/google-api.ts`.
- **Commands:** `npm test` (PGlite; set `TEST_DATABASE_URL` to also run the race tests on real Postgres),
  `npm run test:e2e` (Playwright; needs Postgres on :5432, wipes `meetready_e2e`; `E2E_SKIP_BUILD=1`,
  `E2E_BROWSER_CHANNEL=chrome`),
  `npm run typecheck`, `lint`, `format:check`, `npx drizzle-kit check`, `npm run build`. CI runs the same, with a
  Postgres 18 service (same major version as Neon). Smoke tests against a live URL:
  `SMOKE_URL=https://… npx playwright test --config playwright.smoke.config.ts`.
- **Env** (`.env.example` holds names only, never values): `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED` for
  migrations), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (derived on Vercel), `GOOGLE_CLIENT_ID/SECRET`, optional
  `RESEND_API_KEY`, `EMAIL_FROM`, `DEMO_BOOKING_PATH`, `NEXT_PUBLIC_SENTRY_DSN` (+ build-time `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`), `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*`
  names; both or neither). E2E only: `GOOGLE_CALENDAR_API_URL`, `GOOGLE_REVOKE_URL` (a fake Google on :3101). Local dev uses the Neon `dev` branch, never `production`.

## Rules and gotchas learned the hard way

- **Security:** the user id always comes from the session, never the request. Every host query is scoped to
  that user and has an IDOR test. Server actions re-validate input with Zod.
- **Static pages can't read the clock:** `new Date()`, or a `TZDate`, which reads it in its constructor. Read
  time in the browser, or inside `<Suspense>`.
- **Never export plain functions or constants from `"use client"` files to server code.** The server gets a
  reference instead: `cityName` (Day 6) and `REPO_URL` (Day 7) both broke this way. Shared helpers live in
  `src/lib`.
- **Static pages bake env vars in at build time.**
- **Grid/flex overflow:** use `minmax(0, …)` / `min-w-0`.
- **Time:** store UTC; host hours are wall times converted date by date (DST tested); `availabilityWindows`
  feeds both slots and bands.
- **Colour means time of day only.** UI actions are navy. No emoji, no middle-dot meta strings, no all-caps
  labels.
- **Zod 4 skips a missing optional key entirely, refinements included.** Required fields must not be
  `.optional()` (Day 10 story).
- **Nested form errors:** use `fieldErrorsByPath`, not `z.flattenError` (first path segment only).
- **`useFieldArray.update()` remounts the row:** put focus back yourself.
- **E2E tests:** each test makes its own host (fixtures); never share data between tests. No retries: run new
  tests with `--repeat-each 3` and fix flakes at the cause. Playwright starts `webServer` before `globalSetup`.
- **Zod 4 runs object refinements after a field fails its FORMAT check, with the raw value.** Refinements that
  read several fields use `when: noIssuesYet`; `never-throws.property.test.ts` covers every input schema.
- **Streaming pages send 200 first.** Real 404s for public pages come from `proxy.ts` (rewrite to `/_not-found`).
- **Migrations are additive** (they run before the build; old code serves until the new build is live).
- **Sentry v11:** `sendDefaultPii` is gone; `dataCollection` defaults to collecting everything, so keep
  `DATA_COLLECTION` explicit. `withSentryConfig` comes from `@sentry/nextjs/config`. Drizzle errors carry query
  values (`params:`), redacted by the scrubber.
- **New top-level routes are also possible usernames:** add them to `RESERVED_USERNAMES` and proxy's `APP_ROUTES`.
- **Env files:** `KEY=` arrives as `""`, not missing. Optional env vars use `emptyAsUnset`.
- **Browser scripts:** use `locale: "en-US"` when checking AM/PM text. Don't depend on "today"; pick a fixed
  day. Use exact role names (`exact: true`): accessible names like "Move question 1 up" contain "Question".
  Empty the email outbox at the start.
- **Rate limits are shared state.** Every E2E visitor sends its own random `x-forwarded-for` (fixtures), which the
  app trusts off Vercel; on Vercel, Vercel overwrites it. A new public endpoint gets a line in `LIMITS`.
- **Next's route announcer is an empty `role="alert"`** on every page: find messages by text, not by role alone.
- **Edits made on GitHub's website skip the pre-commit hook:** run `npm run format` before the next commit.
- **Google Calendar in tests:** never the real Google. Unit tests pass a fake `ExternalBusy` or fake `fetch`; E2E
  uses `connectCalendar(db, host)` (seeds encrypted tokens with Better Auth's `symmetricEncrypt`) and
  `fakeGoogle.setCalendar(token, { busy, down })`. The consent screen itself is covered by checking the URL
  Better Auth builds (`link-calendar.test.ts`).
- **Never call Google inside a DB transaction** (it would hold the per-host lock): fetch first, pass `externalBusy`.
- **Better Auth reports every token refresh failure the same way** (`FAILED_TO_GET_ACCESS_TOKEN`): treated as
  `access_lost`. Sign-in never overwrites the stored refresh token or the scopes.
- **Google OAuth states (checked 13 Nov):** Testing = anyone can sign in (name/email/picture are exempt), but
  sensitive scopes are test users only and expire after 7 days. Published + unverified = anyone, after an
  "unverified app" warning, 100 accounts ever. Look at the console (Audience page) before explaining an OAuth
  error: Day 15 story.

- **Google writes:** never inside the booking transaction, always through `syncBooking` (idempotent), and the fake
  Google stores events and counts them as busy (`fakeGoogle.events(token)`, `setCalendar(token, { eventsDown })`).
- **Assertions in a loop need a count first** (Day 16 story: a loop over zero emails passed).
- **The booking widget is laid out by its own width** (`@container` + `@min-[42rem]:`), not the window: it's
  embedded in places of different widths (public page, guest's booking page). Times are a grid (Day 16
  follow-up); the "Times on …" group and `button[aria-pressed]` contract for tests is unchanged.
