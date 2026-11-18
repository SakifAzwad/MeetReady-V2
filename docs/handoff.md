# Handoff: starting a new chat (after Day 19)

Read this first in a new chat. It replaces the long Days 1–19 conversations. Details live in `docs/day-01.md` …
`docs/day-19.md`; the plan lives in `docs/backlog.md`.

## Where things stand

- **Built (Days 1–19):**
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
  - Background jobs (Day 17): `src/server/jobs/`. Inngest (SDK v4, `/api/inngest`). Actions call `jobs.bookingChanged`
    / `jobs.calendarConnected` in `after()`. Events carry ids and times only (Inngest stores events, step results and
    step errors; errors go through `scrubError`). Functions: `booking-changed` (Google once, then `email-guest` and
    `email-host` as separate steps, in parallel so one can't block the other; a temporary Google failure →
    `calendar-sync` event), `calendar-sync` (8 retries, `onFailure` reports), `calendar-backfill` (on connect, fan-out), `reminder-sweep` (cron every 15 min, 30-min
    horizon) and `reminder-send` (sleeps to the minute, re-reads, sends). `booking-changed` and `calendar-sync`
    share a concurrency key per booking (limit 1); stale emails skip by `sequence`. Emails carry idempotency keys
    (`booking/{id}/{seq}/{audience}`, `reminder/{id}/{kind}/{start}`); Resend's `invalid_idempotent_request` =
    sent. Handlers are plain functions over `steps` (`handlers.ts`), run by Inngest (`functions.ts`) or inline
    (`inline.ts`: no Inngest keys, E2E, or a failed send). Reminders: guests only, a day and an hour before; rules
    in `REMINDERS`; sent ones in `booking_reminders` keyed by (booking, kind, start). Manage token: hash +
    AES-256-GCM copy (`manage_token_encrypted`, key = HKDF of `BETTER_AUTH_SECRET`, booking id as AAD); old
    bookings get it on reschedule, else the reminder points to the first email. Needs runbook step 15 (keys in
    Production only).
  - AI meeting brief (Day 18): `src/server/ai/`. Vercel AI SDK v7 + `@ai-sdk/groq` (free plan), model
    `openai/gpt-oss-120b` (`AI_MODEL`), reasoning "low", Groq strict JSON schema. `writeBrief` = one call
    (`generateText` + `Output.object`, 1 retry, 20 s, 1500 output tokens), never throws; `cleanBrief` strips links,
    emails and 9+-digit runs and caps lengths after the model; `prepareBrief` decides (confirmed → exists → has
    notes/word answers → key set → budget), stores `booking_briefs`, logs `ai_calls` (tokens, ms, outcome, no text).
    In `booking-changed`: host branch = `brief` step then `email-host`; guest branch doesn't wait; created only.
    Host email + Bookings page show it labelled "Written by AI from X's answers". Guest text fenced in
    `<guest_input>` (typed tags removed); only first name, meeting type, notes, answers are sent. Limits
    `ai_brief_host` 40/day, `ai_brief_all` 400/day. Unit tests use `mockModel()` (`src/test/mock-model.ts`);
    evals `npm run eval` (real model, `.env.local` key, not in CI). Needs runbook step 16.
  - Booking assistant, server side (Day 19): `assistant.ts` + `ask.ts`, `askAssistantAction` in the booking page's
    `actions.ts`. Suggest-only: one read-only tool `findTimes {from, to, earliest|null, latest|null, timeZone|null}`;
    `parseSearch` checks and narrows it (real dates/zone, past → today, max 14 days) and code converts with
    `wallTimeToInstant`; slots from `getBookableSlots` (+ cached Google busy), filtered by hour on the searched
    clock. Max 3 searches (`stepCountIs(4)`), 25 s, reply cleaned (`cleanText`, 300 chars), in the guest's language.
    Instructions carry a 14-day calendar with weekdays and "this/next week" (`calendarForModel`). A full window →
    the tool reads 7 more days and `nearestTimes` picks (same hours later, else any hour); no extra model call.
    Shown times = `pickSuggestions` over the last non-empty tool result (3, spread over days/hours), never the
    model's text; host and event type come from the URL. Stateless: one message (2–300 chars) per request. Limits
    `ai_assistant_ip` 10/10 min, `ai_assistant_all` 100/day, `ai_assistant_host` 200/day; `ai_calls` feature
    `booking_assistant`. Tests: `mockModelSteps` (scripted tool calls); 8 evals. No UI yet (Day 20).
