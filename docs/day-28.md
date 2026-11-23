# Day 28: Teams, roles and invite links (team scheduling, part 1 of 3)

**Result:**

- **Hosts can create teams.** Account menu → **Teams**: a list of your teams and a **Create a team** form (name,
  plus an address that follows the name until edited: `/team/{slug}`, where team booking pages arrive on Day 29).
- **Two roles.** The **owner** (whoever created it) renames, makes and revokes invite links, removes members, and
  deletes the team. A **member** sees the team and its people, and can leave. Exactly one owner per team.
- **Invite links.** **Create an invite link** shows `…/invite/{token}` once, with **Copy link**. Each link lets one
  person join, once, within 7 days, and can be revoked. Only the token's SHA-256 is stored. No emails yet (Resend's
  test sender only reaches Sakif; email invites come with the domain day).
- **Joining:** someone signed out who opens a link logs in and comes back to it. A brand-new account picks a
  username and comes back too. The page says who invited them and what joining shares (name, email, picture),
  then they press **Join**. Opening the link uses nothing up: only Join does.
- **Limits:** 5 owned teams per person, 20 people per team, 10 open links per team.
- **Also:** `invite`, `team` and `teams` reserved as usernames; invite tokens scrubbed from Sentry reports; the
  login page says why an invited person is there; a privacy-page paragraph (`#teams`); and a fix to `proxy.ts`
  (Story 2).
- **Tests:** 814 unit tests (21 new: every role and invite state on PGlite in `teams.test.ts`, plus path and
  scrubber tests) and 2 new race tests on real Postgres (`teams.race.test.ts`); 53 E2E tests (3 new in
  `e2e/teams.spec.ts`, passed 3 times in a row). Three protections were removed one at a time, and the tests caught
  each: the role check in a write, the link claim, and the team-row lock. Typecheck, lint, format, `drizzle-kit
check` and the build are green.
- **Setup:** migration 0014 runs in the build. Runbook **step 21**.

## 1. Decisions (from the plan, plus the details decided while building)

### Tables

```
teams          id, slug (unique, CHECK = username rules), name (CHECK 1–60)
team_members   (team_id, user_id) primary key, role owner|member, joined_at
               + unique index on team_id WHERE role = 'owner'
team_invites   id, team_id, token_hash (unique), created_by, created_at,
               expires_at, used_at, used_by, revoked_at
               CHECK used_at is null or revoked_at is null
```

- **Role on the membership row, not `teams.owner_id`.** One table answers "who is in this team, as what". A role
  column also leaves room for an admin role later without a new table.
- **"Exactly one owner", half in Postgres:** the partial unique index (`… on team_id where role = 'owner'`) means
  at most one owner, whatever the code does. At least one is the code's job: nothing removes or demotes an owner,
  and an owner can't leave (they delete the team). Transferring ownership is in the backlog.
- **Joining twice is impossible** because of the `(team_id, user_id)` primary key.
- **Team slugs have their own namespace.** `/team/{slug}` can never clash with `/{username}`, so a team may be
  called `sakif`. Only the word `team` itself is reserved as a username.

### Authorization: the role check inside the write

The rule since Day 2 (the user comes from the session, every query is scoped to them) now has a second level: the
user's role in this team.

- **Reads** check membership in the same query: `getTeam` joins `team_members` on (team, me). A team you're not
  in returns null, and the page is the same 404 as a team that doesn't exist. No 403 that would confirm it's there.
- **Writes** put the check inside their own `WHERE`: `… and team_id in (select team_id from team_members where
user_id = me and role = 'owner')`. There's no gap between "is this person the owner?" and the write. A member,
  an outsider, and the owner of a different team all get `false`. Each case has a test.

### Invite links: hashed, single-use, 7 days, revocable

- **Hashed:** a token is a password to join, so it's stored like the manage token (Day 4): 32 random bytes, only
  SHA-256 kept. A leaked backup can't be turned into working links. No rate limit is needed on guessing (256
  bits), and every action needs a session anyway.
- **Single use, not "anyone with the link"**: links get forwarded and posted in group chats. A single-use link
  lets in one person, and the owner sees who.
