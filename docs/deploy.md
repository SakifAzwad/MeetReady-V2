# Deploying MeetReady (Vercel + Neon)

> **Live since 12 Nov 2026:** <https://meetreadyv2.vercel.app> (Vercel project `meetreadyv2`, Neon project
> `meetready`, AWS US East 1). Demo booking page: `/sakifazwad18/intro`. The steps below are how it was set up;
> the domain and demo path are the real ones.

A one-time runbook. Secrets are pasted by you into Vercel, Neon and GitHub, never into the repo or a chat. Each
step says **why**, so it can be explained later. Expect about 30–40 minutes.

**What the code already does:**

- `vercel.json`: the build command and the function region (`iad1`, next to Neon's US East 1).
- `npm run vercel-build`: migrations first, then `next build`.
- `proxy.ts`: real 404s.
- `next.config.ts`: security headers.
- `.github/workflows/smoke.yml`: checks the live site after each production deploy.

## 0. Before you start

- CI is green on `main`, on GitHub's Actions tab.
- **Local development must not use the production database.** If your `.env.local` currently points at the Neon
  project's `production` branch:
  1. Neon → your project → **Branches** → **Create branch**, named `dev`, from `production`. It's a copy, so your
     test data comes along.
  2. On the `dev` branch: **Connect** → copy the pooled connection string → paste it into `.env.local` and `.env`
     as `DATABASE_URL`.
  3. Check that `npm run dev` still works.

  **Why:** from now on `production` holds real people's bookings. A local experiment, a seed script or a test
  must never touch it.

## 1. Create the Vercel project

1. Vercel → **Add New → Project** → import `SakifAzwad/MeetReady-V2`.
2. **Project name:** `meetreadyv2` (`meetready.vercel.app` was taken). The name becomes the free domain
   `meetreadyv2.vercel.app`.
3. **Framework:** Next.js, detected automatically. Leave the build command alone: `vercel.json` sets it.
4. Click **Deploy**. **The first build will fail** with `migrate: set DATABASE_URL`. That's expected: the database
   gets connected in the next step.

## 2. Connect Neon (with a branch per preview)

1. Neon → project `meetready` → **Integrations** → **Vercel** → **Add**. Sign in to Vercel if asked.
2. Choose the Vercel project `meetreadyv2`, and the Neon project `meetready` with the `production` branch for
   **Production**.
3. Turn on **"Create a branch for each preview deployment"** and **"Automatically delete obsolete branches"**.

**What it does:**

- It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) in Vercel.
- **Production** uses the `production` branch.
- **Every preview** gets its own branch, a copy of production at that moment. A preview's migrations and test
  bookings never touch production.
- The free plan has a branch limit, so auto-delete matters.

## 3. Environment variables (Vercel → Settings → Environment Variables)

| Name                   | Value                                                            | Environments        |
| ---------------------- | ---------------------------------------------------------------- | ------------------- |
| `BETTER_AUTH_SECRET`   | new: run `openssl rand -base64 32` (not the one in `.env.local`) | Production, Preview |
| `GOOGLE_CLIENT_ID`     | from Google Cloud (step 6)                                       | Production, Preview |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud (step 6)                                       | Production, Preview |
| `RESEND_API_KEY`       | from Resend (step 7)                                             | **Production only** |

**Not needed:**

- `BETTER_AUTH_URL`. On Vercel the app uses the production domain, or a preview's own URL
  (`src/lib/env-schema.ts`).
- `EMAIL_FROM`. The default is Resend's test sender.
- `DEMO_BOOKING_PATH`. It comes in step 8.

**Why:**

- **A new secret:** if your laptop's `.env.local` ever leaks, production sessions stay safe.
- **Resend in production only:** previews have no key, so their emails go to a temporary folder. A preview can
  never email anyone.

## 4. Deploy

Vercel → **Deployments** → the failed one → **⋯ → Redeploy**. In the build log, look for:

```
[migrate] up to date (ep-....us-east-1.aws.neon.tech)
```