- **Numbers:** 614 unit tests + 22 E2E tests + 6 smoke tests + 14 evals; typecheck, lint, format, `drizzle-kit check`
  and build all green. 9 migrations (0000–0008).
- **Live:** <https://meetreadyv2.vercel.app> (Vercel project `meetreadyv2`), demo booking page
  `/sakifazwad18/intro`. Neon project `meetready`, AWS US East 1, Postgres 18; a branch per preview. Set up with
  `docs/deploy.md`.
- **Repo:** `SakifAzwad/MeetReady-V2`. Sakif applies each day from a zip, then commits and pushes. The new chat
  must clone the repo; it can't see the old machine.

## Next (from `docs/backlog.md`)

1. **Sakif:** push Day 19, then `npm run eval` once locally (14 evals).
2. **Day 20: the assistant's UI** on the public booking page (a suggestion selects that time in the widget), a fake
   Groq for E2E (`GROQ_BASE_URL`, like the fake Google), the privacy page (the guest's message goes to Groq).
   **Day 21: MCP server.** Opinions first, as always.
3. Email: Resend's test sender only reaches Sakif's own address until he buys a domain (accepted for now).

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
  - Inngest (SDK v4) for background jobs and reminders: `src/server/jobs/`, served at `/api/inngest`.
  - Vercel AI SDK v7 + Groq (free plan) for AI: `src/server/ai/` (provider chosen only in `index.ts`).
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
  names; both or neither), `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` + `INNGEST_SERVE_ORIGIN` (Production; or `INNGEST_DEV=1`
  locally), `GROQ_API_KEY` (Production; unset = AI off) + optional `AI_MODEL`.
  E2E only: `GOOGLE_CALENDAR_API_URL`, `GOOGLE_REVOKE_URL` (a fake Google on :3101). Local dev uses the Neon `dev` branch, never `production`.

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

- **Background jobs (Day 17):** never put names, emails or tokens in an event or a step's return value (Inngest
  stores them); read them from the database inside the step. Every side effect gets its own step and must be safe
  to run twice. Anything time-based in an email built by a job comes from the event (`at`), not the clock, or a
  retry won't match its idempotency key. Handlers read time through `deps.now()` (tests pass a fixed clock).
- **Inngest locally:** `npx inngest-cli@latest dev` (UI on :8288) and `INNGEST_DEV=1` for the app. Without either,
  jobs run inline. E2E sets the Inngest variables to empty on purpose. The free plan caps a run's life at 30 days
  (sleeps included): don't sleep until a far-off date, sweep instead.
- **AI (Day 18):** the guest's text is untrusted input to the model: fence it, give the model no tools it doesn't
  need, require a schema, and clean the output in code (`cleanBrief`) whatever the prompt says. Never send more
  than the feature needs. AI SDK errors carry the prompt and raw output: report only the kind of failure, through
  `scrubError`. Unit tests never call a model (`mockModel`); behaviour on real models is `npm run eval`. A new AI
  route gets its own lines in `LIMITS` and logs to `ai_calls`.
- **AI tools (Day 19):** the model writes plain dates/hours/zone names; code validates and does the arithmetic.
  Give it a calendar to copy dates from; anything that needs no language (widening a search) is code's.
  What's shown or acted on comes from tool results, never the model's text. Groq free = 8,000 tokens/minute per
  model: evals retry 429s (`src/test/eval-rate-limit.ts`, a few minutes per run); the app doesn't. Fields a model fills under a strict
  schema are required + nullable, never `.optional()`. Tools read; writing stays in our own forms.
