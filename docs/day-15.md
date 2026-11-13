# Day 15: Google Calendar, part 1 (busy times)

**Result:**

- **Connect Google Calendar** on the Availability page. Busy times in the host's primary calendar now block their
  booking page. Disconnect revokes access at Google and forgets the tokens.
- **One consent screen for both days:** read availability now, and add events (Day 16), so the host is asked once.
- **Privacy:** MeetReady only ever sees busy/free times, never event titles, guests or descriptions.
- **Fails closed at booking time:** if Google can't be reached, the booking (or reschedule) is refused with "try
  again in a minute". Nothing is booked and the guest's details are kept. The times list can still use a copy up
  to an hour old.
- **The host is told:** "New bookings are paused" on the Availability page while Google is failing, with
  **Reconnect** when access was lost.
- **CI:** GitHub Actions updated to their Node 24 versions (the deprecation warning is gone).
- **Tests:** 470 unit tests (47 new) and 18 E2E tests (3 new, each run 3 times in a row with no flakes), against a
  fake Google, so CI never calls the real one. Typecheck, lint, format, `drizzle-kit check` and the build are
  green.
- **Setup:** migration 0005 (`calendar_connections`, additive, runs in the build). Google Cloud needs runbook step
  12: turn on the Calendar API and declare the two permissions. No new env vars in production.

```
src/server/calendar/google-api.ts    # freeBusy + revoke over fetch; errors sorted into access_lost / unavailable
src/server/calendar/busy.ts          # ExternalBusy: connection lookup, cache, live vs cached, error recording
src/server/calendar/cache.ts         # 1-minute fresh / 1-hour stale cache: Redis hash per host, or memory
src/server/calendar/connection.ts    # connect (checks what was really granted), status, disconnect (revoke + forget)
src/server/calendar/index.ts         # wiring: Better Auth tokens, Google, Redis, Sentry
src/server/redis.ts                  # one Upstash client shared by rate limits and the calendar cache
src/lib/calendar.ts                  # the two scopes, and scope-string helpers (browser + server)
src/db/schema.ts + drizzle/0005      # calendar_connections: user, account, calendar, last error (+ CHECK)
src/server/booking.ts                # busyLoadRange; externalBusy into slot generation; live check before the lock
src/server/manage-booking.ts, share.ts # reschedule: live, fail closed; share times: cached
api/slots/route.ts, actions          # cached busy times for showing; 503 when there's nothing usable
dashboard/availability/*             # the card, the callback route, the disconnect action
e2e/support/fake-google.mjs, e2e/calendar.spec.ts  # a fake Google; busy times, fail closed, disconnect
.github/workflows/*.yml              # checkout, setup-node, upload-artifact @v6 (Node 24)
```

## 1. Decisions

### Connecting: the same Google account, more permissions

- **Better Auth's "link account" flow, not a second login.** The host is already signed in with Google. Linking
  the same account again with extra scopes updates the existing account row: new tokens (encrypted, as since Day 2) and the granted scopes merged in.
- **Three parameters make it work:**
  - `scopes`: the two calendar permissions, added to the sign-in ones;
  - `access_type=offline`: a **refresh token**, so busy times keep working when the host isn't around (an access
    token lasts an hour);
  - `prompt=consent`: Google only sends a refresh token from a consent screen. It overrides sign-in's
    `select_account`.
  - Google's `include_granted_scopes` (on by default) keeps what sign-in already granted.
- **What was really granted is checked, not assumed.** Google's consent screen lets people untick individual
  permissions. The callback (`/dashboard/availability/calendar-connected`) checks both scopes and a refresh token
  before it creates the connection.
- **The connection is our own table, not a flag on Better Auth's.** `account` is how the host signs in (Better
  Auth owns it). `calendar_connections` is a feature they switched on (we own it): which account, which calendar,
  and the last error. Disconnecting deletes our row and leaves sign-in working.
- **A GET with a side effect** (the callback). Unusual, but it's an OAuth return URL. It's safe to reload or to be
  sent there: it only reads the signed-in host's own account and reflects what that account really granted.

### The permissions

- **`calendar.freebusy`:** busy/free times only. Google can't send us titles or guests, because this scope can't
  see them. Least privilege, and a clean privacy answer.
- **`calendar.events`:** create, change and delete events (Day 16). Asked now, on the same screen, as decided.
- **Why not just `calendar.events`?** Free/busy queries don't accept it (see the first story).
- **Why not `calendar.readonly`?** It would let us read every event's details, which we never need.

### Busy times inside booking

