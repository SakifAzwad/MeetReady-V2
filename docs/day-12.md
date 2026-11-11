# Day 12: Ready to deploy (Vercel + Neon)

**Result:** the code side of deploying, plus a runbook for the clicks ([deploy.md](deploy.md)).

- **Tests:** 384 unit tests (27 new), 13 E2E tests and 6 new smoke tests all pass. Typecheck, lint, format,
  `drizzle-kit check` and the production build are green.
- **Two bugs found and fixed on the way:**
  - unknown usernames answered 200 (open since Day 7);
  - the slots API crashed with a 500 on bad dates (new).
- **No migration.** The live deploy follows the runbook.

```
vercel.json                     # build command (migrations, then build), region iad1 next to Neon US East 1
scripts/migrate.mts             # migrations on deploy: direct connection, advisory lock
src/proxy.ts                    # + real 404s for unknown /{username} and /{username}/{slug}
src/server/booking.ts           # + publicPageExists()
next.config.ts                  # security headers
src/lib/env-schema.ts           # env rules, testable; the app URL comes from Vercel's variables
src/lib/validation/booking.ts   # fix: slots query refinements only run on parsed dates
src/lib/validation/never-throws.property.test.ts   # no schema may throw on garbage
playwright.smoke.config.ts, e2e/smoke/live.spec.ts # read-only checks against the live site
.github/workflows/smoke.yml     # runs them after each production deploy
.github/workflows/ci.yml        # Postgres 18, same as Neon
docs/deploy.md                  # the runbook
```

## 1. Decisions

### Migrations run in the Vercel build

- **The order:** `npm run vercel-build` runs `scripts/migrate.mts`, then `next build`. A deploy never serves code
  whose tables don't exist yet, and a failed migration stops the deploy before anything changes.
- **Previews can't touch production:** they migrate their **own Neon branch**. The Neon-Vercel integration gives
  each preview a branch and its own `DATABASE_URL`.
- **The direct connection, not the pooler.** Neon's pooler is PgBouncer in transaction mode: consecutive
  statements can land on different server connections. That breaks the session-level lock below.
- **An advisory lock around the migrations.** Two builds can start at once (two quick merges). Without the lock,
  2 of 3 concurrent runs crashed one migrator with a duplicate-key error (see the story). With it, the second
  waits, then finds nothing to do.
- **Migrations must be additive** (expand, then contract later). For a moment, the old deployment serves requests
  against the new schema. A rename takes two deploys.
- **The alternative:** a separate "migrate" job in GitHub Actions. That's two systems racing: Vercel deploys on
  push whether or not the job has finished.

### Real 404s, decided in Proxy

- **The problem (Day 7):** a profile page streams. Its "200 OK" goes out with the static shell, before the lookup
  inside `<Suspense>` can say "not found". The visitor sees the not-found page, but crawlers, link checkers and
  uptime monitors see 200.
- **Two fixes,** both from the Next.js docs:
  - **Look up before streaming:** the page loses its instant static shell, for every visitor, to fix the rare
    visitor of a missing page.
  - **Ask in Proxy (chosen):** one indexed query, before rendering, only on `/{x}` and `/{x}/{y}` paths. If the
    page doesn't exist, the request is rewritten to Next's own not-found route, which answers 404. The address
    bar keeps the typed URL, and the pages themselves are unchanged.
- **Cheap paths skip the database:** anything that can't be a username (wrong characters, wrong length, app
  routes like `/login`, files with an extension) never queries it.
- **Not covered:** `/booking/{token}` with a made-up token still answers 200 with the not-found page and `noindex`.
  It's a private link that's never linked anywhere public, so the status doesn't matter there.

### The app works out its own URL on Vercel

- The app needs its public URL for sign-in callbacks, email links and social previews.
- **On Vercel it's derived:**
  - production uses `VERCEL_PROJECT_PRODUCTION_URL` (`meetready.vercel.app`);
  - a preview uses its own `VERCEL_URL`.
- **Why:** one less variable to type, and a preview's email links point at the preview and its database branch,
  not at production.
- An explicit `BETTER_AUTH_URL` still wins; it's required off Vercel.
- **Testable:** the rules moved to `env-schema.ts` as a pure `parseEnv(source)`, because `env.ts` parses
  `process.env` the moment it's imported.

### Security headers

