# Day 11: Browser tests in CI

**Result:** 12 Playwright tests in `e2e/`, run on every push in a new `e2e` CI job. They drive the **production
build** in Chromium against a **real Postgres**. Locally the suite takes about a minute after the build. Before
trusting it, I ran every test 5 times at full parallelism (60/60) and checked that a deliberately introduced bug
makes it fail. The 357 unit tests, typecheck, lint, format and `drizzle-kit check` are still green. The E2E tests
found two real bugs; both are fixed. No migration. Still not deployed.

```
playwright.config.ts          # build + start on :3100, env that wins over .env.local, no retries
e2e/
├── fixtures.ts               # fresh host per test, signed-in pages, guests, console-error check, emails
├── support/
│   ├── config.ts             # port, database URL, test secret, outbox path (shared by config + fixtures)
│   ├── prepare-db.mts        # drop + create + migrate the e2e database (refuses names without "e2e")
│   └── booking.ts            # guest steps: choose a time, fill details, book
├── booking.spec.ts           # book + slot gone, two-guest race, 404s, slots API input, emails
├── manage.spec.ts            # reschedule + cancel from the email link, host cancels, bad token
├── questions.spec.ts         # the editor; answers, mid-booking change, where answers show
└── phone.spec.ts             # booking and host pages at 390px: no sideways scroll
.github/workflows/ci.yml      # + e2e job (Postgres 17, Playwright Chromium, report on failure)
src/lib/env.ts                # fix: empty RESEND_API_KEY means "not set"
src/server/email/sender.ts    # fix: outbox writes .ics before .html
```

## 1. What the tests cover

| Spec                | Tests                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `booking.spec.ts`   | Profile → event type → empty form rejected → booked → the time is gone for the next guest. Two guests confirm the same time at once: exactly one wins, the other keeps their details. Not-found pages. The slots API refuses a two-year range. Emails. |
| `manage.spec.ts`    | From the email link: the page is `noindex` + `no-referrer`; reschedule (same UID, SEQUENCE 1); cancel with a reason (CANCEL invite, host told). The host cancels from the dashboard: only the guest is emailed. A made-up token is not found.          |
| `questions.spec.ts` | The editor: focus after add, after a type change, after Enter in an option and after a move; errors next to empty options; order saved. A guest answers; the host renames a question mid-booking; snapshot order; email, dashboard, manage page.       |
| `phone.spec.ts`     | At 390px: the booking page and the details step (with long answer options), plus four host pages and the question editor, never scroll sideways.                                                                                                       |

**Every test also fails on any console error or uncaught page error,** even when its own assertions pass.

**Not covered yet:**

- Google sign-in itself (see below).
- Onboarding, the availability editor, the guest switching timezones.
- Design screenshots.

These are still scripts in `e2e/harness/`, or are covered by unit tests: timezones and DST in
`generate-slots.test.ts`.

## 2. Decisions

### Test the production build

- The web server runs `next build`, then `next start`, not `next dev`.
- **Why:**
  - Dev compiles pages on first request, so the first visits are slow and timing differs.
  - Dev also behaves differently from production: static shells and Cache Components prerendering only happen
    in a build, and three of this project's bugs (Days 6, 7, 9) only appeared in the build.
- **A side effect:** CI never ran `next build` before. Now it does on every push.

### A real Postgres, not PGlite

- The app's own `pg` driver, the exclusion constraint, and two browsers racing through the advisory lock on
  separate connections.
- PGlite is one connection in-process, so it can't be the database a separate server process talks to.

### A fresh host per test, so everything runs in parallel

- The `host` fixture creates a new user (`host-<random>`) with a schedule, an event type and a session, just for
  that test.
- No test sees another test's bookings, so tests run in parallel, in any order, and any one can run alone.
- **The alternative,** one seeded host plus truncating tables before each test, forces tests to run one at a time.
  It also hides order dependencies until someone runs a single test.
- **Guests and emails follow the same rule:** every guest email is unique (`ada-3f9c1a@example.com`), so the
  shared outbox folder is read by recipient.

### Signing in without Google

- **What the fixture does:** it writes a `session` row and sets the cookie Better Auth would have set after Google
  login. The cookie is `token.HMAC-SHA256(secret, token)`, signed with a test-only secret that the config also
  gives the server.
- **Why not a "log in as" test route:** that would be a backdoor in production code, one misconfigured env var
  away from being live. With this approach, production code has nothing test-specific.
- **What it doesn't cover:** the Google redirect itself. That needs Google, and Day 2's unit tests cover our
  side of it (the auth config).

### No retries

- `retries: 0`. A test that passes on the second try is a real bug, in the app or the test, that a retry would
  hide.
- Instead, a failure keeps a **trace** (every step, with DOM snapshots, network and console) and a screenshot.
  CI uploads them as an artifact.
- **This paid off on the first stress run:** see the outbox story.

### Server settings that win over `.env.local`

- Next never lets a `.env` file override a variable that's already set in the environment. So the config passes
  `DATABASE_URL`, the auth secret and `RESEND_API_KEY=""` to the server, and your `.env.local` can't redirect
  the tests to your dev database or to a real inbox.
