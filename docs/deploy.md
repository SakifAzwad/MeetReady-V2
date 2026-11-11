# Deploying MeetReady (Vercel + Neon)

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
2. **Project name:** `meetready`. This gives `meetready.vercel.app` if nobody has it. If it's taken, Vercel adds a
   suffix; you can choose another free `*.vercel.app` name in step 5.
3. **Framework:** Next.js, detected automatically. Leave the build command alone: `vercel.json` sets it.
4. Click **Deploy**. **The first build will fail** with `migrate: set DATABASE_URL`. That's expected: the database
   gets connected in the next step.

## 2. Connect Neon (with a branch per preview)

1. Neon → project `meetready` → **Integrations** → **Vercel** → **Add**. Sign in to Vercel if asked.
2. Choose the Vercel project `meetready`, and the Neon project `meetready` with the `production` branch for
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

Vercel → **Settings → Domains**. You should see `meetready.vercel.app`. If you see a suffixed name instead, edit it
to any free `*.vercel.app` name. Use that exact URL in every step below.

## 6. Google sign-in

Google Cloud Console → the project you used on Day 2.

1. **APIs & Services → Credentials** → your OAuth client:
   - **Authorized JavaScript origins:** add `https://meetready.vercel.app`.
   - **Authorized redirect URIs:** add `https://meetready.vercel.app/api/auth/callback/google`.
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

1. On the live site: **Continue with Google** → onboarding (username `sakif`, timezone Asia/Dhaka) → set your
   availability → create the event type `intro`.
2. Book it once yourself, with your own email: you should get the guest and host emails with invites.
3. Vercel: `DEMO_BOOKING_PATH` = `/sakif/intro` (Production) → **redeploy**. The landing page's "See a live booking
   page" link now points there. It needs the redeploy because the landing page is static.

## 9. Smoke test after every production deploy

GitHub → repo **Settings → Secrets and variables → Actions → Variables**:

| Variable            | Value                          |
| ------------------- | ------------------------------ |
| `PRODUCTION_URL`    | `https://meetready.vercel.app` |
| `DEMO_BOOKING_PATH` | `/sakif/intro`                 |

From the next production deploy on, the **Smoke test (production)** workflow runs by itself. Check the Actions
tab.

**Why variables, not secrets:** these aren't secret, and GitHub shows variables in logs, which helps when
something fails.

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
- **Roll back:** Vercel → Deployments → an earlier good one → **Promote to Production**. A rollback doesn't undo
  a migration, which is another reason migrations stay additive.
