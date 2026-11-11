# Browser check scripts (Days 3–10)

The scripts used to verify each day in a real browser against the production build and real Postgres.
They're **reference material, not CI tests yet**: written quickly, with hard-coded paths from the build machine
(`/home/claude/meetready`, `/tmp/secret.txt`, `/tmp/session-cookie.txt`). The "browser tests in CI" day turns
the important ones into Playwright tests (see `docs/backlog.md`).

| Script                                 | What it checks                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `seed-pg.mjs`, `restart-pg.sh`         | Fresh `meetready_e2e` database, a seeded host, a signed session cookie, `next start` |
| `booking-check.mjs`                    | Guest books; slot disappears; **two guests race for one slot**; 404s; API input checks |
| `manage-check.mjs`                     | Emails + `.ics`, manage link, reschedule (SEQUENCE/UID), cancel both ways, DB state |
| `ui-check.mjs`                         | Event types CRUD and availability editor (Day 3)                                  |
| `onboarding-check.mjs`                 | Timezone combobox on onboarding saves the right zone                              |
| `day8-check.mjs`, `day9-check.mjs`     | Form in place, daytime note, search, week paging, share text; folding, focus, 12h/24h, scrub |
| `day10-check.mjs`                      | Host adds, validates and reorders questions; guest answers; questions change mid-booking; answers in email, dashboard, manage page |
| `vt-check.mjs`                         | Records which view transitions actually run                                       |
| `*-shots.mjs`, `motion*.mjs`           | Screenshots and walkthrough videos                                                |

Requirements: Postgres on 127.0.0.1:5432 (trust auth), `playwright-core`, `pg`, Chrome at `/usr/bin/google-chrome`.
Contexts use `locale: "en-US"` where they check AM/PM text (en-GB browsers default to 24-hour since Day 9).
