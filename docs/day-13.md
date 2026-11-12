# Day 13: Error monitoring (Sentry) and the real address in the UI

**Result:**

- **Error monitoring:** Sentry reports errors from the server (rendering, server actions, route handlers, proxy)
  and from browsers, through our own `/monitoring` route.
- **Privacy, proven, not assumed:** I ran a fake Sentry server locally, caused real browser and server errors, and
  read exactly what arrived.
  - No manage token, email, IP address, cookie, request body or database value.
  - Every report is tagged with the release (git commit) and the environment.
- **The real address in the UI:** the app no longer shows `meetready.app`, a domain we don't own. It shows the
  real address everywhere.
- **Tests:** 394 unit tests (10 new) and the 13 E2E tests pass. Typecheck, lint, format and the build are green.
- **Setup:** no migration. One new dependency (`@sentry/nextjs`). Going live needs runbook step 10
  ([deploy.md](deploy.md)).

```
src/instrumentation.ts          # server: Sentry.init + onRequestError
src/instrumentation-client.ts   # browser: Sentry.init + navigation hook
src/lib/monitoring.ts           # privacy: DATA_COLLECTION (all off), scrubEvent/scrubDeep, ignored noise
src/lib/monitoring.test.ts      # tokens, emails, query values, bodies, cookies, user: none survive
src/app/sentry-tunnel/route.ts  # /monitoring → Sentry, payload only (no cookies, no IP headers)
src/app/error.tsx, global-error.tsx   # report browser errors; server ones are already reported
next.config.ts                  # withSentryConfig: source maps uploaded then deleted, tunnel route
src/proxy.ts, validation/onboarding.ts # tunnel paths skip the DB lookup and can't be usernames
src/lib/env.ts                  # appHost: "meetreadyv2.vercel.app", from the same URL as the emails
onboarding, event type form, landing preview   # show appHost instead of "meetready.app"
```

## 1. Decisions

### What gets reported

- **Only real crashes.** The app returns expected outcomes as values, never as exceptions: "slot taken", "not
  found", "invalid input". So they never reach Sentry, and there's nothing to filter.
- **Ignored as noise:**
  - two harmless `ResizeObserver` browser messages;
  - errors thrown by browser extensions (`chrome-extension://…`). They run inside our page, but they aren't our
    code.
- **No duplicates from server errors.** A server error reaches `error.tsx` with only a `digest`, because Next
  hides the real message from the browser. The server already reported the real error, so `error.tsx` only reports
  errors that have no digest: genuine browser errors.
- **`global-error.tsx`** covers errors in the root layout itself, which `error.tsx` can't catch.
- **Errors only:** no performance tracing yet. It spends the free quota, and with little traffic there's nothing
  to measure. **No session replay, ever:** it would record guests typing their details.

### Privacy: two layers

**Layer 1: don't collect.**

- **The trap:** in Sentry v11, `sendDefaultPii` is gone, and its replacement, `dataCollection`, **defaults to
  collecting everything**: cookies, user and IP, request bodies, query parameters, local variables in stack frames,
  database query values.
- **What I did:** `DATA_COLLECTION` switches each one off explicitly. It keeps only three request headers
  (user agent, referer, content type).

**Layer 2: scrub what's left.** `scrubEvent` runs on every report and `scrubDeep` on every breadcrumb, before
anything leaves the app.

- **Dropped whole:** the user, the cookies, the request body and the query string, plus every header except those
  three.
- **Then every string in the event, at any depth, is rewritten:**
  - `/booking/<token>` → `/booking/[token]`. The manage token works like a password: whoever has it can cancel or
    move the meeting.
  - `reschedule=<token>` → `reschedule=[token]`, in the slots API calls made while a guest reschedules.
  - The values in a database error → `params: [redacted]` (see the story).
  - Email addresses → `[email]`.
- **Why scrub every string instead of named fields:** a denylist of patterns applied everywhere also covers
  fields the SDK adds in a later version. Scrubbing only the fields known today would miss a token copied into a
  new one.

### The tunnel: `/monitoring`

- **Why:** ad blockers block `sentry.io`, and those users' errors would be invisible. Browsers send to
  `/monitoring` on our own domain instead.
- **A handler, not a plain rewrite** (`src/app/sentry-tunnel/route.ts`). A rewrite forwards the browser's headers,
  cookies included. The handler forwards only the event, and only to our own project, so the route can't be used
  to relay junk to someone else's Sentry.
- **Proxy skips both paths without a database lookup** (`monitoring`, `sentry-tunnel`).
- **Both names are reserved usernames:** a user called `monitoring` would have collided with the tunnel.

### Readable reports

- **Source maps:** the build uploads them to Sentry, then deletes them from the public output. Sentry shows our
  real code; visitors can't download it. Locally and in CI there's no token: nothing is uploaded, and none are
  left in the build (checked: 0 `.map` files).