- **Shown once:** like the webhook secret (Day 26), because only the hash exists after.
- **Copied, not emailed (Sakif's pick):** with no domain, Resend only delivers to Sakif. Email invites come on the
  domain day.
- **Someone already in the team doesn't use the link up**, so it can still reach the person it was meant for.

### Opening a link changes nothing; Join does

Slack, WhatsApp, Teams and mail scanners fetch links to build previews, often before the person sees the message.
If a GET used up a single-use link, the preview would take the only use. So the page (a GET) only reads. Joining is
a server action (a POST) behind a button. The same reason the manage page (Day 5) needs a click to cancel.

### Two races, two different fixes

1. **One link, two people pressing Join together.** The link is claimed with one conditional UPDATE:
   `set used_at = now where token_hash = … and used_at is null and revoked_at is null and expires_at > now`.
   Postgres serializes the two updates on that row; the second matches nothing. No "check, then write" gap.
2. **Two links, one place left in the team.** Each join counts the members, then adds one. Both can count 19, so
   the cap needs a lock: `select … from teams where id = … for update` first, and joins to one team take their
   turn (Story 1). If the team is full after the claim, `tx.rollback()` undoes the claim too, so the link still
   works once someone leaves.

### Coming back after login and onboarding

`/invite` joined the protected paths in `proxy.ts`, so a signed-out visitor goes to `/login?next=/invite/…` and
Google's callback returns there. A new account has no username yet, so the invite page sends it to
`/onboarding?next=/invite/…`, and onboarding now follows `next`. It goes through `safeRedirectPath` again in the
action, since a hidden form field is just as editable as a URL (open redirect).

### Not now (backlog)

Transferring ownership, an admin role, changing a team's address, email invites (domain day), a team picture.

## 2. Likely interview questions

- **How do you model roles?** A role column on the membership row, a composite primary key, and a partial unique
  index for "one owner". Rules in Postgres where they can be; the rest in one module, tested per role.
- **How do you stop someone changing a team they don't own?** The role check is part of the write's `WHERE`
  (subquery on memberships), so check and write are one statement. Outsiders get "not found", never "forbidden".
- **Two people use the same single-use link at once?** One conditional `UPDATE … WHERE still open`; the database
  serializes it. Proven with ten parallel joins on real Postgres: exactly one gets in.
- **A member cap with concurrent joins?** Lock the parent row (`FOR UPDATE`), then count. The conditional update
  can't help: the race is across different rows (different links).
- **Why does opening an invite link not join you?** GETs must be safe: link previews and scanners fetch URLs.
- **Why hash invite tokens?** They're credentials. Hash what you only verify; encrypt only what you must send
  again (the Day 17 rule).
- **Why a 404 for a team you're not in?** A 403 would confirm the team exists (an enumeration oracle).

## 3. Stories (problems hit and how they were solved)

### 1. A team of 20 that took 22 people

**Problem:** the join counts the members and adds one if there's room. The race test fills a team to 19 and
uses five different invite links at the same instant. Without a lock, three of the five got in: a team of 22,
with a "maximum 20" rule in the code.

**What I did:** the single-link race was already safe (the conditional UPDATE), but that only serializes writes
to the same row, and five links are five rows. The cap is about the team, so the team's row is locked first
(`SELECT … FOR UPDATE`) and joins to one team take turns. Re-run: exactly one joins, four get "team full", and
their links still work (the rollback undid their claims). Removing the lock makes the test fail every time; with
it, it passed every run.

**Lesson:** a conditional update protects one row. A limit across many rows ("at most N children") needs a lock on
something they share, usually the parent row. And a cap race shows up only on a real database with real
connections, so that test runs on Postgres, not PGlite.

### 2. A username that sent guests to the login page

**Problem:** adding `/invite` to the login-protected paths, I read the check:
`pathname.startsWith("/dashboard")`. That also matches `/dashboard-fan/intro`. `dashboard` is a reserved
username, but `dashboard-fan` isn't, so that host's booking page would have sent every guest to log in. The same
for `/onboardingx`, and now `/invitebot`.

**What I did:** `isProtectedPath` in `src/lib/app-routes.ts` compares the whole first path segment against a set
(`dashboard`, `onboarding`, `invite`). Unit tests cover both sides: deep paths still protected, usernames that
start with a protected word public.

**Lesson:** URL rules match path segments, not string prefixes. Here a prefix check was quietly wrong for any
username starting with a protected word.

### 3. Link previews and single-use links

**Problem (caught while designing):** the obvious version of an invite link joins you when you open it. Chat
apps and mail scanners open links first to build a preview, so the preview would have used the link, and the
person it was meant for would get "already used".

**What I did:** opening the link only reads (team, who invited, what's shared). Joining is a POST behind a button.
A unit test previews a link three times and then joins with it; the E2E test reloads the page before joining.

**Lesson:** GET requests must be safe to repeat. The rule matters most for anything single-use: magic links,
invites, unsubscribe and confirm links.

## Next

Day 29: collective team event types. A team event type's free times are the intersection of every member's free
times (each with their own hours, timezone, bookings and Google Calendar), on `/team/{slug}/{event}`. The booking
goes into every member's calendar.
