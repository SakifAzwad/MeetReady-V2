# Handoff: starting a new chat (after Day 27)

Read this first in a new chat. It replaces the long Days 1–27 conversations. Details live in `docs/day-01.md` …
`docs/day-27.md`; the plan lives in `docs/backlog.md`.

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
    `booking_assistant`. Tests: `mockModelSteps` (scripted tool calls); 8 evals.
  - Booking assistant on the page (Day 20): `assistant-box.tsx` ("Tell us when suits you") at the top of the times
    column, only when `assistantEnabled` and never when rescheduling. A note under it links to `/privacy#booking-assistant`.
    Reply shown as text, "Reply written by AI"; up to 3 suggestion buttons (`aria-pressed`). `pickSuggestion` in the
    widget: `placeInCalendar` → month + day + slot, switches the page's timezone to the one searched ("In London
    time"), goes back from the details step keeping what's typed (`GuestForm` exposes `draft()` via
    `useImperativeHandle`; picking another day keeps it too, a Day 20 fix), focuses the time (`TimeList`
    `focusSlot` → `onFocused`), then re-reads the month (`fetchQuery`, `staleTime: 0`): gone → "Someone just
    booked that time". Late answers for older picks are ignored (`picks` ref). Fake Groq for E2E
    (`e2e/support/fake-groq.mjs`, :3102, `GROQ_BASE_URL`): `fakeGroq.script(marker, { search, reply, fail })`,
    fixed brief for any JSON-schema request, 500 for an unscripted assistant request, `delayMs` for a slow model.
    A Clear button (×, or Escape) empties the box, answer included; a `requests` ref drops answers that arrive
    after Clear or a newer question. The grid's selection is kept.
  - MCP server for AI assistants (Day 21): `src/server/mcp/` + `/api/mcp`. Better Auth 1.7.26 is the OAuth server:
    `jwt({ disableSettingJwtHeader })` + `mcp()` (`@better-auth/mcp`) + `cimd()`; `/token` disabled; scopes
    `bookings:read`, `bookings:write` (granted now, used Day 22), `offline_access`; grants code + refresh only;
    `refreshTokenReuseInterval: 0`. DCR off (`MCP_ALLOW_DCR=1` = read-only self-registration, rate-limited).
    Discovery at `/.well-known/[...path]` → `auth.handler`. Consent page `/oauth/consent` (signed query; CIMD domain
    shown as verified, name not). Login page doesn't redirect when `sig` is present; `authClient` has
    `oauthProviderClient()`. Route: `requireMcpAuth` (audience = `mcpUrl(BETTER_AUTH_URL)`, requires read,
    challenge asks all 3 scopes so clients get a refresh token) → `hasConsent` (Disconnect is immediate) → SDK v2
    `createMcpHandler` (default legacy = stateless: 2025-era clients still served; POST only). Tools (plain
    functions in `tools.ts`, registered in `server.ts` via `runTool`: scope, `mcp_host` 120/10 min, errors as
    `isError`): `list_event_types`, `find_free_times` (Day 19 `parseSearch`, `HH:mm` per day, cap 120),
    `list_bookings` (compact, no notes), `get_booking` (`guestWrote` = guest text, data not instructions).
    Dashboard "AI assistants": address, connected list, Disconnect (`disconnectAssistant`: consent deleted, refresh
    tokens revoked). Migration 0009 (8 tables). E2E `mcp.spec.ts`: pre-registered client linked to the resource
    (`oauth_client_resource`), consent in the browser, PKCE, official `@modelcontextprotocol/client`.
  - Booking over MCP (Day 22): `book_meeting` (scope `bookings:write`) in `tools.ts`: input `date` + `time` +
    `timeZone` (as `find_free_times` gives them) + guest name/email + `guestTimeZone` (null = host's). Checks, then a
    free-time pre-check (cached Google), then the confirm form if `canShowForm` (2026-07-28 era AND the request's
    `io.modelcontextprotocol/clientCapabilities` has `elicitation.form`): `runTool` turns `{ ok: "confirm" }` into
    `inputRequired(...)`; the retried call's answer is read by `confirmationAnswer` (accept + `book: true` only).
    Then `bookLimit` (`mcp_book_host` 20/day + `book_email`), `createBooking(…, { byAssistant: { clientId } })`
    (questions skipped, `source = 'assistant'`, `created_by_client`), `onBooked` → `after()` → `jobs.bookingChanged`.
    Retry: a booking by this host for the same guest + start via an assistant in the last 10 min = `alreadyBooked`.
    Annotations `readOnlyHint: false, openWorldHint: true` (Claude.ai asks in chat; it has no elicitation yet).
    Emails: `scheduledBy` → guest "Scheduled: …" / "Sakif scheduled a meeting with you"; host "Booked through
    Claude: …". Bookings page badge "Booked by you through Claude"; read tools say `bookedBy`. Migration 0010.
    `protocol.test.ts`: real SDK client ↔ our server in-process (client `fetch` → `handler.fetch`), both eras.
  - README for reviewers (Day 23): what it is, live link, six highlights linked to day docs, a Mermaid architecture
    diagram, an AI features table, screenshots and a GIF. Images in `docs/images/`, made by `npm run shots`
    (`playwright.shots.config.ts` → `e2e/shots/readme.shots.ts`: seeds a demo host `sakifazwad18` with bookings, a
    brief and Claude connected, then captures; the GIF is page screenshots in a loop → ffmpeg, no Playwright video).
    Retake after UI changes. `claude.png` is Sakif's own (added after Day 23).
  - Cancel and reschedule over MCP (Day 24): `cancel_booking` + `reschedule_booking` (scope `bookings:write`), for ANY
    of the host's confirmed, not-started bookings (guest-made too). Annotations destructive + idempotent; two tools so
    Claude.ai's per-tool approval can differ. Same pattern as `book_meeting`: checks → pre-check → confirm form
    (`{ ok: "confirm", action }`; one checkbox per action in `CONFIRM_SCHEMAS`, `confirmationAnswer(…, action)`) →
    `changeLimit` (`mcp_change_host` 20/day + `book_email`) → the shared function → `onChanged` → `after()` →
    `jobs.bookingChanged`. Retries: already cancelled → `alreadyCancelled`; already at that start → `alreadyThere`
    (no window needed). Cancel reason through `cleanReason` (= `cleanText`, 500), shown in the confirm message.
    `find_free_times` takes an OPTIONAL `bookingId` (stale cached schemas send none): `excludeBookingId` +
    `subtractInterval` of its own time. Move core: `moveBooking(db, find, newStart, now, options, recordWho)` in
    `manage-booking.ts`, used by `rescheduleBookingByToken` (guest) and `rescheduleBookingAsHost`; host lookups via
    `getHostBookingDetails` (id AND host). Migration 0011: `rescheduled_by` (reuses the `cancelled_by` enum),
    `changed_by_client` (assistant behind the LATEST cancel/move; null when a person did it). Emails: guest "Sakif
    moved your meeting"; host receipt "Moved/Cancelled through Claude: …" only when an assistant did it
    (`audiencesFor`). Bookings labels in `src/lib/booking-labels.ts`. Consent: "Book, move and cancel meetings…";
    dashboard: "Can read, book and change bookings". (The dashboard's Move button came in Day 25 Part B.)
    Follow-up: booked blocks on the week view have a light ring (`ring-1 ring-white/75`), or a meeting after sunset
    is navy on navy.
  - Insights and no-shows (Day 25, Part A): `bookings.no_show_at` (migration 0012) + a check that only a
    confirmed booking can have one; `setNoShow` (host-scoped one UPDATE, only `ends_at <= now`, coalesce keeps the
    first time); "Didn't show up" / "Undo no-show" on Bookings → Past (`setNoShowAction`), no email; `noShow` read-only in
    `list_bookings` / `get_booking`. `/dashboard/insights` (nav item; phones show "Types"/"Hours" short labels,
    full `aria-label`): `src/server/insights.ts` = `insightsPeriod` (pure: Monday weeks / months on the host's
    clock) + `getInsights` (4 grouped queries, `starts_at at time zone $tz`, GROUP BY position because the zone is a
    bound parameter; by MEETING date, up to now; rates: cancelled / all, no-shows / not cancelled, null when 0).
    Charts hand-built in `insights/charts.tsx` (server) + `chart-tooltips.tsx` (client, `data-tip` on marks):
    `--chart-1..3` = one navy, validated as an ordinal ramp in both themes; a table view per chart; today's sky
    strip over the hour grid. README screenshot `insights.png` from seeded history (`history()` in the shots
    script).
  - Move button (Day 25, Part B): "Move" on upcoming bookings → `/dashboard/bookings/[id]/move` (lookup by id AND
    host via `getHostBookingDetails`; notFound otherwise; a reason card when cancelled/started/switched off). The
    booking widget's `reschedule` prop is now a `Mover` (the guest's `{ token }`, or `{ host }` with bookingId,
    guestName and `move`) plus the times; the page's client `MoveWidget` passes `moveBookingAsHostAction` (session,
    Zod, `rescheduleBookingAsHost` with live Google, then `jobs.bookingChanged` rescheduled).
    `/api/slots?move=<uuid>` reads the session only then and frees the booking's own time (and Google event) only
    for its host; anyone else's `move` is ignored. Guest
    email "Sakif moved your meeting", no host receipt (by hand). No rate limit on the action (session-only, like
    Cancel).
  - Signed webhooks (Day 26, Part A): `src/server/webhooks/`. Standard Webhooks headers (`webhook-id` = `msg_…`,
    `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256(key, id.ts.body)>`, several when rotating);
    `whsec_` secrets sealed with `src/server/seal.ts` (label `meetready/webhook-secret/v1`, endpoint id as AAD; the
    manage token uses the same helper). Tables `webhook_endpoints` (events = enum array, previous secret + expiry
    for a 24 h rotation overlap) and `webhook_deliveries` (payload jsonb, `dedupe_key` endpoint:booking:sequence,
    status pending/delivered/failed, attempts, last code/error). booking-changed runs a `webhooks` step beside the
    emails: `queueBookingDeliveries` (idempotent) → `webhook/deliver { deliveryId }` per row. `webhook-deliver`
    (8 retries; `attempt >= WEBHOOK_RETRIES` = final): 2xx delivered; 5xx/408/429/timeout retry (throws in the
    step); other 4xx, 3xx, blocked address = failed. Inline = one try, failure recorded. `webhook-cleanup` cron
    `23 3 * * *` deletes rows older than 30 days. SSRF: `checkWebhookUrl` (https, 443, no creds, no local names,
    IP literals public) + `resolvesPublicly` on save; `publicOnlyLookup` in an undici Agent on every connection
    (`transport.ts`: no redirects, 10 s, 1 KB kept). `WEBHOOK_ALLOW_PRIVATE` = E2E only (fake receiver
    `e2e/support/fake-webhooks.mjs` on 127.0.0.1:3103). Page `/dashboard/webhooks` (account menu): add (≤ 5),
    secret once, Send test / Retry (`webhook_send_host` 20/10 min), Rotate, Delete, last 20 deliveries with
    payload. Payload: times, type, location, meetUrl, guest name/email/tz, changedBy, throughAssistant; never
    notes, answers or a cancel reason. Receiver guide: `docs/webhooks.md`; runbook step 18.
  - Theme switcher (Day 26, Part B): System / Light / Dark. `src/lib/theme.ts` = choices, `THEME_COLORS`, and
    `THEME_SCRIPT` (inline in `<head>` from `layout.tsx`, `suppressHydrationWarning` on `<html>`): a saved
    `"light"`/`"dark"` in localStorage key `theme` → `data-theme` on `<html>` before first paint, theme-color
    metas updated on DOMContentLoaded. System = no attribute, nothing saved; CSS follows the device.
    `globals.css`: `@custom-variant dark` (`[data-theme=dark]` or, with no attribute, the media query); dark
    variables written once in `:root { @variant dark { … } }`; `color-scheme` per theme. Controls in
    `src/components/theme/theme-controls.tsx` (store = `useSyncExternalStore`, server snapshot "system", `storage`
    event for other tabs): `ThemeMenuItems` (account menu, stays open), `ThemeButtons` (landing footer,
    `aria-pressed`), `ThemeMenuButton` (beside `PoweredBy` on public pages, non-modal menu).
  - Booking widget for other websites (Day 27): `public/embed.js` (plain JS, no deps; guide `docs/embed.md`) mounts
    `[data-meetready-inline="user/slug"]` (also added later: `MutationObserver`) and turns clicks on
    `[data-meetready-popup]` links into a native `<dialog>`; both iframe `/embed/{username}/{slug}`
    (`src/app/embed/…`: same `BookingWidget`, `EmbedRoot` + `EmbedWidget` in `embed-client.tsx`). MeetReady's origin =
    the script's own `src`. Headers in `src/lib/security-headers.ts`: two non-overlapping rules, `/embed/*` =
    `frame-ancestors *` and no XFO, everything else deny (test via Next's `getPathMatch`). Messages
    (`src/lib/embed.ts`, `{ source: "meetready", version: 1, type }`): `resize` (height of `[data-embed-root]`,
    clamped 120–4000), `booked` (username, slug, start, end: never guest details; DOM event `meetready:booked`),
    `escape` (unused Escape inside the frame closes the popup). embed.js checks origin AND that `event.source` is
    one of its frames. Theme: `?theme=dark|system`, light default, read by `THEME_SCRIPT` on `/embed/` paths, never
    storage; embed.js sets the iframe's `color-scheme` to match (else an opaque box). Popup keeps its frame after
    a close, fresh after a booking; link fallback without JS. Dashboard: `EmbedDialog` (Radix Dialog + Tabs) on
    each event type card. `embed` reserved + in `APP_ROUTES`; `proxy.ts` gives `/embed/u/s` the same real 404.
    E2E: `e2e/support/fake-site.mjs` on 127.0.0.1:3104 (a different site from localhost).
- **Numbers:** 793 unit tests + 50 E2E tests + 6 smoke tests + 14 evals (14/14 on Groq, Sakif's `eval.log`,
  18 Nov); typecheck, lint, format, `drizzle-kit check` and build all green. 14 migrations (0000–0013).
- **Live:** <https://meetreadyv2.vercel.app> (Vercel project `meetreadyv2`), demo booking page
  `/sakifazwad18/intro`. Neon project `meetready`, AWS US East 1, Postgres 18; a branch per preview. Set up with
  `docs/deploy.md`.
- **Repo:** `SakifAzwad/MeetReady-V2`. Sakif applies each day from a zip, then commits and pushes. The new chat
  must clone the repo; it can't see the old machine.

## Next (from `docs/backlog.md`)

1. **Sakif:** push Day 27 (no migration), then runbook step 20 (CodePen, then the portfolio); send the
   portfolio URL for the README.
2. **Next day: Sakif picks from `docs/backlog.md`.** Phase 2 is complete. Candidates: the 5-minute slot hold, round-robin
   team scheduling (Phase 3, several days), or the domain day once he buys one (setup, emails to every guest,
   Google verification, then the Claude Connectors Directory). Opinions first, as always.
3. Email: Resend's test sender only reaches Sakif's own address until he buys a domain (planned).

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
  (`service postgresql start`; if E2E says "password authentication failed", set it once:
  `su postgres -c "psql -c \"alter user postgres password 'postgres';\""`).

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
  - MCP (Day 21): `@modelcontextprotocol/server` v2 (`@modelcontextprotocol/client` in E2E only); OAuth from Better
    Auth's `@better-auth/mcp` + `@better-auth/cimd` (all `@better-auth/*` at the same version as `better-auth`).
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
  Optional `MCP_ALLOW_DCR=1` (Day 21; off = CIMD only).
  E2E only: `GOOGLE_CALENDAR_API_URL`, `GOOGLE_REVOKE_URL` (a fake Google on :3101), `GROQ_BASE_URL` (a fake Groq
  on :3102; E2E sets `GROQ_API_KEY` to a placeholder, so AI is on there). Local dev uses the Neon `dev` branch, never `production`.

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
  day. The booking page opens on today, which runs out of times late in the host's day: E2E picks a day with
  `openRoomyDay` (≥ 4 free times), also when rescheduling (Day 23 story: CI failed at 3 PM Dhaka). Use exact role names (`exact: true`): accessible names like "Move question 1 up" contain "Question".
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
- **AI in E2E (Day 20):** AI is ON in E2E (fake Groq), so every booking with notes gets the fake's fixed brief. An
  assistant test scripts the fake with a random marker in the guest's message; the tool and database stay real.
  The assistant searches 14 days from the server's real clock, so its specs pick a weekday 8–10 days ahead
  (the one exception to "pick a fixed day").
- **Before claiming existing behaviour, read it, and make a new test fail once on the old code** (Day 20 story).
- **MCP / OAuth (Day 21):** the host is the token's subject; tools take no user id. Guest-written text reaches the
  host's assistant: return it labelled (`guestWrote`). JWT access tokens can't be revoked by themselves: the route
  checks the consent. A new OAuth client in tests must be linked to the resource (`invalid_target` otherwise).
  Playwright's `page.route` doesn't catch HTTP redirects: read a 302's `Location` with `maxRedirects: 0`. Check
  what real clients speak before following a library's strict setting (`legacy: "reject"`).
- **MCP protocol versions (Day 22):** the SDK's `Client` defaults to `versionNegotiation: 'legacy'` (2025-11-25).
  Elicitation forms (`inputRequired`) exist only on 2026-07-28: pin `{ mode: { pin: "2026-07-28" } }` in tests that
  need them. Check the negotiated version before debugging a feature that exists in one version only. A write tool
  called by an AI will be retried: design the "already done" answer.
- **New MCP tools don't appear in Claude by themselves** (Day 22, after deploy): Claude caches a connector's tool
  list (instructions are re-read). Refresh or reconnect the connector, then a new chat. Runbook troubleshooting.
- **A tool's input schema is a public API** (Day 24): a new REQUIRED field breaks every call from a client holding
  the cached old schema. Fields added later are optional (`nullish`); the "required + nullable" rule is for
  schemas sent to a model under strict mode (Groq), not for MCP fields added after release.
- **"Latest change" columns** (Day 24): `changed_by_client` describes only the latest cancel or move. Emails are
  safe (they read the row at the change's `sequence`); anything else must ask which change was the latest
  (`booking-labels.ts`).
- **"X doesn't block Y" tests need X to OVERLAP Y** (Day 24 story): adjacent isn't overlapping, and a start that
  isn't on the slot interval fails for the wrong reason. Remove the code under test once and watch the test fail.
- **GROUP BY with bound parameters** (Day 25 story): the same expression in SELECT and GROUP BY becomes two
  parameters, and Postgres refuses it ("must appear in the GROUP BY clause"). Group by position.
- **Charts** (Day 25): colour means time of day, so data marks are steps of one navy (`--chart-1..3`), checked with
  the dataviz validator in `--ordinal` mode, both themes. A legend, a table view and tooltips on focus too; no
  chart library.
- **Shared components with a second caller** (Day 25 story): pass the difference in (the widget's `Mover`), don't
  import the caller's code into the shared component.
- **Validate where the action happens** (Day 26): SSRF checks at save time AND inside the HTTP client's DNS lookup
  (rebinding). Never follow redirects from a URL a user typed.
- **"After reload, count = 0" can pass on a page that hasn't rendered yet** (Day 26 story): wait for the element
  (`toBeVisible` in a `toPass` loop), and check "gone" with something positive that should be there instead.
- **Theme (Day 26):** never read the theme on the server (it's in localStorage). Dark styles use the `dark:`
  variant or the variables, never `@media (prefers-color-scheme)` directly, or an explicit Light/Dark choice won't
  apply. A test that opens a menu on a streaming page waits for the content above it first (Day 26 story).
- **Secret scanning (Day 26 story):** `whsec_…` in `signing.test.ts` is the spec's public test vector. GitHub flags
  it as a Stripe secret; close such alerts as "Used in tests". Never commit a real one.
- **Embeds (Day 27):** a new page that other sites may frame needs its own header rule (rules add headers, never
  remove them). Never put private data in a `postMessage` from a frame (any site can embed). Inside a frame,
  measure your own box, not the document (body's min-height = the iframe), keys never reach the parent, and
  links must open in a new tab (our other pages refuse framing). Test from another SITE (127.0.0.1 vs localhost).
- **`eval.log` is committed** (Sakif's eval output). Fine as evidence; regenerate it rather than editing it.
