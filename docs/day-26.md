# Day 26: Signed webhooks (Part A) and a theme switcher (Part B)

## Part A: signed webhooks

**Result:**

- **Hosts can add webhook endpoints** (Dashboard → account menu → **Webhooks**, up to 5). MeetReady POSTs to them
  when a booking is made, moved or cancelled (`booking.created`, `booking.rescheduled`, `booking.cancelled`), with
  a **Send test** (`ping`).
- **Every request is signed in the Standard Webhooks format** (`webhook-id`, `webhook-timestamp`,
  `webhook-signature: v1,<HMAC-SHA256>`), so receivers verify with an existing library. Our signing reproduces the
  example published with the spec, byte for byte.
- **Retries:** 5xx, 408, 429 and timeouts are retried by a new Inngest function, `webhook-deliver` (8 retries with
  growing gaps), always with the same `webhook-id` and body. Other 4xx and redirects fail for good. After the last
  try, **Retry** on the page sends the same message again.
- **SSRF protection, twice:** when saved (https, port 443, no credentials, no local names, every DNS answer
  public) and when each delivery connects (the same address check inside the HTTP client's DNS lookup, so DNS
  rebinding can't get through). Redirects aren't followed; 10-second timeout; only 1 KB of the answer is kept.
- **Secrets:** `whsec_…`, shown once, stored encrypted (not hashed: we must sign with it). **Rotate secret** keeps
  the old one signing for 24 hours too (two signatures in the header), so receivers switch without downtime.
- **The page shows what was sent:** the last 20 deliveries with status, code, tries, the reason, and the payload.
  Delivery rows (they hold guests' names and emails) are deleted after 30 days by a daily job, `webhook-cleanup`.
- **Payload:** the booking's times, meeting type, location, Meet link, the guest's name, email and timezone, and
  who made the change. Never the guest's notes, answers or a cancellation reason.
- **Tests:** 767 unit tests (29 new) and 41 E2E tests (2 new; the main one: add an endpoint, a guest
  books, the fake receiver checks the signature with plain `node:crypto`, then test, a failing receiver and Retry,
  a rotation with two signatures, Delete). The new spec passed 3 times in a row. Typecheck, lint, format,
  `drizzle-kit check` and the build are green.
- **Setup:** none in Vercel. Migration 0013 runs in the build. Then runbook **step 18** (try it with
  webhook.site). New dependency: `undici` (the HTTP client with a pluggable DNS lookup).

```
src/server/webhooks/signing.ts      # Standard Webhooks: secrets, message ids, sign, verify (spec example as a test)
src/server/webhooks/address.ts      # SSRF: URL rules, DNS check on save, publicOnlyLookup for every connection
src/server/webhooks/transport.ts    # undici fetch: guarded lookup, no redirects, 10 s, 1 KB kept
src/server/webhooks/deliveries.ts   # payload, queue (idempotent), one attempt and its outcome, 30-day clean-up
src/server/webhooks/endpoints.ts    # host-scoped: create (checks), delete, rotate, ping, retry, lists
src/server/seal.ts                  # Day 17's AES-GCM sealing, shared (manage tokens and webhook secrets)
src/server/jobs/                    # booking-changed queues deliveries; webhook-deliver; webhook-cleanup (cron)
src/db/schema.ts, drizzle/0013_*    # webhook_endpoints, webhook_deliveries
src/app/(app)/dashboard/webhooks/   # the page, its controls and actions (send/retry rate-limited)
docs/webhooks.md                    # for receivers: events, payload, headers, a 10-line verify, retry rules
e2e/webhooks.spec.ts, e2e/support/fake-webhooks.mjs
```

### 1. Decisions (Sakif's picks, from the options proposed)

#### The Standard Webhooks format, not our own

- The same headers and signing scheme as Svix, Resend and others, so a receiver can use the `standardwebhooks`
  library, or the 10 lines in `docs/webhooks.md`. A made-up scheme would mean every receiver trusts our docs and
  our edge cases. A unit test pins the spec's published example.
- **HMAC with a shared secret, not public-key signatures.** The spec also allows Ed25519 (`v1a`), which lets anyone
  verify without a secret. A shared secret is simpler for the host to handle, and it's what the tools hosts
  connect (Zapier, a small server) expect.

#### The payload lives in our database; Inngest carries ids

- The booking-changed job writes one `webhook_deliveries` row per subscribed endpoint (payload included), then
  sends one `webhook/deliver { deliveryId }` per row. Inngest stores events and step results, so it never sees a
  guest's name or email (the Day 17 rule), and every retry sends exactly the same bytes.
- **Idempotent queuing:** a unique `dedupe_key` (endpoint + booking + sequence) makes a retried job step insert
  nothing new and return the same ids. Each delivery event has its own id, so Inngest drops a duplicate send.
- **Side by side with the emails**, in the same job: a slow receiver never delays a guest's email, and a failing
  email never stops a webhook. The sending itself is a separate function with its own retries.
- **Fixed when queued:** the payload is the booking as it was a moment after the change. Two quick changes give
  two events, each describing the booking at its time.

#### Retry rules

- **Retried:** 5xx, 408, 429, timeouts, connection errors, with Inngest's growing gaps, 8 retries. The retry's
  timestamp and signature are new; the `webhook-id` and body are not, so a receiver can drop duplicates.
- **Not retried:** other 4xx (it won't change by itself), 3xx (redirects aren't followed), and an address that
  turns out to be private.
- **Inline mode** (local dev, E2E, an Inngest outage) gives one try; a failure is recorded as failed, so nothing
  stays "pending" forever, and the host's Retry is the second try.

#### SSRF: check when saved, and again at connect time

- **When saved:** https on port 443, no username or password, no IP literal on a private range, no local names
  (`localhost`, `*.internal`, `*.local`), and every address the name resolves to is public. Blocked ranges
  include private networks, loopback, link-local (and so the cloud metadata address 169.254.169.254), CGNAT,
  multicast, documentation ranges, IPv6 unique-local and link-local, and IPv4 hidden inside IPv6 (mapped, NAT64).
  Node's `net.BlockList` does the matching.
- **On every delivery:** the HTTP client (undici) gets a `lookup` that resolves the name, refuses if any address
  is private, and only then hands the addresses to the socket. The check is on the address actually connected
  to, so DNS rebinding (public when saved, 127.0.0.1 a minute later) fails. A unit test proves it: with a
  resolver that answers 127.0.0.1, the request is refused and the local server receives nothing.
- **No redirects** (a 302 to the metadata service would walk around both checks), **10 seconds**, **1 KB** of the
  answer kept (enough to show the host an error message, not enough to fill the database).
- **E2E's exception:** `WEBHOOK_ALLOW_PRIVATE` lets the fake receiver on 127.0.0.1 through. E2E sets it in
  `playwright.config.ts`; the runbook says never to set it on Vercel.

#### Secrets

- 32 random bytes, `whsec_` + base64 (the spec's format). Shown once. Stored encrypted with the Day 17 scheme
  (AES-256-GCM, a key derived from `BETTER_AUTH_SECRET` with its own label, the endpoint id as associated data).
  It can't be hashed: we sign with it.
- **That scheme is now shared** (`src/server/seal.ts`); the manage token uses it with its old label, so values
  already in the database still open.
- **Rotation with a 24-hour overlap:** the current sealed value moves to `previous_secret_encrypted` as it is
  (sealed for the same endpoint id, so it still opens), and both sign until the overlap ends. A check constraint
  keeps "previous secret" and "until when" together.

#### The page and its limits

- **In the account menu, not the main nav:** a developer setting, and the nav is full on phones.
- **Up to 5 endpoints** per host. **Send test** and **Retry** share a limit (`webhook_send_host`, 20 per 10
  minutes): each makes our server POST to a URL the host chose.
- Every query is scoped to the host; another host's endpoint or delivery id looks missing (tests for each).

#### Not now (backlog)

- Auto-disabling an endpoint that fails for days (as Stripe does); editing an endpoint's events (delete and add
  for now); a per-host cap on concurrent deliveries; an option to include notes and answers.

### 2. Likely interview questions

- **"How does a receiver know a webhook is really from you?"** An HMAC-SHA256 signature over the message id, a
  timestamp and the raw body, keyed with a secret only the two of us know. The timestamp stops replays (receivers
  reject anything older than 5 minutes); the id lets them drop duplicates from retries.
- **"What's SSRF, and how do you stop it here?"** Server-side request forgery: making our server send requests to
  places only it can reach (an internal admin page, the cloud metadata service). Checking the URL when it's saved
  isn't enough, because DNS can change: the same check runs inside the HTTP client on the address it actually
  connects to, redirects aren't followed, and there's a timeout.
- **"Why store the payload instead of rebuilding it on each retry?"** The same bytes and id on every try (the
  receiver's deduplication depends on it), a record the host can read, and Inngest never holds guest data.
- **"Why is the secret encrypted, not hashed like the manage token?"** Hash what you only check; encrypt what you
  must use again. We need the secret itself to sign each request.
- **"How do you rotate a secret without breaking the receiver?"** Sign with both for 24 hours. Standard Webhooks
  allows several signatures in the header; the receiver accepts any of them while it switches.

### 3. Stories (problems hit and how they were solved)

#### A check that ran before the page was there

- **What happened:** the browser test passed twice, then failed on the third of three repeats, the same way each
  time: it reloaded the Webhooks page and counted Retry buttons, expecting 1, and got 0. The screenshot showed
  "Last delivery failed": the app was right. The count ran right after `reload()`, before the page's streamed
  section had rendered.
- **What I did:** the test now waits for the button itself (`toBeVisible`) inside a reload-and-retry loop. The
  check after Retry had the same race the other way round ("no Retry buttons" passes on an empty page), so it
  now waits for something positive: three "Delivered (200)" badges.
- **Lesson:** the Day 16 rule again, in a new form: an assertion that can pass on nothing proves nothing. Wait
  for the thing you expect, and for "it's gone", check what should be there instead.

#### A concurrency key that limited nothing

- **What happened:** writing `webhook-deliver`, I added `concurrency: { key: "event.data.deliveryId", limit: 1 }`
  with a comment saying it kept a busy day from flooding one host's server. Rereading it before testing: the key
  is the delivery id, so it limits each delivery to one run at a time, which the event id already guarantees.
  It did nothing it claimed to.
- **What I did:** removed it. A real per-host limit needs the host (or endpoint) id in the event; that's in the
  backlog, with a note on why it isn't needed at this size.
- **Lesson:** a comment that describes intent has to match what the code does. A concurrency key limits runs
  that share its value; ask what that value is.

#### A secret scanner that found our test vector

- **What happened:** after pushing Part A, GitHub emailed "Secrets detected: Stripe Webhook Signing Secret" in
  `signing.test.ts`, line 9.
- **What I did:** read it before acting. It was `whsec_MfKQ…`, the example secret printed in the Standard
  Webhooks spec, used by the unit test that pins our signatures to the spec's published result. It was never
  anyone's secret: real ones are random per endpoint, shown once and stored encrypted. Searched the repo for
  other `whsec_` values (none). The right close is "Used in tests", with a note saying it's the spec's
  public example. Not splitting the string to slip past the scanner: that would teach the repo to dodge its own
  alarm.
- **Lesson:** a scanner matches shapes (`whsec_` + base64 is also Stripe's format). Check what the value is and
  where it came from, then close the alert with the reason, so the next person reads why.

## Part B: a theme switcher

**Result:**

- **System, Light or Dark**, chosen in three places: the dashboard's account menu (a **Theme** group), the
  landing page footer (three buttons), and a small icon button beside "Scheduling by MeetReady" on every public
  page (booking page, host profile, a guest's booking). **System** is the default and follows the device, live.
- **No flash of the wrong theme:** a saved choice is on the first paint, even on static pages, because a few
  lines in `<head>` apply it before the body is parsed. A browser test proves it with every Next.js script file
  blocked: the page still comes up dark.
- **One rule for every dark style:** the dark variables and Tailwind's `dark:` utilities use one custom variant,
  so they can't disagree. Native parts (scrollbars, form controls) follow too (`color-scheme`), and so does the
  phone's toolbar colour (`theme-color`).
- **Tests:** 771 unit tests (4 new: the head script run against a fake page) and 44 E2E tests (3 new). The new
  spec passed 3 times in a row.
- **Setup:** none. No migration, no new dependency, nothing in Vercel.

```
src/lib/theme.ts                        # the choices, colours, and the head script (a string)
src/components/theme/theme-controls.tsx # the store (useSyncExternalStore) and the three controls
src/app/globals.css                     # @custom-variant dark; dark variables via @variant dark; color-scheme
src/app/layout.tsx                      # the head script; suppressHydrationWarning on <html>
src/app/(app)/dashboard/account-menu.tsx, src/components/site/{site-footer,powered-by}.tsx
e2e/theme.spec.ts
```

### 1. Decisions

#### Where the choice lives: the browser

- **localStorage, not the database:** the booking page has no login, and a guest's theme belongs to their
  screen, not to an account. A host on two devices may well want two themes.
- **Not a cookie:** the server would have to read it to render the right colours, and reading a cookie makes a
  page dynamic. The landing page and every static shell would lose their prerendering for a colour preference.
- **The cost of the browser:** the server can't know the choice, so something must apply it before the first
  paint. That's the head script.

#### Only an explicit choice touches the page

- **System = no attribute and nothing saved.** Then the CSS follows `prefers-color-scheme` by itself: it works
  with JavaScript off, and the page changes live when the device switches at sunset, with no listener.
- **Light or Dark = `data-theme` on `<html>`**, and that beats the device. The alternative (the script always
  writes the resolved theme) needs a `matchMedia` listener to stay live, and a page without JavaScript would
  have no dark mode at all.

#### The head script

- **Inline in `<head>`, before the body:** an external file would be fetched after the first paint could
  start. It's under 400 bytes of ES5 (no imports, nothing to bundle), wrapped in `try`: localStorage throws in
  some private modes and sandboxed frames, and then the page follows the device.
- **It only accepts `"light"` or `"dark"`.** Anything else in storage (hand-edited, or junk) is ignored, never
  written into the page. Unit tests run the string against a fake page: valid, junk, blocked storage.
- **`suppressHydrationWarning` on `<html>`:** the script may add `data-theme` before React hydrates, and React
  would otherwise warn that the server's HTML differs. It covers that element's own attributes only.
- **`useSyncExternalStore` for the controls:** the server renders "System" (it can't know), hydration matches,
  and React re-renders with the saved value right after. Only which option is marked changes; the colours were
  already right. The same store hears other tabs (`storage` event), so two tabs don't drift apart.

#### One dark rule

- **`@custom-variant dark`** in `globals.css`: `[data-theme=dark]` and its children, or, when there's no
  attribute, `prefers-color-scheme: dark`. The dark variables are written once inside `@variant dark { … }`, so
  the explicit and system cases can't drift apart (no copy of the block).
- **Charts and the daylight band** need nothing new: they read the same variables (Day 25's `--chart-*` were
  already chosen for each theme).

#### Placement

- **Account menu, not the main nav:** a setting, and the nav is full on phones. The menu stays open after a
  choice, so a host can try each one.
- **Footer of the landing page:** where people look for it on a marketing page, three labelled buttons.
- **Public pages:** one quiet icon beside the MeetReady credit, so it's on every page a guest (or a reviewer)
  sees, without competing with the booking card. Its menu isn't modal: three options shouldn't lock scrolling.

#### Not now

- Per-page or per-host defaults ("my booking page is always dark"): a host setting on the public page would
  override the guest's own preference, which is backwards for an accessibility setting.

### 2. Likely interview questions

- **"How do you avoid the flash of the wrong theme?"** The choice is in localStorage, which the server can't
  read, so a small blocking script in `<head>` sets `data-theme` before the body is parsed. It's the one place an
  inline blocking script is worth it.
- **"Why not a cookie, so the server renders it?"** Then every page that shows colours would read a cookie and
  stop being static. Trading prerendering for a colour preference is a bad deal.
- **"What does `suppressHydrationWarning` hide?"** Only differences in that one element's attributes, which the
  head script changes on purpose. Mismatches anywhere inside still warn (and fail the E2E console check).
- **"How do System and an explicit choice coexist in CSS?"** One custom variant: the attribute wins; without
  it, the media query applies. System needs no JavaScript.

### 3. Stories

#### A menu that opened before the page finished arriving

- **What happened:** the new browser test went to the booking page and clicked the theme button at its foot.
  The menu opened, but clicking "Light" timed out: "element is outside of the viewport", retried for 30
  seconds.
- **What I did:** measured where the menu opened in a scratch test (it fit on screen when the page was loaded),
  then looked at timing. The booking card streams in above the button: the click landed while the card was
  still a skeleton, then the card arrived and pushed the button, and its open menu, off screen. The test now
  waits for the card's heading first. I also made that menu non-modal, so it never locks scrolling, then removed
  the wait once to check: still failed 1 time in 3, so the wait is the fix and non-modal is a nicety.
- **Lesson:** on a streaming page, "visible" isn't "settled". Wait for the content that moves things, and
  check which of two changes actually fixed it by taking one away.

## Next

- **You:** unzip, commit and push Part B (no migration). Then runbook **step 19**: two minutes in a browser.
- **Then:** the embeddable booking widget (the last Phase 2 item), or the domain day once you buy one.