- **Slot generation is unchanged and still pure.** Google's busy times arrive as more busy intervals, like
  bookings, with two differences: no buffers of their own (the new meeting's buffers still keep a gap), and they
  never count towards "max bookings per day".
- **The data is passed in, not fetched inside.** `getBookingCalendar` takes `externalBusy`. Nothing in the slot
  code waits on Google, and tests pass plain arrays.
- **Booking asks Google BEFORE taking the lock.** The live check happens outside the transaction. A network call
  inside it would hold a database connection and this host's lock for up to 2.5 seconds, making every other guest
  of that host wait. The small window this leaves (an event added in Google between the check and the insert) is
  the same as any calendar sync, and it closes on the next check.
- **Same range everywhere:** `busyLoadRange` (the requested range ± 2 days) is used for both the database load and
  the Google query, so both sources cover the same time.

### Fail closed for booking, cached for showing

| Path                          | Google answers          | Google fails                                         |
| ----------------------------- | ----------------------- | ---------------------------------------------------- |
| Booking, rescheduling         | live answer, every time | **refused**: "try again in a minute", nothing booked |
| Booking page times, slots API | cached up to 1 minute   | copy up to 1 hour old; none at all → `503`           |
| Share times (host)            | cached up to 1 minute   | the host is told the times might clash               |

- **Why opposite to Day 14's fail open:** rate limits protect against rare abuse, so an outage there shouldn't stop
  bookings. Here, an outage means not knowing whether the host is busy. A meeting booked on top of a real one is
  worse than a retry.
- **Showing can be a little old because booking re-checks live.** The worst case of an old list is a guest
  picking a time that has just become busy, and being told "someone just booked that time" (the existing
  message).
- **The cache:** a Redis hash per host (one `DEL` clears it on connect and disconnect), expiring an hour after the
  last write. Only start/end times are stored. If the cache itself fails, it's skipped, never an error.
- **Timeout 2.5 seconds** on every Google call: a slow Google mustn't hang a booking.

### What the host sees when it breaks

- **Two kinds of failure, stored on the connection** (`last_error`, with a `CHECK`: an error always has a time):
  - `access_lost`: 401/403, a calendar that's gone, or a token that can't be refreshed. Needs **Reconnect**.
  - `unavailable`: timeouts, 429, 5xx. Clears by itself.
- **Written only when the state changes:** healthy → failing → healthy. No database write per guest request.
- **Reported to Sentry once per change,** not per request: an outage is one report. Nothing about the host's
  events is attached.
- **A response we can't read is an error, never "no busy times".** Treating garbage as an empty calendar would open
  every slot, which is the dangerous direction.

### Disconnecting

- **Revoke at Google first** (best effort), then delete our copies: tokens, the calendar scopes, the connection.
  At Google, revoking one token revokes the whole grant, refresh token included.
- **If Google can't be reached, it still disconnects.** Our side is what we control. The grant without our stored
  tokens is useless to anyone.

### Testing without Google

- **Unit:** a fake `fetch` for the Google client; a fake calendar for booking; Postgres (PGlite) for connections.
- **The consent URL is tested** with the real Better Auth: scopes, `access_type`, `prompt`, PKCE, the callback.
  The screen itself can't run in a test, but the URL is where every promise about permissions is made.
- **E2E:** a fake Google server (`fake-google.mjs`) started by Playwright. The app points at it through
  `GOOGLE_CALENDAR_API_URL` and `GOOGLE_REVOKE_URL` (default: Google's real addresses). Calendars are per access
  token, so parallel tests can't see each other's.

### Follow-up (13 Nov): privacy policy, terms, publishing

- **Why it was needed:** Google won't let the app leave Testing until the Branding page has a privacy policy
  link. In Testing, calendar access works only for test users and expires every 7 days.
- **`/privacy` says what the code does, nothing more.** Each claim maps to code: the three sign-in fields,
  session IP and user agent (Better Auth), guests' details, hashed manage links, busy times only and a cache of
  at most an hour, encrypted tokens, hashed rate-limit keys, scrubbed Sentry reports, one cookie, the 12/24-hour
  preference in local storage, and the six services involved. If the code changes, the page must change.
- **Google's "Limited Use" statement** is on the page, with the promise it implies: Google data isn't sold, used
  for ads, used to train AI, or read by people (except with permission, for security, or by law).
- **Deletion is a manual email for now,** answered within 30 days. Honest beats a button that doesn't exist yet.
- **`/terms` is short:** a portfolio project, provided as it is; fair use (no spam, no filling calendars, no
  getting around limits); liability limited as far as the law allows.
- **Linked where people decide:** the site footer (a "Legal" column) and under the Google button on the login
  page ("By continuing, you agree to…").
- **Not legal advice:** the pages are an accurate description of the app, written for a portfolio project.

## 2. Likely interview questions

- **"How do you integrate Google Calendar?"** Incremental authorisation on the existing Google login, with offline
  access for a refresh token. Free/busy only for reading, so we never see event details. The busy times become
  more busy intervals for the same pure slot function.
- **"What if Google is down?"** It depends on the action. Booking fails closed, because a clash is worse than a
  retry. Showing times uses a short cache, up to an hour old if Google is failing, because booking re-checks live
  anyway. Day 14's rate limiter fails open for the opposite reason.
- **"Why not call Google inside the booking transaction?"** It would hold the per-host lock and a database
  connection during a network call. I fetch first, then lock.
- **"How do you store the tokens?"** Encrypted at rest by Better Auth (XChaCha20-Poly1305 with the server
  secret). On disconnect I revoke at Google and delete them.
- **"What if the user unticks a permission on Google's screen?"** The callback checks the granted scopes and the
  refresh token before connecting, and tells the host what's missing.
- **"How do you test it?"** A fake Google in E2E, swapped in by URL. The consent URL is checked in a unit test with
  the real Better Auth. Fail closed is proven end to end: Google goes down between choosing a time and confirming
  it.

## 3. Stories (problems hit and how they were solved)

### The write permission can't read busy times

- **What happened:** the plan was "ask for `calendar.events`, which can do everything we need". The reference for
  the free/busy endpoint lists the scopes it accepts, and `calendar.events` isn't one of them.
- **What I did:** two scopes, `calendar.freebusy` + `calendar.events`, on one consent screen. The narrower read
  scope also turned out to be the better privacy story: it can't see event details at all.
- **Lesson:** check the endpoint's own scope list. "Broader" scopes aren't always supersets.

### One error for "revoked" and "Google is down"

- **What happened:** reading Better Auth's token code, every refresh failure (a revoked grant, a network error,
  Google's token endpoint down) comes back as the same `FAILED_TO_GET_ACCESS_TOKEN`.
- **What I did:** a token failure counts as `access_lost`, the usual cause, which shows **Reconnect**. If it was
  really an outage, the next successful call clears it by itself. Booking is refused either way, so the
  classification only changes what the host is told, never safety.
- **Lesson:** when a library hides the cause, decide which mistake is cheaper, and make sure safety doesn't depend
  on guessing right.

### Would signing in again break the calendar?

- **What happened:** after connecting, the host signs in again normally, without offline access. Google sends no
  refresh token for that. If the sign-in overwrote the stored one with nothing, the calendar would die an hour
  later, silently.
- **What I did:** read Better Auth's sign-in path. It only updates tokens that came back (an empty refresh token is
  skipped), and it never touches the stored scopes ("updated only via linkSocial"). So nothing to change, but now
  it's a known fact, written down.
- **Lesson:** with OAuth, check what every later flow does to the tokens you depend on, not just the first one.

### My own test misread the buffer rule

- **What happened:** with a 15-minute buffer after each meeting and working hours ending at 06:00 UTC, I expected
  05:30 not to be offered. It was.
- **Why:** since Day 1, buffers keep a gap from other meetings; they may fall outside working hours. The 05:30
  meeting ends at 06:00 and its buffer runs into the evening, which is allowed.
- **What I did:** fixed the expectation, not the code.
- **Lesson:** when a test fails, check whether the code or the test is wrong. Here, the rule was right.

### Seeding encrypted tokens for the browser tests

- **What happened:** the E2E tests need a host whose calendar is "connected", but the consent screen can't run in
  CI. And tokens are encrypted at rest, so plain text in the account row would fail to decrypt.
- **What I did:** the fixture encrypts the fake tokens with Better Auth's own `symmetricEncrypt` and the test
  secret. The app then reads them through its normal path (decrypt, check expiry, call "Google").
- **Lesson:** seed data the way production would have written it, so the test exercises the real read path.

### Google blocked the consent screen, and I first blamed the wrong thing

- **What happened:** connecting in production, Google answered "Access blocked: meetreadyv2.vercel.app has not
  completed the Google verification process … can only be accessed by developer-approved testers",
  `Error 403: access_denied`. My runbook had promised a warning you could click through.
- **My first explanation was wrong:** I assumed the app was published and that Google blocks unverified
  sensitive permissions even then, and wrote that into the runbook.
- **What was really going on:** the Audience page showed the app had never left **Testing** (Publish was greyed
  out until the Branding page had a privacy policy). Sign-in had always worked for every account because, in
  Testing, Google lets anyone sign in when an app only asks for name, email and picture. Calendar permissions
  aren't covered by that exception: test users only, and their access expires after 7 days.
- **What I did:** added the host as a test user (it worked), corrected the runbook, then added `/privacy` and
  `/terms` so the app can be published (runbook step 13).
- **Lesson:** look at the actual console state before explaining a platform error. One screenshot of the
  Audience page would have saved a wrong explanation.

### `/privacy` would have answered 404

- **What happened:** `privacy` and `terms` had been reserved usernames since Day 2. But `proxy.ts` (Day 12)
  keeps its own list of app routes, and neither was in it. A new `/privacy` page would have gone through the
  username lookup, found no user called "privacy", and been rewritten to the 404 page. Google's consent screen
  would have linked to a 404.
- **What I did:** one shared list (`src/lib/app-routes.ts`), and a test that reads the real `src/app` folder
  and checks every top-level route is both in that list and a reserved username.
- **Lesson:** two lists that must agree will drift. Make a test derive the truth from the source.

## Next

- **You:** push the privacy/terms commit, then runbook step 13 (Branding links, Publish app, reconnect the
  calendar).
- **Day 16: write to the calendar.** Each booking becomes an event in the host's calendar with a Meet link;
  reschedule moves it, cancel deletes it. One thing to handle: once our own bookings are in Google, a reschedule
  must not be blocked by its own event (exclude it by event id).
