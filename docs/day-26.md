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

## Next

- **You:** unzip, commit and push Part A (migration 0013 runs in the build). Then runbook **step 18**: add a
  webhook.site URL, Send test, book yourself, rotate, delete.
- **Then Part B: the theme switcher** (System / Light / Dark) in the account menu, the landing page footer and the
  booking page.
