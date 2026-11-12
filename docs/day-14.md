# Day 14: Rate limiting

**Result:**

- **Rate limits on every public entry point:** booking, guest cancel/reschedule, the slots API, and the
  username lookup in `proxy.ts`. They're keyed by the thing being abused, not only by IP.
- **Upstash Redis in production** (sliding window, atomic in one Lua script). **The same algorithm in memory** for
  local dev and tests, behind one interface.
- **Fails open:** if Redis is down or slow, requests go through and the failure is reported to Sentry, at most
  once every 5 minutes per instance.
- **What a refused visitor sees:**
  - on the booking, reschedule and cancel forms: "Too many attempts. Please try again in N minutes." Everything
    they typed is kept;
  - from the API: `429` with `Retry-After`.
- **Privacy:** no IP, email or manage token is stored in Redis, only keyed hashes (HMAC).
- **Tests:** 423 unit tests (29 new) and 15 E2E tests (2 new; both run 3 times in a row with no flakes).
  Typecheck, lint, format, `drizzle-kit check` and the build are green. Also checked by hand with `curl`: the
  121st page lookup in a minute gets `429`, another IP still gets `404`, and `/login` is never limited.
- **Setup:** `npm install` (two new dependencies: `@upstash/ratelimit`, `@upstash/redis`). No migration.
  Production needs runbook step 11 ([deploy.md](deploy.md)); until then it falls back to per-instance memory
  limits and logs a warning.

```
src/server/rate-limit/limits.ts     # the limits, the in-memory sliding window, checkAll, failOpen
src/server/rate-limit/upstash.ts    # Upstash adapter: one Ratelimit per policy, 1 s timeout → error
src/server/rate-limit/identity.ts   # client IP, IPv6 /64 buckets, email buckets (+tags, Gmail dots), HMAC keys
src/server/rate-limit/index.ts      # rateLimit(): picks Upstash or memory, hashes identifiers; 429 helper
src/server/rate-limit/*.test.ts     # 26 tests with a fake clock and a stubbed Upstash
src/lib/env-schema.ts               # REDIS: Upstash's or Vercel's variable names, both or neither
src/lib/rate-limit-text.ts          # "Too many attempts. Please try again in N minutes."
[username]/[slug]/actions.ts        # book: per IP first, then per guest email
booking/[token]/actions.ts          # cancel + reschedule: per manage token
api/slots/route.ts                  # per IP, 429 + Retry-After
proxy.ts                            # per IP, only on the username lookup branch
steps.tsx, manage-booking.tsx, booking-widget.tsx   # the friendly message; no retry storm on 429
e2e/fixtures.ts, e2e/rate-limit.spec.ts             # an IP per visitor; the 6th booking is refused
```

## 1. Decisions

### The limits

| Limit        | Counts                   | Allowed          | Stops                                                     |
| ------------ | ------------------------ | ---------------- | --------------------------------------------------------- |
| `book_ip`    | booking attempts per IP  | 5 per 10 minutes | a script filling a host's calendar                        |
| `book_email` | bookings per guest inbox | 3 per hour       | email-bombing one person with confirmations from many IPs |
| `manage`     | changes per manage token | 10 per hour      | a leaked link flooding the host with cancel/move emails   |
| `slots`      | slots API calls per IP   | 60 per minute    | hammering the most expensive read                         |
| `pages`      | username lookups per IP  | 120 per minute   | walking usernames to see who exists (404 or not)          |

- **Why per email as well as per IP:** the IP limit can't see one victim targeted from a hundred IPs. The email
  limit can.
- **Why per token for cancel and reschedule:** that's the thing being abused. Guessing a token isn't a risk:
  it's 256 random bits.
- **The booking IP limit counts every attempt,** even malformed ones, and runs before any parsing or database
  work. The email limit runs after parsing, once there's a valid email to count.
- **Checks stop at the first refusal** (`checkAll`), so a request refused by its IP doesn't also use up the email's
  allowance.
- **Not limited:** sign-in (Google-only, so Google does the brute-force protection) and the dashboard (signed-in
  hosts only).

### Sliding window, and why that algorithm

- **Fixed window** ("5 per clock 10 minutes"): a burst at 9:59 plus one at 10:00 lets through twice the limit in
  seconds.
