# Day 6: Design — "Daylight"

**Result:** 251 tests (22 new), typecheck, lint, format, `drizzle-kit check` and production build green. Browser
runs against the production build and real Postgres: booking, race, manage, reschedule, cancel and the
dashboard flows all pass after the redesign. Screenshots in London, New York, Dhaka, Kolkata, Tokyo, 24-hour
mode, dark mode and mobile: no horizontal overflow, no console errors. No migration today.

```
src/
├── app/
│   ├── globals.css                      # Daylight tokens (light + dark), fonts, accent-color
│   ├── layout.tsx                       # Bricolage Grotesque + Figtree (self-hosted, no Google Fonts call)
│   ├── page.tsx                         # landing page
│   ├── _landing/hero-bands.tsx          # two bands on one timeline (the hero demo)
│   ├── [username]/[slug]/               # booking page, split by job:
│   │   ├── booking-widget.tsx           #   state + layout
│   │   ├── facts-panel.tsx              #   left panel: length, where, both clocks
│   │   ├── daylight-band.tsx            #   "your day in {city}" with the host's hours on it
│   │   ├── time-list.tsx                #   times grouped by part of day, two clocks per row
│   │   ├── month-calendar.tsx           #   real <table>, aria-current="date"
│   │   └── steps.tsx                    #   details form, reschedule confirm, confirmation
│   └── (app)/dashboard/
│       ├── page.tsx                     # link + copy, next 7 days, coming up
│       └── week-glance.tsx              # seven daylight bands with hours and meetings
├── components/daylight/
│   ├── band.tsx                         # the band itself (shared by all three pages)
│   └── preferences.ts                   # 12h/24h + minute clock (useSyncExternalStore)
└── lib/scheduling/
    ├── daylight.ts                      # pure: band segments, now position, part of day, offsets, city names
    └── generate-slots.ts                # + availabilityWindows(), now shared by slots and the band
```

## 1. How the direction was chosen

I mocked four directions as real HTML pages and compared screenshots, rather than describing them in words:

- **A, Departures:** an airport-board look. Strong at facts (both clocks, length, where) but cold.
- **B, Daylight:** each guest's day drawn as a band from night to dawn to day to dusk, with the host's hours on
  it. It answers the question guests actually have: "is this 3 AM for me?"
- **C, Rickshaw:** a playful, Dhaka-flavoured look. Memorable, but it fought the content.
- **D:** B's band combined with A's facts panel and A's two clocks on every time row. This is the one we built.

**Why it fits this product:** the hard part of MeetReady is timezones, so the design makes time of day visible.
That is the identity. Using a decoration like a gradient blob or an illustration would not do that.

## 2. The system

### Colour has one meaning: time of day

| Token       | Hex       | Used for                                 |
| ----------- | --------- | ---------------------------------------- |
| `night`     | `#1d2540` | night on the band; also the ink colour   |
| `dawn`      | `#f4b183` | dawn; the "Continue" button on a time    |
| `day`       | `#e3eefb` | day on the band; available calendar days |
| `afternoon` | `#7fa7e0` | part-of-day dot                          |
| `dusk`      | `#8b6cc2` | dusk; focus ring                         |
| `primary`   | navy      | buttons and selected state               |

- **The rule:** colour means time of day and nothing else. Buttons are navy ink, not a brand colour. Two
  deliberate exceptions: the "Continue" button on the chosen time is dawn-coloured so the next step stands
  out, and the focus ring is dusk so it's visible on both light and navy surfaces. When the
  "today" ring on the calendar was dawn-coloured, it broke the rule (it said "dawn", not "today"), so it became
  a neutral ring.
- **The colours are symbolic, not astronomy:** dawn is always at the same place on the band. The point is
  "3 AM is night for you", not "sunrise in London is at 7:12".
- **Dark mode keeps day light:** the band has its own tokens (`--band-day`, `--band-noon`) that stay light in
  dark mode. If "day" turned dark too, the band would stop meaning anything.

### Type

- **Bricolage Grotesque** (display): headings and the big times. Its optical-size axis tightens at large sizes.
- **Figtree** (text): everything else. Plain and very readable at small sizes.
- **Self-hosted with `@fontsource-variable`**: no request to Google Fonts. That is faster, it works offline in
  CI, and there is one less third party (Day 1 story: Google Fonts failed offline).
- **Tabular figures only on times**, so columns of times line up. Turned on globally, they spaced out
  punctuation in normal text.

### Template tells avoided on purpose