Then open the site. The landing page should load.

**Why env vars come before the build:** the landing page is static, and static pages bake env vars in at build
time (Day 7 story). A variable added later needs a redeploy.

## 5. Domain

Vercel → **Settings → Domains**. You should see `meetreadyv2.vercel.app`. Use that exact URL in every step below.

## 6. Google sign-in

Google Cloud Console → the project you used on Day 2.

1. **APIs & Services → Credentials** → your OAuth client:
   - **Authorized JavaScript origins:** add `https://meetreadyv2.vercel.app`.
   - **Authorized redirect URIs:** add `https://meetreadyv2.vercel.app/api/auth/callback/google`.
   - Keep the `localhost` entries for local development.
2. **OAuth consent screen** (Google Auth Platform → **Audience**) → **Publish app**, so the status says **In
   production**.
   - **Why:** in "Testing" mode only the Google accounts you list by hand can sign in, so a recruiter would get an
     error page.
   - The app only asks for name, email and profile picture, so publishing needs no Google review.

**Previews can't sign in with Google.** Google only accepts redirect URLs registered in advance, and every
preview has a new URL. Guest booking works on previews; host sign-in is for production.

## 7. Email (Resend)

1. Resend → **API Keys** → **Create**, with "Sending access" → copy the key.
2. Vercel: `RESEND_API_KEY` = the key, **Production only** → redeploy.

**The limit:** with no domain, Resend's test sender only delivers to **your Resend account email**. Bookings work
for everyone; only guest emails to other people are dropped. Adding a domain later only changes env vars and DNS,
not code.

## 8. Your own booking page

1. On the live site: **Continue with Google** → onboarding (username `sakifazwad18`, timezone Asia/Dhaka) → set
   your availability → create the event type `intro`.
2. Book it once yourself, with your own email: you should get the guest and host emails with invites.
3. Vercel: `DEMO_BOOKING_PATH` = `/sakifazwad18/intro` (Production) → **redeploy**. The landing page's "See a
   live booking page" link now points there. It needs the redeploy because the landing page is static.

## 9. Smoke test after every production deploy

GitHub → repo **Settings → Secrets and variables → Actions → Variables**:

| Variable            | Value                            |
| ------------------- | -------------------------------- |
| `PRODUCTION_URL`    | `https://meetreadyv2.vercel.app` |
| `DEMO_BOOKING_PATH` | `/sakifazwad18/intro`            |

From the next production deploy on, the **Smoke test (production)** workflow runs by itself. Check the Actions
tab.

**Why variables, not secrets:** these aren't secret, and GitHub shows variables in logs, which helps when
something fails.

## 10. Error monitoring (Sentry), added on Day 13