- **Sliding log** (keep every timestamp): exact, but memory grows with every request.
- **Sliding window counter** (what's used): two numbers per key, the current window and the previous one. The
  previous one is weighted by how much of it is still inside the last 10 minutes. It assumes the previous window's
  hits were spread evenly, which is close enough for abuse limits.
- **Same algorithm in both stores:** the in-memory version copies Upstash's Lua script, so local behaviour
  matches production, down to the rounding (see the first story).

### Why Upstash Redis

- **Not in memory:** each Vercel instance has its own memory, and a cold start wipes it. Ten instances would mean
  ten times the limit. In-memory is used only locally and in tests.
- **Not Postgres:** it would add a write to every slots call and page lookup, the hottest paths, on the
  database that also has to take bookings.
- **Upstash speaks HTTP:** there's no connection pool to exhaust from serverless functions.
- **It's atomic:** the read, check and increment run as one Lua script. Two requests at once can't both see
  "4 of 5" and both pass. (The same race the booking lock solves, one level down.)
- **The ephemeral cache:** each instance remembers keys it has already refused, and refuses them again without
  calling Redis. A flood from one IP costs no Redis requests, and no free-tier quota.
- **Shared Redis, separate counters:** keys are prefixed with the environment (`meetready:production:book_ip:…`),
  so previews can't use up production's limits.

### Fail open

- **The choice:** if Redis throws or takes over 1 second, the request goes through and the error goes to Sentry,
  at most once every 5 minutes per instance.
- **Why open:** the limits stop abuse, which is rare. Failing closed would turn a Redis outage into "nobody can
  book", which is the whole app. Double bookings can't happen either way: the lock and the `EXCLUDE` constraint
  are in Postgres.
- **When the answer is the opposite:** a login or a payment endpoint, where the limit is the security.
- **Upstash's own timeout is "allow, silently":** by default it waits 5 seconds, then lets the request through.
  The adapter sets 1 second and turns that answer into an error, so a slow Redis is reported like a broken one.

### Identifying the visitor

- **The IP comes from `x-forwarded-for`.** Vercel writes that header itself and overwrites whatever the client
  sent, so in production it can't be spoofed.
  - Off Vercel (local dev, CI), it's whatever arrives. That's what lets each E2E test act as its own visitor.
  - Behind any other host or proxy, `clientIp()` is the one function to revisit.
- **IPv6 is counted per /64,** not per address. One home or phone usually gets a whole /64 (2^64 addresses), so a
  per-address limit would be free to dodge.
- **Email is counted per inbox:** `ada+1@…` and `ada+2@…` reach the same inbox, so they count as one, and Gmail
  ignores dots. Without this, adding `+1` beats the email limit. Only the counting key changes; the booking keeps
  what the guest typed.
- **No raw values in Redis:**
  - Keys are HMAC-SHA256 hashes under a server secret. A plain SHA-256 isn't enough: all 4 billion IPv4
    addresses can be hashed in seconds, and emails can be guessed.
  - The HMAC key is derived from the auth secret with a label, not the auth secret itself. The same secret signs
    session cookies, and a hash made for one purpose shouldn't be usable for another.

### What the visitor sees

- **Booking form:** the message appears above the button, and the form stays as it is: name, email, answers,
  notes. Unlike the other failures, it doesn't refetch the times (nothing changed, and the refetch would only
  spend the slots limit).
- **Reschedule and cancel:** the same message in place.
- **Times list (slots API):** "Too many attempts…" instead of "Couldn't load times". The widget stops retrying on
  `429` (TanStack Query retries 3 times by default, which would only extend the wait).
- **API:** `429`, a `Retry-After` header in seconds, and `Cache-Control: no-store`.
- **Proxy:** plain text with `429` and `Retry-After`. A person browsing never gets there (120 pages a minute); a
  script reads the status.
- **"N minutes" is rounded up,** so nobody is told to retry too early. It's the end of the current window: an
  honest upper bound.

## 2. Likely interview questions

- **"Why not just limit by IP?"** IP limits miss the attack that hurts a person: one victim's inbox flooded from
  many IPs. I key each limit by what's being abused: IP for scripts, inbox for email-bombing, token for the
  manage link.
- **"Why Redis and not in-memory?"** Serverless instances don't share memory, and cold starts wipe it. The limit
  would be per instance. Not Postgres either: it would add writes to the hottest read paths.