- No middle-dot meta strings ("30 min · Zoom · Dhaka").
- No all-caps eyebrow labels.
- No row of identical cards.
- Numbers (1, 2, 3) only where the content really is a sequence ("How it works").

## 3. The band (`lib/scheduling/daylight.ts`)

- **One function for both answers:** `availabilityWindows(range, host)` returns the host's working windows as
  UTC intervals (weekly rules plus date overrides, bookings not subtracted). `generateSlots` now calls it too,
  so **the band and the bookable times can't disagree**. They come from the same code.
- **`bandSegments(windows, day, tz)`:** clips each window to the guest's day and turns it into positions from
  0 to 100.
  - Positions are measured in **real elapsed time**, so a 23-hour or 25-hour DST day still maps correctly.
  - A host day that crosses the guest's midnight becomes **two segments**. Dhaka 9–5 seen from New York is
    10 PM to midnight on one day and midnight to 6 AM on the next.
- **The API returns `{ slots, windows }`:** the booking page gets the windows it draws from the server instead of
  re-deriving availability in the browser.
- **Accessible:** the band is `aria-hidden` and always paired with a sentence: "Sakif works 9 AM–5 PM in
  Dhaka, which is 3–11 AM your time."
- **Tested like the slot generator:** 17 tests covering midnight crossings, DST days, now position, part of day
  and offsets.

### Two bands on one timeline (landing page)

- **The idea:** the host's day and the visitor's day are stacked. A vertical line through both bands is **one
  moment**. Only the colours differ, because each band shows its own person's local time.
  - The working-hours brackets are the same instants, so they line up.
  - They sit in daylight on the host's band, and often in night on the visitor's band.
- **How:** `Band` takes `shiftHours`. The gradient is drawn twice in a 200%-wide strip and moved sideways by the
  time difference, so it never shows a gap. The brackets aren't shifted, because they are instants on the
  shared axis.
- **Honest demo:** the host is illustrative (Mon–Fri 9–5 Dhaka), but it runs through `availabilityWindows`,
  the real scheduling code.

## 4. Pages

- **Booking page:**
  - **Facts panel:** length, where, the host's local time now, and your local time now (hidden if you share a
    timezone).
  - **Band:** your day in your city, with the host's hours on it.
  - **Times grouped by part of day:** "Before sunrise", "Morning" and so on, each with a coloured dot. Every
    row shows two clocks: your time large, and the host's time small.
  - **Two-step choice:** picking a time selects it, then a "Continue" button appears. This stops an
    accidental tap from jumping to the form.
  - **12h/24h toggle:** saved in `localStorage`.
- **Landing page:**
  - The two-band demo, with "See it from London / New York / Tokyo…" buttons to try other cities.
  - "How it works" in three steps.
  - "Under the hood" for engineers, next to the real `EXCLUDE` constraint.
  - "See a live booking page" appears only if `DEMO_BOOKING_PATH` is set.
- **Dashboard:**
  - Your booking link with **Copy** and **Open**.
  - **Your next 7 days** as seven bands in your own timezone: outlined working hours (date overrides
    included), filled booked meetings, and the now line.
  - **Coming up:** the next three meetings, each with the guest's local time ("3:00 AM for them in London").
- **Everything else:**
  - Login, onboarding and the manage page moved from hard-coded greys and blues to tokens.
  - One heading style everywhere.
  - Native radios and checkboxes use `accent-color`, so they are navy instead of browser blue.
  - Time pickers say "9:00 AM", matching the booking page (they said "9:00am").