- **The port is 3100, and an existing server is never reused.** A `npm run dev` on port 3000 is connected to your
  dev database.
- **`prepare-db.mts` drops and recreates the database,** so it refuses any database name that doesn't contain
  "e2e".

### The rest

- **Chromium only,** pinned by the `@playwright/test` version, so every run uses the same browser build.
  `E2E_BROWSER_CHANNEL=chrome` uses an installed Chrome instead, for machines that can't download Playwright's.
- **The guest's timezone is Dhaka, the same as the host's.** All of the host's hours are then "daytime", and no
  times are folded away (Day 9), whatever hour the test runs. Cross-timezone display is covered by unit tests.
- **Locators go by role and exact accessible name,** the way a screen reader user finds things. A test that
  passes also says the page is usable without seeing it.
- **A separate CI job,** running beside `check`. A push waits for the slower of the two, not both in a row.

## 3. Likely interview questions

- **"How do you split unit and E2E tests?"**
  - Unit tests own the logic and edge cases: slot generation, DST, validation, race tests at the database
    level. There are 357 and they take seconds.
  - E2E tests own whole flows through real pages, a few per feature, checking that the pieces connect: the email
    link opens the manage page, and the manage page moves the booking.
  - Each edge case is tested once, at the cheapest level.
- **"How do you log in during E2E tests without OAuth?"** By seeding a database session and setting the signed
  cookie the auth library would set. There's no test route in production code. The OAuth handshake itself is
  the provider's job; our config around it is unit-tested.
- **"How do you keep E2E tests fast and independent?"** Each test creates its own data under unique names, so
  tests run in parallel and in any order. Data is never shared, and nothing is cleaned up between tests.
- **"What do you do about flaky tests?"** No retries. I run new tests with `--repeat-each` before trusting them,
  read the trace, and fix the cause. The one flake I found was a real race in how the app wrote emails.
- **"How do you know the tests would catch a bug?"** I put one in: I removed the answers from the host's email,
  rebuilt, and the questions test failed on exactly that line. Then I reverted it.

## 4. Stories (problems hit and how they were solved)

### The example env file crashed the app

- **What happened:** to stop the tests sending real email, the config sets `RESEND_API_KEY` to an empty string.
  I checked that the app accepts it, and it doesn't: `env.ts` required `min(1)` when the key is present.
- **Why it mattered beyond tests:** `.env.example` ships the line as `RESEND_API_KEY=`, and a `.env` line with
  no value arrives as `""`, not as "missing". So anyone who copied the example file without filling that line got
  an app that refused to start, with an error about a key the docs say is optional.
- **What I did:** a small `emptyAsUnset` wrapper treats `""` as unset for optional variables. `DEMO_BOOKING_PATH`
  had its own copy of the same fix, and now uses the shared one.
- **Lesson:** in env files, "empty" and "missing" are different values. Optional settings have to accept
  both.

### The web server starts before global setup

- **What happened:** I planned to create and migrate the test database in Playwright's `globalSetup`. Reading
  Playwright's runner source to check the order, I found that plugin setup, which includes the web server, runs
  **before** `globalSetup`. Our server command starts with `next build`, which needs a migrated database.
- **What I did:** the database step is the first part of the web server command:
  `node e2e/support/prepare-db.mts && npm run build && next start`. It's written in TypeScript and run with
  Node's built-in type stripping (Node 22.18+), so it has no build step.
- **Lesson:** don't guess the order of lifecycle hooks. Read the docs or the source: here, the obvious place was
  the wrong one.

### A flaky test that was a real bug

- **What happened:** the first `--repeat-each 3` run had one failure in 36. The email test found the guest's
  email, but its calendar invite was `null`.
- **Why:** the dev outbox wrote `email.html` first and `email.ics` second. The test, like anyone opening the folder,
  looks for `.html` files, and it caught one in the gap before the invite was written.
- **What I did:** the outbox writes the `.ics` first and the `.html` last, so an email only becomes visible once
  it's complete. It's the same idea as a commit marker. After that: 36/36 with 2 workers, then 60/60 at full
  parallelism.
- **Lesson:** a new test that passes once has proven very little. Repeating it under load found a race in about
  a minute. A retry would have hidden it.

### Checking that the tests can fail

- **What I did:** I commented out the line that passes answers to the host's email, rebuilt, and ran the questions
  spec. It failed on `expect(hostMail.html).toContain("Acme Corp")`. Then I reverted the change.
- **Lesson:** a test you've never seen fail might not be testing anything. One deliberate break is cheap
  evidence that it does.

### Two small ones

- **Wrong matcher:** I used `toHaveValues` to check the question order. That matcher is for a multi-select, so it
  failed with "strict mode violation" across three inputs. The test now reads the values with `evaluateAll` and
  polls until they match.
- **The linter and `use`:** ESLint's React rule flagged every fixture, because Playwright passes a callback named
  `use`, which looks like React's `use()` hook. The rule is off for `e2e/` only, with a comment saying why.

## Next

**Deploy:** Vercel and Neon. This includes the `/unknown-username` 200-vs-404 decision and Sentry. See
[backlog.md](backlog.md).
