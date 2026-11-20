# Day 25 (Part A): Insights and no-shows

**Result:**

- **A new Insights page** (`/dashboard/insights`, in the nav) shows how a host's meetings went over the last 4
  weeks, 3 months or 12 months:
  - four tiles: meetings, the cancellation rate (by guests or by you), the no-show rate, and how many were booked
    through an assistant;
  - meetings per week (per month for a year), split into held, no-show and cancelled;
  - popular times: a weekday × hour grid under the day's own sky;
  - meetings per type, busiest first.
- **Everything is grouped in the host's timezone, by Postgres.** A meeting at 12:30 AM in Dhaka counts on that
  Dhaka day and in that week, not the UTC one.
- **No-shows:** on Bookings → Past, "Didn't show up" marks a meeting, and "Undo no-show" takes it back. No email.
  The no-show rate in Insights comes from these marks.
- **Claude sees it:** `list_bookings` and `get_booking` now return `noShow` (read-only). There's no tool to mark one.
- **Charts are hand-built** (HTML and CSS, no chart library). Each mark has a hover and keyboard-focus tooltip, and
  each chart has a table view. The colours were checked with the dataviz validator in both themes.
- **Phones:** the nav fits five links (short labels "Types" and "Hours" on small screens only), and the 24-hour grid
  scrolls inside its card instead of widening the page.
- **Tests:** 737 unit tests (17 new) and 37 E2E tests (2 new: mark a no-show, see it in Insights, undo
  it; and the empty state). The new E2E spec passed 3 times in a row. Typecheck, lint, format, `drizzle-kit check`
  and the build are green.
- **Setup:** none in Vercel. Migration 0012 runs in the build.

```
src/db/schema.ts, drizzle/0012_*        # bookings.no_show_at + a check: only a confirmed booking can be a no-show
src/server/manage-booking.ts            # setNoShow (host-scoped, only after the meeting ended); noShowAt on rows
src/app/(app)/dashboard/bookings/       # "Didn't show up" / "Undo no-show" on Past; the badge; setNoShowAction
src/server/insights.ts                  # insightsPeriod (pure) + getInsights: grouped SQL in the host's timezone
src/lib/insights-format.ts              # axis ticks, percentages, week and month names, heat steps
src/app/(app)/dashboard/insights/       # the page, the charts, the tooltips (the only browser code)
src/app/globals.css                     # --chart-1..3: three validated steps of one navy, light and dark
src/app/(app)/dashboard/dashboard-nav.tsx  # Insights link; short labels on phones
src/server/mcp/tools.ts                 # noShow on list_bookings and get_booking
src/app/privacy/page.tsx                # guests: a host can mark that you didn't show up
e2e/insights.spec.ts, e2e/shots/        # the browser test; history seeded for the README's Insights screenshot
```

## 1. Decisions (Sakif's picks, from the options proposed)

### No-shows are a column, not a status

- `no_show_at` (nullable timestamp), not a third `status`. The booking is still a confirmed booking; the column
  records what happened at the meeting. A new status would have touched every `status = 'confirmed'` query, the
  no-overlap constraint (it only applies to confirmed rows) and the reminder sweep.
- **A database check backs it up:** `no_show_at is null or status = 'confirmed'`. A cancelled meeting never took
  place, so it can't be missed, even if some future code tried.
- **Only after the meeting has ended, and only the host's own.** `setNoShow` is one `UPDATE` with every condition
  in the WHERE (id, host, confirmed, ended), like cancelling: no read-then-write gap. Another host's id looks
  missing. Marking twice keeps the first time (`coalesce`).
- **One click, undoable, no email.** Unlike a cancel, it reaches nobody outside MeetReady, so it needs no confirm
  step. Telling a guest "you didn't show up" is the host's call, not the app's.

### Insights counts by meeting date

- The question is "how did my meetings go", and a no-show only exists on the day of the meeting. So a meeting
  counts in the week it was for, and only once its time has come. A cancellation shows up in the week the meeting
  would have been, not the week someone clicked Cancel.
- **The rates have honest denominators:** cancelled is a share of all meetings, and no-shows a share of the ones not
  cancelled. With nothing to divide by, the tile shows a dash, not "0%".

### Grouped in the host's timezone, by Postgres

- `starts_at at time zone 'Asia/Dhaka'` gives the wall-clock time there; `date_trunc('week' | 'month', …)`,
  `extract(isodow …)` and `extract(hour …)` come from that. Grouped in UTC, a meeting at 12:30 AM in Dhaka would
  land on the previous day, and sometimes the previous week. A test pins exactly that case.
- The zone is a **bound parameter**, never spliced into the SQL, even though it comes from our own database.
- **No new index:** every query is `host_id = ? AND starts_at in [from, now)`, which the `(host_id, starts_at)`
  index from Day 1 already covers. Four small grouped queries run in parallel.
- **The calendar arithmetic is pure and tested on its own:** `insightsPeriod` gives Monday-start weeks or
  first-of-month months on the host's clock, empty ones included (a quiet week is information too).