1. [sentry.io](https://sentry.io) → sign up (the free **Developer** plan) → **Create project** → platform **Next.js**,
   name `meetreadyv2`. For alerts, pick "Alert me on every new issue": you get an email the first time each new
   error happens.
2. Collect four values:
   - **DSN:** Project → Settings → **Client Keys (DSN)**. It looks like `https://…@o….ingest.sentry.io/…`.
     It's public by design: it ships in the browser code and only allows _sending_ errors.
   - **Org slug** and **project slug:** from the URL, `sentry.io/organizations/<org>/projects/<project>/`.
   - **Auth token:** Settings → **Auth Tokens** (Organization Tokens) → **Create**. **This one is a secret:** it lets
     the build upload source maps.
3. Vercel → Settings → Environment Variables, for **Production and Preview**:

   | Name                     | Value          |
   | ------------------------ | -------------- |
   | `NEXT_PUBLIC_SENTRY_DSN` | the DSN        |
   | `SENTRY_ORG`             | the org slug   |
   | `SENTRY_PROJECT`         | `meetreadyv2`  |
   | `SENTRY_AUTH_TOKEN`      | the auth token |

4. **Redeploy.** The build log should show source maps being uploaded.
5. **Check it works, with no test route in the app:**
   1. Open <https://meetreadyv2.vercel.app>, then the browser's DevTools console.
   2. Run `setTimeout(() => { throw new Error("Sentry check") })`.
   3. Within a minute, Sentry → **Issues** shows "Sentry check", tagged `production`, with the page URL and a
      readable stack trace.
   4. Resolve the issue afterwards.

**What's never sent:** cookies, IP addresses, request bodies, guest emails, database query values, and the manage
token in `/booking/…` URLs. See `src/lib/monitoring.ts` and the Day 13 doc.

**Local development sends nothing,** because there's no DSN in `.env.local`.

## 11. Rate limiting (Upstash Redis), added on Day 14

Without this step the limits still work, but per server instance only (a warning says so in the function logs).

1. Vercel → the `meetreadyv2` project → **Storage** → **Create Database** → **Upstash for Redis** (from the
   Marketplace).
   - **Region:** US East (N. Virginia), `us-east-1`: the same place as the functions and Neon, so a limit check
     costs a few milliseconds.
   - **Plan:** Free.
   - **Connect it** to `meetreadyv2` for **Production and Preview**. Keep the default variable names (no custom
     prefix).
2. Check Settings → Environment Variables now has `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The app reads those
   (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). The other ones the integration adds (`KV_URL`,
   `REDIS_URL`, the read-only token) aren't used. **The token is a secret.**
3. **Redeploy** production.
4. **Check it works** (PowerShell; this blocks your own IP from the slots API for about a minute). **Start it just
   after a clock minute begins (:00 seconds):**

   ```powershell
   1..61 | % { curl.exe -s -o NUL -w "%{http_code}`n" "https://meetreadyv2.vercel.app/api/slots?username=x&slug=y&from=bad&to=bad" } | Group-Object
   ```

   Expect 60 × `400` (bad parameters, on purpose: no database work) and 1 × `429`. Then Upstash's **Data Browser**
   shows keys like `meetready:production:slots:…`: hashes, never an IP.

   **Why the timing matters (found on 12 Nov):** from Bangladesh the 61 requests took 31 s. Started mid-minute,
   they split across two windows (keys ending `…959` and `…960`; the second held 22). The sliding window weights
   the previous window by how much of it is still inside the last 60 s, so the total stayed around 53, under 60,
   and every request got `400`. Started at :00, all 61 land in one window and the 61st gets `429`. Alternatively,
   run `1..150`.

**Previews share the database** but not the counters: keys are prefixed with the environment.

## 12. Google Calendar, added on Day 15

No new environment variables: it uses the same Google OAuth client as sign-in, and the same Redis as rate limiting.
The new table (`calendar_connections`, migration 0005) is created by the build, like every migration.

1. **Turn on the API:** Google Cloud Console → the same project → **APIs & Services → Library** → search **Google
   Calendar API** → **Enable**. Without this, every call answers 403 and the app shows "access was removed".
2. **Declare the permissions:** Google Auth Platform → **Data Access** → **Add or remove scopes** → add these two
   (paste them in "Manually add scopes") → **Update** → **Save**:
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `https://www.googleapis.com/auth/calendar.events`
3. **Add yourself as a test user:** Google Auth Platform → **Audience** → **Test users** → **Add users** →
   `sakifazwad18@gmail.com` → **Save**.
   - **Why:** while the app's publishing status is **Testing**, only listed test users can grant the calendar
     permissions. Anyone else gets "Access blocked: … has not completed the Google verification process … can
     only be accessed by developer-approved testers", `Error 403: access_denied` (found on 13 Nov).
   - Sign-in isn't affected: in Testing, Google still lets ANY account sign in when an app asks only for name,
     email and picture.
   - **The catch:** in Testing, a test user's calendar access expires after 7 days. Step 13 (publishing) removes
     that.
4. **Nothing to change in Credentials:** the consent screen comes back through the same redirect URI as sign-in.
5. **Deploy** (push Day 15). The migration runs first in the build; the log still ends with `[migrate] up to date`.
6. **Connect it:** <https://meetreadyv2.vercel.app/dashboard/availability> → **Connect Google Calendar**.
   - As a test user, Google may still show "Google hasn't verified this app": click **Continue**.
   - **Leave both permissions ticked.** If one is unticked, the page says so and nothing is connected.
   - Back on the page: "Google Calendar connected".
7. **Check it works:**
   1. In Google Calendar, add an event tomorrow during your working hours, e.g. 10:00–11:00.
   2. Open your booking page in a private window. Within a minute, the times that overlap it are gone.
   3. Delete the event: within a minute, they're back.

**Previews can't connect a calendar,** for the same reason they can't sign in with Google (step 6).

## 13. Publish the app (privacy policy and terms), added after Day 15

Until this step the app is in **Testing**: calendar access works for test users only and expires every 7 days
(the Availability card then says "New bookings are paused" with **Reconnect**). Publishing fixes both.

1. **Deploy** the commit with `/privacy` and `/terms`, and open both pages to check they load.
2. Google Auth Platform → **Branding** → **App domain**:
   - **Application home page:** `https://meetreadyv2.vercel.app`
   - **Application privacy policy link:** `https://meetreadyv2.vercel.app/privacy`
   - **Application terms of service link:** `https://meetreadyv2.vercel.app/terms`
   - **Authorized domains:** `meetreadyv2.vercel.app` (already there). → **Save**.
   - **Don't upload a logo.** The page says a logo means the app must be submitted for verification first.
3. **Audience** → **Publish app** → confirm. The status should say **In production**.
4. **Connect the calendar once more** (Availability → Disconnect, then Connect). Access granted while the app
   was in Testing may still carry its 7-day expiry; a fresh consent after publishing starts clean.

**After publishing (unverified):** any Google account can connect a calendar, after Google's "Google hasn't
verified this app" warning (**Advanced → Go to …**), and at most 100 accounts ever can grant the calendar
permissions. Sign-in has no warning and no cap. Removing the warning and the cap needs Google's verification
(backlog).

## Afterwards: how a change ships

1. Push a branch → CI runs (unit + E2E) → Vercel builds a **preview** on its own database branch → try it.
2. Merge to `main` → Vercel builds **production**: migrations run first, then the build → the smoke test checks the
   live site.

**Migrations must be additive** (add a column, never rename or drop in the same deploy). Old code serves requests
until the new build goes live, and it must still work against the new schema. A rename takes two deploys: add
the new column and write to both; later, drop the old one.

## If something goes wrong

- **Build fails at `[migrate]`:** read the SQL error in the log. Nothing changed, because the migration runs in a
  transaction.
- **Google says `redirect_uri_mismatch`:** the URL in step 6 doesn't exactly match the domain (check `https`, and
  no trailing slash).
