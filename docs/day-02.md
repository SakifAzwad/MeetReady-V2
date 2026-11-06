# Day 2: Google login, onboarding, authorization

**Result:** 98 tests (44 new), typecheck, lint, format and production build green. Smoke-tested
the running app: logged-out visitors are redirected, a forged session cookie gets past the proxy but is
rejected by `requireUser()`, and no dashboard data is sent.

```
src/
├── proxy.ts                         # optimistic redirect (Next 16 name for middleware)
├── server/
│   ├── auth/
│   │   ├── config.ts                # createAuth(db, options): Better Auth setup
│   │   ├── config.test.ts           # real Better Auth on PGlite
│   │   ├── index.ts                 # the app's auth instance (Neon + Google)
│   │   └── session.ts               # getSession / requireUser / requireOnboardedUser
│   ├── users.ts                     # completeOnboarding, suggestUsername
│   └── users.test.ts
├── lib/
│   ├── validation/onboarding.ts     # Zod: username + timezone (form AND server action)
│   ├── safe-redirect.ts             # blocks open redirects
│   └── auth-client.ts               # browser: sign in with Google, sign out
├── db/
│   ├── types.ts                     # Database type: Neon or PGlite
│   └── errors.ts                    # Postgres error codes -> friendly results
├── test/db.ts                       # fresh migrated PGlite per test
└── app/
    ├── api/auth/[...all]/route.ts   # Better Auth endpoints
    ├── (auth)/login/                # page + Google button
    └── (app)/
        ├── onboarding/              # page, form, server action
        └── dashboard/               # page + sign-out
drizzle/0002_username_rules.sql      # username length + format CHECK
```

## 1. The login flow

1. `/login` → "Continue with Google" → `authClient.signIn.social({ provider: "google" })`.
2. Better Auth sends the browser to Google with a random `state` (stored in `verification`).
3. Google redirects to `/api/auth/callback/google?code=...&state=...`.
4. Better Auth checks `state` (stops CSRF on the callback), swaps `code` for tokens, creates or finds the
   `user` + `account` rows, creates a `session` row and sets a **signed, httpOnly** session cookie.
5. New users go to `/onboarding`; returning users to `callbackURL`.

Why Better Auth over NextAuth/Auth.js (v1 used NextAuth v4): TypeScript-first, sessions in **our**
Postgres via the Drizzle adapter, so we can query and test them like any other table, and a plugin system for
later (2FA, organisations for team scheduling).

### Google tokens are encrypted at rest

Better Auth stores Google's access and refresh tokens in `account`. By default they're plain text, so a leaked
database or backup would let someone act as the user on Google (and later, on their Google Calendar).
`account.encryptOAuthTokens: true` encrypts them with `BETTER_AUTH_SECRET` (XChaCha20-Poly1305), so the key
never lives in the database. Tokens saved before the switch stay readable and are replaced, encrypted, on the
next login.

### Database sessions, no cookie cache

The cookie holds a signed session token. Every `getSession()` looks it up in the `session` table.

- **Pro:** sign-out and revocation take effect instantly; a username change is visible on the next request.
  A test proves both.
- **Con:** one indexed query per request.
- Better Auth's cookie cache (or a JWT) would save that query but serve stale data for up to the cache
  lifetime. Easy to switch on later if the query ever shows up in profiling.

## 2. Authorization: three layers

| Layer             | File         | Checks                             | Trust it?                                                  |
| ----------------- | ------------ | ---------------------------------- | ---------------------------------------------------------- |
| Proxy             | `proxy.ts`   | A session cookie **exists**        | No. UX only: saves a logged-out visitor a pointless render |
| Data access layer | `session.ts` | The session is **valid** in the DB | Yes: every page and action calls it                        |
| Database          | constraints  | Data is well-formed and unique     | Yes: last line of defence                                  |

**The rule that fixes v1:** the user id always comes from the session, never from the request. v1 routes
took `?email=` and returned that user's data to anyone. In v2, `completeOnboarding(db, sessionUser.id, input)`
only ever touches the caller's own row. Day 3's event types follow the same rule:
`where userId = session.user.id` on every query.

**Why not trust proxy?** It can't afford a DB query (it runs on every request, including prefetches), so it
can't tell a real cookie from a forged one. Smoke test: a forged cookie passes proxy, then `requireUser()`
rejects it.

**Why not check in a layout?** Layouts don't re-run on client navigation, and they don't stop child pages or
server actions from running. Checks go next to the data (Next.js auth guide, "Layouts and auth checks").

**Server actions are public endpoints.** Anyone can POST to them without our form. So `submitOnboarding`
re-checks the session, re-validates with Zod, and only then writes.