- **"What happens when Redis is down?"** It fails open: requests go through, and Sentry hears about it once,
  not a thousand times. Booking correctness doesn't depend on Redis; that's Postgres's job. For a login endpoint
  I'd fail closed.
- **"Can someone spoof their IP?"** Not on Vercel: it overwrites `x-forwarded-for`. That's a property of the
  host, so the IP code is one function with a comment saying when to revisit it. IPv6 is counted per /64,
  because otherwise a single home has billions of "different" addresses.
- **"Fixed window, sliding log, or sliding window?"** Sliding window counter: no burst at the boundary like a
  fixed window, and constant memory unlike a log. The trade-off is approximation; I tested its real worst case
  (6 in two seconds, not 10).
- **"What's stored about visitors?"** Only HMAC hashes with a server secret, with an expiry. No IPs, no emails,
  no tokens.
- **"How did you test it?"** Unit tests with a fake clock, a stubbed Upstash for the adapter, and E2E: five
  bookings, the sixth refused with the form intact, and another visitor unaffected.

## 3. Stories (problems hit and how they were solved)

### The sliding window let one extra through

- **What happened:** my test said "5 bookings 1 second before the window ends, then 1 second after: refused". It
  was allowed.
- **Why:** the previous window's 5 hits weigh 5 × 599/600 = 4.99, and Upstash's script rounds **down** to 4. So
  one more fits. My in-memory version copies that script, so it did the same.
- **What I did:** kept the algorithm (matching production matters more than a stricter local version), and wrote
  the test for its real guarantee: right after the boundary, exactly one more gets through, then nothing. Worst
  case 6 in two seconds, not 10 like a fixed window.
- **Lesson:** test what the algorithm actually guarantees, not the idealised version you have in your head.

### Every E2E test would have come from the same IP

- **What happened:** before running the suite, I counted. Every Playwright test talks to the server from
  `127.0.0.1`. Across all specs there are more than 5 bookings within 10 minutes, so whichever test came later
  would be refused, depending on order and timing.
- **What I did:** each test, and each guest inside it, sends its own random `x-forwarded-for` (a fixture
  override). Off Vercel the app trusts that header; on Vercel, Vercel overwrites it. Two guests in one test are now
  two visitors, like two people on two laptops.
- **Lesson:** a shared limit is shared state. Tests that share it aren't independent, even if each makes its own
  data.

### "Allowed" was Upstash's answer to a timeout

- **What happened:** reading `@upstash/ratelimit`'s types, `timeout` defaults to 5 seconds. When it's reached,
  the result is `success: true` with `reason: "timeout"`.
- **Why it matters:** a slow Redis would make every booking wait 5 seconds, then pass, and nothing would report it.
- **What I did:** 1 second, and a timeout is turned into an error, so it goes through `failOpen`: still allowed,
  but reported like an outage.
- **Lesson:** a library's "fail open" is still a decision. Make it visible.

### `+1` would have beaten the email limit

- **What happened:** writing the email limit, I realised `ada+1@gmail.com`, `ada+2@…` and `a.d.a@gmail.com` are
  all the same inbox. The limit would have been one character away from useless against the exact attack it's
  for.
- **What I did:** the counting key drops the `+tag` and, for Gmail only, the dots. The booking itself keeps what
  was typed.
- **Lesson:** a limit keyed by an identifier is only as strong as the identifier's normalisation.

### Two "alerts" on the page

- **What happened:** the new E2E test looked up the message with `getByRole("alert")` and failed: two elements.
- **Why:** Next.js puts an empty `role="alert"` route announcer on every page, for screen readers.
- **What I did:** the test finds the message by its text.
- **Lesson:** frameworks add accessibility elements of their own. A role alone isn't unique.

### The README failed CI

- **What happened:** `format:check` failed on a file I hadn't touched. The README edit made on GitHub's website
  left a double blank line, and Prettier rejects it.
- **What I did:** formatted it. This zip includes the fixed README.
- **Lesson:** edits made outside the editor skip the pre-commit hook. CI catches them, but only after the push.

## Next

- **You:** runbook step 11 (Upstash via the Vercel Marketplace, then redeploy).
- **Then:** the 5-minute slot hold is no longer blocked (backlog), or Google Calendar sync.
