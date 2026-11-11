# MeetReady

A Calendly-style meeting scheduler: hosts define event types and weekly availability, share a link, and
guests book a time shown in their own timezone. Double booking is prevented by the database itself.

> v2: a solo rebuild of a 2024 university group project. See [Credits](#credits).

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript (strict) · PostgreSQL on Neon · Drizzle ORM · Better Auth (Google) · Zod · shadcn/ui-style components (Radix) · React Hook Form · date-fns +
`@date-fns/tz` · Vitest + fast-check · Playwright · PGlite (in-process Postgres for tests) · GitHub Actions

## Getting started

```bash
npm install
cp .env.example .env.local   # Next.js
cp .env.example .env         # drizzle-kit
# fill in DATABASE_URL, BETTER_AUTH_SECRET and the Google OAuth client (see .env.example)

npm run db:migrate           # applies drizzle/*.sql (incl. the no-overlap constraint)
npm run dev
```

## Scripts

| Script                                        | What it does                                                    |
| --------------------------------------------- | --------------------------------------------------------------- |
| `npm test`                                    | Unit, property-based and database tests (no external DB needed) |
| `npm run test:e2e`                            | Browser tests: production build + real Postgres (see below)     |
| `npm run typecheck` / `lint` / `format:check` | Same checks CI runs                                             |
| `npm run db:generate`                         | New migration from `src/db/schema.ts`                           |
| `npm run db:studio`                           | Browse the database                                             |

## End-to-end tests

Playwright drives Chromium through the real flows (booking, the two-guest race, reschedule/cancel from the email
link, booking questions, phone layouts) against `next build` + `next start` on port 3100 and a throwaway database.

```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17   # or any local Postgres
npx playwright install chromium                                        # once
npm run test:e2e                                                       # wipes and migrates meetready_e2e, builds, runs
```

`E2E_SKIP_BUILD=1` reuses the last build; `E2E_BROWSER_CHANNEL=chrome` uses your installed Chrome;
`E2E_DATABASE_URL` points elsewhere (its database name must contain `e2e`). Failures keep a trace:
`npx playwright show-trace test-results/<test>/trace.zip`.

## Design notes

- [Day 1: setup, schema, slot generation](docs/day-01.md): timezone model, DST handling, the exclusion
  constraint, and why slot generation is a pure function.
- [Day 2: Google login, onboarding, authorization](docs/day-02.md): sessions, the three authorization
  layers, username rules, open-redirect protection.
- [Day 3: Event types and availability](docs/day-03.md): owner-scoped CRUD (IDOR tests), transactional
  schedule saves, forms with shared Zod schemas, and the bugs a real-browser run found.
- [Day 4: The public booking page](docs/day-04.md): three layers against double booking (re-check, per-host
  advisory lock, exclusion constraint), proven with deterministic race tests on real Postgres.
- [Day 5: Emails, invites, cancel and reschedule](docs/day-05.md): hashed guest manage tokens, `.ics` invites
  (UID/SEQUENCE/METHOD), emails sent with `after()`, a migration that's safe on existing data.
- [Day 6: Design, "Daylight"](docs/day-06.md): a design system where colour means time of day, the daylight
  band (same code as slot generation), two timezones on one timeline, landing page and dashboard.
- [Day 7: Brand, landing page and motion](docs/day-07.md): a logo built from the band, icons and link
  previews, a full landing page, account menu, 404/error pages, and view transitions that explain each change.
- [Day 8: UX upgrades from review](docs/day-08.md): timezone search from tz database data, the booking form
  in place, "in your daytime", week paging with booked/free hours, and "share times by text".
- [Day 9: Real daylight and scrubbing](docs/day-09.md): NOAA sunrise/sunset on every band (polar cases
  tested), hover/drag/keyboard time comparison, night times folded away, focus and 12h/24h fixes.
- [Day 10: Custom booking questions](docs/day-10.md): questions as jsonb on the event type, answers stored as a
  snapshot, one Zod schema built from the questions on both sides, and an ETag-style version for questions that
  change mid-booking.
- [Day 11: Browser tests in CI](docs/day-11.md): Playwright against the production build and real Postgres, a
  fresh host per test so everything runs in parallel, signed-in sessions without Google, and the bugs it found.
- [Backlog](docs/backlog.md): everything not built yet, with the reason and when it fits.
- [Handoff](docs/handoff.md): one-page summary of the state, conventions and gotchas, for picking the work up fresh.

## Credits

MeetReady v1 (Jan–Feb 2024) was built by a team of about 10 students at IIUC:
[SakifAzwad/Meet-Ready](https://github.com/SakifAzwad/Meet-Ready). v2 keeps the idea and rewrites the code.