## 3. Onboarding

### One Zod schema, two places

`onboardingSchema` runs in the browser (instant feedback while typing) and in the server action (the check
that counts). One definition, so they can't drift apart.

### Username rules

- Lowercased + trimmed before validating, so `Sakif` and `sakif` are the same URL. A DB `CHECK` enforces
  lowercase too, which makes the existing `UNIQUE` effectively case-insensitive.
- 3–30 chars, letters/digits/single hyphens: safe in a URL without encoding.
- **Reserved names** (`dashboard`, `login`, `api`, `admin`, …): usernames are top-level routes
  (`/sakif`). Without this, someone could claim `/login`, either breaking the route or squatting a page
  that looks official.
- **Taken names:** no "SELECT then UPDATE" (races). The `UNIQUE` constraint decides; `completeOnboarding`
  turns error `23505` into `{ ok: false, error: "username_taken" }`. Same pattern Day 4 uses for `23P01`
  on bookings.

### Users can't set these fields through Better Auth

`username` and `timeZone` are `input: false`, so Better Auth's own `sign-up` and `update-user` endpoints
can't write them. Otherwise anyone logged in could call `POST /api/auth/update-user {"username":"admin"}` and
skip our validation. Tested. A detail found by testing and reading the library source: on sign-up, a field
with a default is silently **replaced** with the default rather than rejected. Both are safe; the test pins
the real behaviour.

### Timezone detection

- The browser knows the user's timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`); the server
  doesn't. It's read with `useSyncExternalStore`, which returns `null` during server render and hydration,
  then the real value. No hydration mismatch, no `useEffect` + `setState` double render.
- **Gotcha found while building:** Node's `Intl.supportedValuesOf("timeZone")` has no `"UTC"` and spells
  India `Asia/Calcutta`, while browsers report `Asia/Kolkata`. So validation uses "can `Intl.DateTimeFormat`
  load this zone?" (accepts both names), not "is it in the list?", and the dropdown adds the detected zone if
  the list spells it differently. Both cases are tested.

### Open-redirect protection