- **Emails:** the same palette as plain hex (email clients don't support CSS variables), a navy button, a
  system font stack (web fonts are unreliable in email), and sentence-case labels.

## 5. React details worth knowing

- **`useSyncExternalStore` for browser-only values:** used for the visitor's timezone, the 12h/24h choice and
  the minute clock.
  - The server snapshot is `null`, so the server renders a skeleton of the same shape.
  - Nothing guesses a timezone, there's no hydration mismatch, and nothing jumps when the real value arrives.
  - With `useState` + `useEffect`, the first render would show a wrong default and then flash.
- **`localStorage` can throw** (private mode, blocked storage, iframes), so reads and writes are in try/catch.
  The choice still applies to this page through a custom event.
- **City names:** Chrome still reports `Asia/Calcutta`. `cityName()` shows the current names (Kolkata, Kyiv,
  Ho Chi Minh City); the IANA id itself is unchanged.

## 6. Likely interview questions

- **"Why not just show the times in the guest's timezone and be done?"** Converted times are correct but don't
  show cost. "3:00 AM" is easy to miss in a list; a bracket sitting in the dark part of your day isn't. The
  band shows the context, and the sentence makes it accessible.
- **"How do you know the band matches what's bookable?"** Both come from `availabilityWindows`. There is no
  second implementation that could drift.
- **"How do you handle a host day that crosses the guest's midnight?"** It's clipped to the guest's day and
  becomes two segments, one at each end. This has its own test.
- **"Why `useSyncExternalStore` instead of `useEffect`?"** It's React's tool for reading an external source
  (here, the browser), with a separate server snapshot. Hydration matches, and updates from other tabs come
  through the `storage` event.
- **"Why self-host fonts?"** Performance (no extra DNS lookup, connection or blocking CSS), privacy (no
  request to Google), and builds that work offline.

## 7. Stories (problems hit and how they were solved)

### Dark mode made "day" dark

- **What happened:** with the normal dark-mode tokens, the day part of the band turned dark too. The band no
  longer showed day and night.
- **What I did:** gave the band its own colour tokens that stay light in both themes. I then added a faint
  ring, because the night ends disappeared into the dark card.
- **Lesson:** dark mode means inverting the interface, not the meaning. Colours that carry information
  shouldn't flip.

### A function imported from a client file broke a server page

- **What happened:** after the redesign, the host's Bookings page stopped rendering its list. The browser run
  timed out waiting for "Intro call with Ada Lovelace".
- **Why:** `cityName()` lived in a `"use client"` file. A server component that imports from a client file
  doesn't get the function. It gets a reference that can only be rendered as a component, so calling it fails.
- **What I did:** moved `cityName` into the pure `lib/scheduling/daylight.ts`, which both server and client can
  import. The client file now holds only real browser hooks.
- **Lesson:** keep `"use client"` files for things that need the browser. Pure helpers belong in plain modules.

### The browser scripts broke, and that was right

- **What happened:** after the redesign, the Day 4 and Day 5 browser scripts failed. The times list became a
  group, picking a time now needs "Continue", and some text changed.
- **What I did:** updated each script deliberately. I checked that every change came from a UX change I had
  made on purpose, not a bug. Then I ran them all again: booking, race, manage, reschedule and cancel all pass.
- **Lesson:** a redesign is a behaviour change. The end-to-end checks are what prove the flows still work.

### 39px of sideways scroll on mobile

- **What happened:** the landing page scrolled sideways on a 390px phone.
- **Why:** the long line in the SQL code block stretched the grid. A grid with no explicit columns makes its
  single column as wide as its widest content. `overflow-x: auto` on the `<pre>` never took effect, because
  the `<pre>` was never narrower than its content.
- **What I did:** `grid-cols-1`, which is `minmax(0, 1fr)`. The column can now shrink, and the code block
  scrolls inside itself.
- **Lesson:** this is the Day 4 1px-overflow bug again. Grid and flex children default to their content's
  minimum width; `minmax(0, …)` / `min-w-0` is the fix.

### "Sakif's next working day" was a Sunday

- **What happened:** from New York, the landing page said "Sunday, 8 November, Sakif's next working day". Sakif
  doesn't work Sundays. His Monday morning in Dhaka falls on Sunday night in New York.
- **What I did:** changed the label to say what's true from the visitor's side: "Sunday, 8 November. Sakif isn't
  working before then."
- **Lesson:** across timezones, "day" always needs an owner: whose day?

### Meetings disappeared in dark mode

- **What happened:** on the dashboard, booked meetings were drawn in the text colour. In dark mode that is
  light, and it vanished against the band's light daytime.
- **What I did:** the band's colours don't change with the theme, so the marks drawn on it shouldn't either.
  Meetings are now always dark ink.
- **Lesson:** a mark drawn on a surface takes its colour from that surface, not from the page theme.

### An Intl detail I guarded but couldn't reproduce

- **Concern:** some ICU versions put a narrow no-break space (U+202F) between "9:00" and "AM".
  `formatTimeRange` splits on `/\s+/`, which matches it, so "9 AM–5 PM" can't break.
- **Honest status:** Chrome and Node here both output a normal space, so it is a guard, not a fix for a bug I
  saw.
- **Lesson:** say which it is. A guard is fine; claiming it fixed a bug would not be.

## Next

- Deploy to Vercel with Neon.
- Playwright end-to-end tests in CI (today's scripts are the starting point).
- Rate limiting on booking.
- Inngest for email retries and reminders.
- Then the AI features.