### Hand-built charts, by the dataviz rules

- No chart library: stacked columns, a grid and a few bars are small HTML and CSS. Server-rendered, nothing to
  download, and they follow the design tokens.
- **Colour still means time of day only.** The three outcomes are steps of one navy (`--chart-1..3`), told apart by
  lightness, a legend, a fixed order (held at the bottom), tooltips and a table. The validator's categorical mode
  failed them (it expects different hues), so they were checked as an **ordinal ramp**, which they are: held →
  missed → cancelled. They pass in both themes, with the dark ones chosen for the dark card, not flipped.
- **The one place colour is time of day:** a strip of today's sky over the popular-times grid, the same gradient as
  the dashboard's bands.
- **Marks:** bars at most 24px wide, square at the baseline and 4px rounded at the top, 2px gaps between stacked
  parts, hairline gridlines, clean ticks (1, 2 or 5 × 10ⁿ).
- **Nothing hides behind a hover:** the tooltips (hover and keyboard focus) repeat what's in each chart's table.
  Each chart card is a named region, so screen readers can jump between them.

## 2. Likely interview questions

- **"How do you group by day for a user in another timezone?"** In the database: `starts_at at time zone $tz`, then
  truncate or extract from that. Grouping in UTC puts late-night meetings on the wrong day. The zone is a
  parameter, and a test checks a meeting at 1 AM Dhaka (7 PM UTC the day before) lands on the Dhaka day.
- **"Why a column for no-shows instead of a status?"** A status describes the booking; attendance describes the
  meeting. A third status would change the meaning of every query and constraint that assumes "confirmed or
  cancelled". A check constraint keeps the two consistent.
- **"Does this need an index?"** No: every query is a range on `(host_id, starts_at)`, the index the booking flow
  already uses. I'd look at `EXPLAIN` before adding one.
- **"Why GROUP BY 1?"** See the first story: the expression holds a bound parameter, and Postgres can't prove two
  parameters are the same value.
- **"Why not a chart library?"** Three simple chart types, server-rendered, in the design system's tokens. A
  library would add weight and a second styling system for little gain. I followed the dataviz rules by hand:
  validated colours, a legend, a table view, tooltips on focus too.

## 3. Stories (problems hit and how they were solved)

### Postgres refused a GROUP BY it couldn't prove

- **What happened:** the weekly query selected `to_char(date_trunc('week', starts_at at time zone $1), …)` and
  grouped by the same expression. Postgres answered that `bookings.starts_at` "must appear in the GROUP BY clause".
  The expressions looked identical, but Drizzle sends each use of the timezone as its own parameter (`$1` in
  SELECT, `$5` in GROUP BY), and Postgres can't know two parameters will hold the same value.
- **What I did:** grouped by position (`GROUP BY 1`, and `1, 2` for weekday × hour). Then I put the expression back
  once to watch the test fail with that exact error, so the comment in the code is a fact, not a guess.
- **Lesson:** parameters are opaque to the planner. When an expression holds one, refer to it by position (or a
  subquery alias), not by repeating it.

### The validator's first answer was "fail", and it was right to ask

- **What happened:** the first palette check ran in categorical mode, and the three navy steps failed: lightness
  band, chroma floor. The design's rule (colour means time of day) rules out different hues. Then the popular-times
  grid needed four steps, and the lightest one failed contrast against the card (1.6:1, below 2:1).
- **What I did:** the outcomes have an order (held → missed → cancelled), so I checked them as an ordinal ramp: one
  hue, monotone lightness, visible gaps, the lightest step at 3:1 or more. All pass, in both themes. The grid uses
  the same three steps, with empty cells drawn as a neutral track instead of a fourth colour.
- **Lesson:** run the validator in the mode that matches what the colours encode. A failure in the wrong mode is a
  question about the encoding, not a reason to tweak hex values until it goes green.

### The fifth link and the 24-hour grid didn't fit a phone

- **What happened:** screenshots at 390px showed two things: "Insights" cut off at the end of the nav (it scrolled
  sideways, but nothing said so), and the popular-times grid making the whole page wider than the screen.
- **What I did:** the two longest links get short labels on phones only ("Types", "Hours"), with the full name kept
  as the accessible name. The grid was in a two-column layout whose track was sized by its content, so I first
  gave it `minmax(0, 1fr)` (the handoff's rule). Then the desktop screenshot showed the 24 hours didn't fit beside
  the meeting types either, so the charts are now stacked full width. A check that the page is no wider than
  390px passed on the final build; the grid scrolls inside its own card on phones.
- **Lesson:** a grid track sized by its content lets one wide child push the whole page. Look at every new page
  at phone width, and measure (`scrollWidth`) rather than trusting the screenshot alone.

## Next

- **You:** unzip, commit and push Part A (migration 0012 runs in the build). On the live site: mark a past meeting
  as a no-show on Bookings → Past, then check the tile on Insights.
- **Then Part B: the Move button** on upcoming bookings, reusing the booking widget in a host mode.