`/login?next=/dashboard/events` is convenient, but if `next` were used as-is, `?next=https://evil.example`
would send a freshly logged-in user to a phishing page. `safeRedirectPath` only allows same-site paths. It
has two layers: string checks (`//`, `\`) and "resolve against a dummy origin; did the origin change?".
Mutation testing: with the string checks removed, the origin check alone still blocks every attack in the
tests; with both removed, the `//` and `\` tests fail.

## 4. Next.js 16 specifics

- **`proxy.ts`** replaces `middleware.ts` (renamed in Next 16, same behaviour).
- **Cache Components** is on: everything outside `<Suspense>` is prerendered into a static shell. Reading
  cookies outside `<Suspense>` is a **build error**. So each page is a static shell (heading, layout) plus an
  async component inside `<Suspense>` that reads the session. The first build failed on exactly this; the
  build output now shows `◐ Partial Prerender` for `/dashboard`, `/login` and `/onboarding`.
- `PageProps<"/login">` / `LayoutProps<"/">` are generated route types, which is why `typecheck` runs
  `next typegen` first.

## 5. Testing approach

- **Real Better Auth on PGlite** (`config.test.ts`): creates users and sessions through Better Auth's own
  API against our hand-written tables. Proves the schema is compatible. Email+password is switched on **in
  the test only** so we don't need Google; production is Google-only.
- `createAuth(db, options)` is a factory, and server functions take `db` as a parameter. That's what makes
  them testable without mocks: same code, in-memory Postgres.
- **Mutation-checked:** removing `input: false` from `username` fails 2 tests.
- **Not tested here:** the real Google round trip (needs real credentials and a browser). That's covered by the
  Playwright E2E tests later, using a test account.

## 6. Likely interview questions

- **"How does your auth work?"** Google OAuth via Better Auth; database sessions in Postgres; signed
  httpOnly cookie; `state` parameter against callback CSRF.
- **"How do you stop users accessing each other's data?"** User id only ever from the session; every query
  scoped by it; checks in the DAL next to the data, not in proxy or layouts. v1 had exactly this bug.
- **"Is middleware/proxy enough?"** No. It only sees that a cookie exists. Show the forged-cookie result.
- **"How do you store third-party OAuth tokens?"** Encrypted at rest with a key from env, never in the DB.
- **"Why database sessions over JWT?"** Instant revocation and fresh data vs one query per request.
- **"Two people choose the same username at once?"** The UNIQUE constraint picks one; the other gets a
  friendly "taken" message. No check-then-write race.
- **"What's an open redirect?"** Explain `safeRedirectPath` and its two layers.

## 7. Stories (problems hit and how they were solved)

### The build failed: "uncached data accessed outside of `<Suspense>`"

- **What happened:** everything passed, then `next build` failed on `/dashboard`.
- **Why:** Next.js 16 has Cache Components on. It prerenders every page into a static shell, and reading
  cookies (the session) outside a `<Suspense>` boundary is a build error.
- **What I did:** read the installed Next.js guide (_Authentication with Cache Components_), then split each
  page into a static shell (heading, layout) and an async component inside `<Suspense>` that reads the
  session. Build output went to `◐ Partial Prerender`: the shell loads instantly, user data streams in.
- **Lesson:** with a new major version, read the docs that ship with it, not what you remember.

### A failing test taught me how the library really works

- **What happened:** my test said "sending `timeZone` to sign-up must be rejected". It failed: the request
  succeeded.
- **What I did:** checked what was stored (`UTC`, not what I sent), then read Better Auth's source
  (`parseInputData`): for an `input: false` field **with a default**, the sent value is silently replaced by
  the default instead of rejected. Both are safe, so I changed the test to pin the real behaviour, and added a
  test for the path that actually matters: a logged-in user calling `update-user` to set their own username.
  That one is rejected.
- **Lesson:** when a test fails, find out why before "fixing" either side. The test was wrong about the
  library, but writing it surfaced the more important case.

### Timezones: the list lies

- **What happened:** I planned to validate "is this timezone in `Intl.supportedValuesOf('timeZone')`?".
  Checking first: Node's list has no `"UTC"`, and spells India `Asia/Calcutta` while browsers say
  `Asia/Kolkata`.
- **What I did:** validate with "can `Intl.DateTimeFormat` load this zone?" (accepts both spellings), and add
  the browser's detected zone to the dropdown if the server list spells it differently. Both cases are tested.
- **Lesson:** a user in Kolkata would have been told their own timezone is invalid. Check assumptions about
  platform data before building on them.

### Found plaintext Google tokens by looking at the database

- **What happened:** after the first real login, Drizzle Studio showed the `account.access_token` column
  starting with `ya29.`: a live Google token in plain text.
- **What I did:** enabled Better Auth's `encryptOAuthTokens` option and verified tests still pass. Before
  switching, I checked the library source for what happens to the token already stored: decryption skips
  values that don't look encrypted, and `updateAccountOnSignIn` (default `true`) rewrites the tokens,
  encrypted, on the next login. To confirm it for real: log in again and the column in Studio changes from
  `ya29.…` to an encrypted value.
- **Lesson:** look at what your app actually writes to the database. Tokens are credentials; encrypt them
  at rest, with the key kept outside the database.

### A mutation that didn't fail any test

- **What happened:** to check the open-redirect tests, I removed the `//` and `\` string checks from
  `safeRedirectPath`. All tests still passed.
- **What I did:** worked out why: the second layer (resolve against a dummy origin and compare) already
  blocks those attacks. Removed both layers: the `//` and `\` tests failed. So the tests were fine, and the
  function has real defence in depth.
- **Lesson:** a surviving mutation means either a missing test or redundant protection. Find out which.

### Proving the proxy isn't the security

- **What I did:** ran the production build and sent a request to `/dashboard` with a forged session cookie.
  The proxy let it through (it only checks the cookie exists); `requireUser()` rejected it and redirected to
  `/login`. No user data was sent.
- **Lesson:** I can show, not just claim, that security lives next to the data.

### GitHub blocked my push: real secrets in `.env.example`

- **What happened:** `git push` was rejected with `GH013: Push cannot contain secrets`. I'd pasted my real
  Google OAuth client ID and secret into `.env.example`, the committed template, instead of `.env.local`,
  which git ignores.
- **What I did:** didn't use the "allow this secret" link. Cleared `.env.example` back to empty placeholders
  (checked `DATABASE_URL` and `BETTER_AUTH_SECRET` too, which the scanner hadn't flagged), confirmed only one
  commit was unpushed, rewrote it with `git commit --amend` so the secret isn't anywhere in history, and pushed.
  The secret had still left my machine (uploaded, then rejected), so the right follow-up is to rotate the
  Google client secret: add a new one in Google Cloud Console, switch `.env.local`, delete the old one.
- **Why amend, not a new commit:** a follow-up commit that deletes the secret still leaves it in the earlier
  commit, readable by anyone with the repo.
- **Lesson:** templates hold names, never values. And it's the exact mistake v1 shipped (a hardcoded Zoom
  token), caught this time by tooling before it went public. Rotate anything that left your machine.

## Next (day 3)

Event types (create / edit / list / deactivate) and weekly availability + date overrides, with shadcn/ui and
React Hook Form, all scoped to the session user.