- **Every report says which deploy it came from:**
  - the release is the git commit, e.g. `a3b98ac…`;
  - the environment is `production`, `preview` or `development`.
- **Local development and the E2E tests send nothing:** without a DSN, Sentry isn't started.

### The app's real address

- **The bug:** onboarding showed `meetready.app/` before the username, the event type form said "Guests book at
  meetready.app/…", and the landing page's sample browser bar showed the same. We don't own that domain, so a host
  could copy a link that goes nowhere.
- **The fix:** `appHost` comes from the same URL the emails and the dashboard's copy button use (Day 12:
  `meetreadyv2.vercel.app` in production, a preview's own address on previews, `localhost:3000` locally). It's
  passed from server components to the client forms as a prop.

## 2. Likely interview questions

- **"What do you send to your error tracker, and what don't you?"** Stack traces, the page or API route, the
  release and the environment.
  - **Never:** cookies, IP addresses, request bodies, emails, query values, or the manage token in URLs.
  - **Two layers:** the SDK is told not to collect, and a scrubber rewrites every string anyway.
  - **I proved it:** I pointed the app at a fake Sentry and read what arrived.
- **"Why a tunnel?"** Ad blockers block Sentry's domain, so a share of browser errors would be missing. Our own
  route fixes that. I used a handler rather than a rewrite, so cookies aren't forwarded and only our project can
  receive.
- **"How do you avoid noise?"** Expected outcomes aren't exceptions in this codebase. Server errors are reported
  once, by the server. Extension errors and a known harmless browser warning are ignored.
- **"How do you test monitoring without a test route in production?"** Locally: a fake ingest server and real
  errors. In production: throw an error from the DevTools console and watch it arrive (runbook step 10). There's
  no backdoor route to trigger errors.

## 3. Stories (problems hit and how they were solved)

### Sentry v11 collects everything by default

- **What happened:** my plan said `sendDefaultPii: false`, the classic privacy switch. TypeScript rejected it:
  the option no longer exists.
- **Why:** reading the SDK's types, its replacement is `dataCollection`, and every field **defaults to on**:
  cookies, user info (which also adds the IP), all request and response bodies, query parameters, local variables
  in stack frames, database query values. Leaving the option out would have sent guest data with every error.
- **What I did:** an explicit `DATA_COLLECTION`, each field off and commented. I also confirmed in the browser
  SDK's code that `userInfo: false` is what stops the automatic IP address.
- **Lesson:** a privacy default is a version-specific fact, not a known constant. Read the defaults of the
  version you install.

### The database put guest data in its error messages

- **What happened:** to see what server errors really look like, I pointed the app at a database that doesn't
  exist and opened a manage page. The report arrived with the token scrubbed, but its message ended with
  `params: 4b4a18cf…`: Drizzle appends **the query's values** to "Failed query" errors.
- **Why it matters:** here the values were a hash and a username. But a failed booking insert would carry the
  guest's name, notes and answers. The email pattern would catch the email, but not the rest.
- **What I did:** everything after `params:` becomes `[redacted]`; the SQL is kept, because it's what helps
  debugging. A test uses multi-line notes, so a newline in the values can't end the redaction early. Then I
  rebuilt and caused the error again, and it arrived as `params: [redacted]`.
- **Lesson:** unit tests check the patterns you thought of. Causing real errors showed what's actually in them.

### Two gaps in my own scrubber

- **What happened:** reading the scrubber back before testing, two things could slip past:
  - **the query string:** Sentry may store `request.query_string` as `reschedule=…` (no leading `?`) or as
    key/value pairs, where the token is a bare string with nothing to match;
  - **the request body:** `request.data` holds a server action's body, which is the whole booking form.
- **What I did:** both are dropped outright, not scrubbed. The URL still shows the query, and URLs are scrubbed.
  Tests now include both shapes.
- **Lesson:** when you can't reliably recognise a secret inside a field, drop the field.

### The import that moved

- **What happened:** `next typegen` (part of `npm run typecheck`) failed: "withSentryConfig is not a function".
- **Why:** in v11, the config helper moved from `@sentry/nextjs` to its own entry point, `@sentry/nextjs/config`.
  The package's `exports` map shows it.
- **Lesson:** after a major version, check where the docs' import names live now.

### A username that would have broken error reporting

- **What happened:** adding the tunnel paths to the proxy's list of app routes, I realised `/monitoring` is
  also a valid **username**.
- **What I did:** `monitoring` and `sentry-tunnel` are now reserved, next to `dashboard` and `login`.
- **Lesson:** in an app where usernames are top-level URLs, every new top-level route is also a name someone
  could already be using.

## Next

- **You:** runbook step 10 (Sentry account, four env vars, redeploy, the console check).
- **Then: rate limiting** on the public booking routes (backlog #2). It matters more now that the site is public.
