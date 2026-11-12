# Handoff: starting a new chat (after Day 12)

Read this first in a new chat. It replaces the long Days 1–12 conversations. Details live in `docs/day-01.md` …
`docs/day-12.md`; the plan lives in `docs/backlog.md`.

## Where things stand

- **Built (Days 1–12):**
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
- **Numbers:** 384 unit tests + 13 E2E tests + 6 smoke tests; typecheck, lint, format, `drizzle-kit check` and
  build all green. 5 migrations (0000–0004).
- **Live:** <https://meetreadyv2.vercel.app> (Vercel project `meetreadyv2`), demo booking page
  `/sakifazwad18/intro`. Neon project `meetready`, AWS US East 1, Postgres 18; a branch per preview. Set up with
  `docs/deploy.md`.
- **Repo:** `SakifAzwad/MeetReady-V2`. Sakif applies each day from a zip, then commits and pushes. The new chat
  must clone the repo; it can't see the old machine.

## Next (from `docs/backlog.md`)

1. Confirm the smoke workflow passes on <https://meetreadyv2.vercel.app> (GitHub variables `PRODUCTION_URL`,
   `DEMO_BOOKING_PATH`).
2. **Sentry** (Sakif asked to do it as its own step after the deploy), then rate limiting, Google Calendar sync,
   reminders, AI features.
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

## Stack and commands

- **Stack:**
  - Next.js 16.4 (App Router, Cache Components, `proxy.ts`), React 19.3, TypeScript strict
    (`noUncheckedIndexedAccess`).
  - Zod 4, React Hook Form; TanStack Query only in the booking widget.
  - Drizzle ORM with `casing: "snake_case"`; Neon in production, `pg` locally.
  - Better Auth (Google, database sessions).
  - React Email + Resend; with no `RESEND_API_KEY`, emails go to a dev outbox folder.
  - Tailwind 4, Radix, self-hosted Bricolage Grotesque and Figtree.
- **Commands:** `npm test` (PGlite; set `TEST_DATABASE_URL` to also run the race tests on real Postgres),
  `npm run test:e2e` (Playwright; needs Postgres on :5432, wipes `meetready_e2e`; `E2E_SKIP_BUILD=1`,
  `E2E_BROWSER_CHANNEL=chrome`),
  `npm run typecheck`, `lint`, `format:check`, `npx drizzle-kit check`, `npm run build`. CI runs the same, with a
  Postgres 18 service (same major version as Neon). Smoke tests against a live URL:
  `SMOKE_URL=https://… npx playwright test --config playwright.smoke.config.ts`.
- **Env** (`.env.example` holds names only, never values): `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED` for
  migrations), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (derived on Vercel), `GOOGLE_CLIENT_ID/SECRET`, optional
  `RESEND_API_KEY`, `EMAIL_FROM`, `DEMO_BOOKING_PATH`. Local dev uses the Neon `dev` branch, never `production`.

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
- **Env files:** `KEY=` arrives as `""`, not missing. Optional env vars use `emptyAsUnset`.
- **Browser scripts:** use `locale: "en-US"` when checking AM/PM text. Don't depend on "today"; pick a fixed
  day. Use exact role names (`exact: true`): accessible names like "Move question 1 up" contain "Question".
  Empty the email outbox at the start.