| Header                                                                     | Stops                                                                      |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` | Clickjacking: another site framing MeetReady under a fake button.          |
| `X-Content-Type-Options: nosniff`                                          | The browser guessing a file is a script.                                   |
| `Referrer-Policy: strict-origin-when-cross-origin`                         | Full paths leaking to other sites (the manage page already sends nothing). |
| `Permissions-Policy`                                                       | Camera, mic, location, payment: the app uses none.                         |

- **HTTPS (HSTS)** is enforced by Vercel on its domains; the smoke test checks it.
- **Not yet: a script Content-Security-Policy.** A strict one needs a fresh nonce per request, which conflicts
  with serving prerendered static shells. It's in the backlog.

### Smoke tests on the live site

- After every successful **production** deploy, GitHub runs 6 read-only checks against the real domain:
  - the landing and login pages load;
  - the dashboard redirects signed-out visitors;
  - an unknown user is a 404;
  - the security headers and HTTPS are there;
  - the slots API answers;
  - the demo booking page shows times.
- **Why they exist:** they catch what CI can't, like a missing env var, a migration that didn't run, or the wrong
  domain.
- **Why read-only:** they run against production, so they never book anything.
- **Why the domain, not the deployment's own URL:** Vercel's deployment protection puts a login page in front of
  deployment URLs.

### Region

- The functions run in `iad1` (Washington), next to Neon's US East 1.
- **Why it matters:** every page makes a few database queries, so the server–database distance is paid several
  times per request. The user–server distance is paid once.

## 2. Likely interview questions

- **"How do you run migrations on deploy safely?"** Before the build, on the direct connection, under an
  advisory lock. Each migration file runs in a transaction, and migrations are additive, so the old code keeps
  working until the new one is live. Previews migrate their own database branch.
- **"Why does a streamed page return 200 for missing content, and how did you fix it?"** The status line is
  sent with the first byte, and streaming sends the shell first. I moved the existence check into Proxy, before
  rendering, and rewrite to the not-found route. I kept the static shell for everyone else.
- **"What's a database branch?"** A copy-on-write fork of the database (Neon): instant, and it only stores the
  differences. Each preview deploy gets one, so it can run migrations and take test bookings without touching
  production.
- **"How do you know a deploy worked?"** CI before (unit + E2E on the production build), smoke tests after
  (read-only, against the real domain), and a rollback by promoting the previous deployment.

## 3. Stories (problems hit and how they were solved)

### A 404 status that Next ignored

- **What happened:** the first version of the proxy re-rendered the same URL with
  `NextResponse.rewrite(url, { status: 404 })`. The new E2E test said the status was still 200.
- **Why:** the page renders by streaming, and the streamed response sets its own 200. The status on a rewrite
  doesn't override it.
- **What I did:** I checked on the running server that Next's built-in `/_not-found` route answers 404, then
  rewrote unknown pages there instead. The E2E test now checks the status code for an unknown user, an unknown
  event type, a switched-off event type and a malformed name, and that real pages still answer 200.
- **Lesson:** "the docs say a rewrite can carry a status" and "this response has that status" are different
  claims. The test checked the second.

### Testing yesterday's build

- **What happened:** after the fix, `curl` still showed 200 everywhere, and even `/login` looked odd.
- **Why:** `pkill -f "next start"` hadn't stopped the old server. The new one failed with `EADDRINUSE` (port in
  use), and I was testing the previous build. The response header gave it away: `x-middleware-rewrite` still
  showed the old rewrite.
- **What I did:** I free the port itself (`fuser -k 3100/tcp`) before starting a server, and check the log says
  "Ready".
- **Lesson:** before reading a result, confirm you're testing what you think you're testing.

### The smoke test found a 500

- **What happened:** the new smoke test asked `/api/slots?from=bad&to=bad` and expected 400. It got **500**.
- **Why:** the query schema checks that `to` is after `from` with an object-level `.refine`. In Zod 4, an object's
  refinements still run after a field fails its **format** check, and they receive the field's raw, untransformed
  value. `"bad".getTime()` threw, and the route crashed. Bad **types** (a number for a string) stop refinements;
  bad **formats** don't.
- **What I did:**
  - the refinements now use Zod's `when` option, so they run only when every field parsed;
  - a regression test pins the exact case;
  - a **property test** (fast-check) covers every schema that reads outside input: it takes a valid example,
    swaps any fields for random garbage, and asserts `safeParse` never throws.
  - The property test found only this one, from the same counterexample (`to: ""`).
- **Lesson:** validation code runs on the worst input by definition, so it must never throw. A property test
  over all schemas turns "I fixed this one" into "none of them do this".

### Why the migration lock is there

- **What I did:** before keeping the advisory lock, I ran two migrators at once on an empty database three times
  **without** it. Twice, one crashed with a duplicate-key error on `pg_type_typname_nsp_index`: both tried to
  create the same table at the same moment. With the lock: three times out of three, one migrated, and the other
  found nothing to do.
- **Lesson:** "two deploys at once" sounds rare until two merges land a minute apart. A lock costs one line;
  reproducing the failure is what justifies it.

## Next

1. **You:** follow [deploy.md](deploy.md).
2. **Then:** error monitoring with Sentry (agreed: its own small step), then rate limiting.
