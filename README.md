# MeetReady

A Calendly-style meeting scheduler: hosts define event types and weekly availability, share a link, and
guests book a time shown in their own timezone. Double booking is prevented by the database itself.

> v2: a solo rebuild of a 2024 university group project. See [Credits](#credits).

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript (strict) · PostgreSQL on Neon · Drizzle ORM · Better Auth (Google) · Zod · shadcn/ui-style components (Radix) · React Hook Form · date-fns +
`@date-fns/tz` · Vitest + fast-check · PGlite (in-process Postgres for tests) · GitHub Actions

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
| `npm run typecheck` / `lint` / `format:check` | Same checks CI runs                                             |
| `npm run db:generate`                         | New migration from `src/db/schema.ts`                           |
| `npm run db:studio`                           | Browse the database                                             |

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

## Credits

MeetReady v1 (Jan–Feb 2024) was built by a team of about 10 students at IIUC:
[SakifAzwad/Meet-Ready](https://github.com/SakifAzwad/Meet-Ready). v2 keeps the idea and rewrites the code.