- **"Access blocked: app not verified" or "not a test user":** step 6.2, publish the app.
- **The site works, but emails never arrive:** step 7. The test sender only reaches your own address.
- **A guest says "Too many attempts":** it clears by itself (at most an hour for the email limit). To clear it
  now: Upstash → Data Browser → delete the `meetready:production:…` keys. They're hashed, so delete by limit name.
- **Function logs say "rate limits are per instance only":** step 11's variables are missing for that
  environment.
- **The step 11 check gives 61 × `400`:** if Upstash shows `meetready:production:slots:…` keys, Redis works and
  the run crossed a minute boundary; restart it at :00. With no keys, see the line above, or check that the
  production deploy includes the Day 14 commit.
- **Sentry shows "Rate limit store timed out" or a Redis error:** Upstash is slow or down. Bookings still work
  (limits fail open); check Upstash's status page.
- **The Availability page says "New bookings are paused":** Google Calendar didn't answer, or access was
  removed. "Didn't answer" clears by itself; "access was removed" needs **Reconnect** (or **Disconnect** to take
  bookings without the calendar). Check step 12.1 first: a disabled Calendar API also looks like lost access.
- **Roll back:** Vercel → Deployments → an earlier good one → **Promote to Production**. A rollback doesn't undo
  a migration, which is another reason migrations stay additive.
