# Day 9: Real daylight, scrubbing, and review fixes

**Result:** 331 tests (26 new), typecheck, lint, format, `drizzle-kit check` and production build green. All
browser scripts from Days 3–8 pass again, plus a new Day 9 script, against the production build and real
Postgres: no console errors, no horizontal scroll. No migration. Still not deployed. Everything deferred from
the reviews is now listed in [backlog.md](backlog.md).

```
src/lib/scheduling/
├── sun.ts             # NOAA solar equations: elevation, sunrise/sunset, civil twilight, polar days
├── sky.ts             # skyGradient(zone, range), sunSummary(), darkness()
├── readout.ts         # what the scrub marker says about a moment
└── daylight.ts        # + isInDaytime(), splitByDaytime()
src/components/
├── daylight/band.tsx  # gradient prop (real sky), markerAt; shiftHours removed
├── daylight/scrub.tsx # useScrub() + ScrubBand: hover, drag, keyboard slider
└── copy-button.tsx    # one copy button with clear feedback
src/app/[username]/[slug]/
├── time-list.tsx      # night times folded away
├── steps.tsx          # focus on the step, typed details kept
└── booking-widget.tsx # 12h/24h beside the date; draft kept across steps
docs/backlog.md        # everything deferred or decided against, with reasons
```

## 1. Review fixes

- **3 AM is no longer the first thing a guest reads.** Times outside the guest's daytime (8 AM–8 PM) fold into
  one line: "Show 10 earlier times, 3–7:30 AM".
  - It's a disclosure button (`aria-expanded`/`aria-controls`).
  - A fold opens by itself when it holds the selected time.
  - Changing day folds it again.
  - If nothing is in daytime (New York), nothing is folded: hiding the whole day would be worse.
  - `splitByDaytime` is pure and tested.
  - The landing page preview passes the whole day now, because its old "first 6 times" were all folded.
- **Focus follows the step.** Continue used to remove the button you'd just pressed, so keyboard focus fell to
  the page. Now:
  - on wide screens, focus goes to **Name**, so you can type straight away;
  - on phones, it goes to the "Your details" heading, because focusing an input opens the keyboard and jumps
    the page;
  - going back, focus returns to the time you chose.
- **Typed details are kept.** If someone books your time while you're typing, or you go back to pick another,
  your name, email and notes come back with the form. The notice says so: "your details are kept".
- **12h/24h follows the browser.** The default comes from the browser's locale (`Intl` reports `h23` for en-GB
  and de-DE), so most of Europe gets 24-hour times without finding any toggle. An explicit choice is saved and
  wins. The toggle moved from the footer to beside the date, where the times are read.
- **Copy feedback:** "Copied to clipboard" with a tick, the button fills navy and pops once. A separate status
  line tells screen readers (`aria-live` on the button itself isn't reliably read). One `CopyButton` now serves
  both the booking link and the share text.
- **"Before sunrise" became "Early hours".** It meant "before 6 AM", which isn't before sunrise in June. With real
  sun data on the page, the label had to stop claiming astronomy.

## 2. Real sunrise and sunset

- **What changed:** every band (booking page, landing page, dashboard week, login sample) now shows the real sky
  for its city and date. London in November has a short day ending at 4:18 PM; in June it runs until 9:21 PM;
  Svalbard in December has none.
- **`sun.ts`:** NOAA's solar calculator equations (after Meeus), pure maths with no API.
  - `solarPosition`: the sun's elevation and hour angle at an instant.
  - `sunDay`: sunrise, sunset and civil twilight around one solar noon, including the polar cases ("never
    rises", "never sets") and white nights (it sets, but never gets darker than twilight).
  - Tested to **±3 minutes** against published times: London at both solstices, Sydney in December, Reykjavík's
    00:03 sunset, Svalbard's polar night and midnight sun, and the equator's 12-hour days.
- **Coordinates:** from the tz database's `zone.tab`, generated on Day 8. No location permission: it's the sky
  over the timezone's main city, which is close enough for colours. The backlog notes the limit.
- **`skyGradient(zone, range)`** turns sun events into CSS gradient stops, positioned in **real elapsed time**
  across the band, like the brackets.
  - That one idea removed a special case: the landing page draws the host's sky on the visitor's timeline by
    calling the same function with the host's zone. `shiftHours` (Day 6's sliding-strip trick) is gone.
  - CSS accepts stops outside 0–100%, so the gradient includes the neighbouring days and both ends are right.
  - Zones with no place (UTC) fall back to the old symbolic day.
- **A line under the booking band** says where the colours come from: "Sunrise 7:10 AM, sunset 4:18 PM in
  London."
- **Daytime is still 8 AM–8 PM.** "In your daytime" is about social hours, not the sun. Someone in Helsinki in
  December still takes 9 AM calls in the dark.

## 3. Scrubbing the band

- **What it does:** move along any booking or landing band to read a moment:

```
2:00 PM for you
1:00 AM in Dhaka, before sunrise
Outside Sakif's working hours
```

- **Every input does the same thing:**
  - **Mouse:** hover moves the marker; leaving hides it.
  - **Touch:** press and drag; the marker stays when you lift, so you can read it. `touch-action: pan-y` lets a
    vertical swipe still scroll the page.
  - **Keyboard:** the band is a `role="slider"`. Arrows move ±15 minutes, Page Up/Down ±1 hour, Home/End go to
    the ends. The readout is the slider's `aria-valuetext`, so a screen reader hears the sentence, not "51%".
- **On the landing page,** one state drives both bands, so the marker crosses both people's days at the same
  instant. Only one band is the slider; the other follows without being a second tab stop.
- **The badge never leaves the band,** without any measuring: it sits at `left: at%` with
  `transform: translateX(-at%)`, so it's left-aligned at the left edge and right-aligned at the right.
- **Wording (`momentReadout`, tested):**
  - "after sunset" / "before sunrise" / "at dusk" come from the real sun (`darkness()`, using the sun's hour angle
    for morning versus evening).
  - "Outside Sakif's working hours" is what we know. We don't know if he's off work, so it doesn't say so.

## 4. Likely interview questions

- **"How do you compute sunrise?"** NOAA's equations: the sun's declination and the equation of time from the
  date, then the hour angle at which the sun is 0.833° below the horizon (refraction plus the sun's radius).
  If the cosine of that angle is outside [−1, 1], the sun never gets there that day: polar night or midnight
  sun. Tested against published tables.
- **"Why not a sunrise API?"** It's about 130 lines of pure maths, comments included. An API would add latency, a failure mode and a
  key for something that never changes, and it couldn't run while the page renders.
- **"How is your slider accessible?"** `role="slider"` with min, max, now and a human `aria-valuetext`; arrow,
  Page and Home/End keys; the readout is the same text as on screen.
- **"Where does focus go when a step changes?"** To where the user's next action is (the first field), except on
  phones, where it goes to the heading so the keyboard doesn't jump the page. Going back restores it to what
  they'd chosen.

## 5. Stories (problems hit and how they were solved)

### A library constructor read the clock

- **What happened:** the build failed: "`new Date()` while prerendering /login". The login page's sample bands
  call `skyGradient`, and nothing in it reads the clock.
- **Why:** it called `dateKeyInZone(…, "UTC")` to get a UTC date. That builds a `TZDate` from `@date-fns/tz`,
  whose constructor runs `new Date()` and only then sets the real time. Next.js can't tell the difference: any
  clock read during a static render is an error.
- **What I did:** UTC dates now come straight from `toISOString()`, and the login sample's day is written out (London
  is on GMT in November). Comments at both places say why.
- **Lesson:** Cache Components check what your code _does_, including inside libraries. A read of the clock
  you didn't write still counts.

### Svalbard came out as Oslo

- **What happened:** the Svalbard tests expected polar night and got an ordinary Oslo winter day.
- **Why:** the tz database lists `Arctic/Longyearbyen` both as a zone with its own coordinates and as a link to
  `Europe/Oslo`. The Day 8 generator let the link win. Eleven names were affected.
- **What I did:** a name that's a zone in its own right keeps its own row. Fixed in the generator, then
  regenerated.
- **Lesson:** the polar tests caught a data bug that no ordinary city would have shown. Edge-case tests pay off
  beyond the edge case.

### The test helper skipped the dusk colour

- **What happened:** one gradient test failed with "cannot read 'pos'". The helper that parsed gradient stops
  used a regex that stopped at the first `)`, so it silently dropped every `color-mix(… var(--dusk) …)` stop.
- **What I did:** fixed the regex, and added an assertion that the helper sees **every** stop (one per `%,`), so
  it can't drop things quietly again.
- **Lesson:** test helpers are code too. If they can lose data without failing, sooner or later a test will
  pass for the wrong reason.

### Browser scripts assumed everyone uses AM/PM

- **What happened:** after the 12h/24h default, many browser scripts failed. They ran with locale `en-GB`, and
  British browsers report 24-hour clocks.
- **What I did:** set the scripts to `en-US` where they check AM/PM text. A new script checks the behaviour
  itself: en-GB and de-DE get 24h, en-US gets 12h, and a saved choice wins after a reload.
- **Lesson:** the scripts had an assumption built in that the product just stopped making. When a default
  changes, check what your tests took for granted.

### A hard-coded "4:00 AM" in the manage script

- **What happened:** the Day 5 reschedule check waited for "4:00 AM" in the side panel. Now that night times are
  folded, the guest picks from daytime times, so the time it chose was different.
- **What I did:** the script reads the time it clicks and waits for exactly that. Nice side effect, visible in
  the logs: the first booking a London guest makes is now 8:00 AM instead of 3:00 AM.
- **Lesson:** a test should check the relationship ("the panel shows the time I chose"), not a value that only
  happened to be true.

### A test that passed at 6 AM and failed at 7

- **What happened:** the new Day 9 script passed, then failed an hour later on the same code. It used "today",
  and once London's 7:30 AM had passed, there was nothing left to fold.
- **What I did:** it now picks the next available day, where the full 3:00–10:30 AM range always exists.
- **Lesson:** anything that depends on "now" needs a fixed point. The unit tests inject `now` for exactly this
  reason (Day 1); the browser scripts have to choose their dates just as carefully.

### "Morning" twice

- **What happened:** in the recording, opening the fold showed 7:30 AM under "Morning", then 8:00 AM under a
  second "Morning".
- **Why:** the folded rows and the daytime rows were grouped separately.
- **What I did:** when the open fold ends in the same part of day the daytime list starts with, the second
  heading is skipped.
- **Lesson:** another one only the recording showed. Splitting a list in two needs care where the pieces meet.

### My own edit deleted a function

- **What happened:** replacing the login sample's code, I matched "from this comment to the end of the file",
  which also removed `SignIn`, the function after it. TypeScript caught it at once ("Cannot find name
  'SignIn'"), and I restored it from the last commit.
- **Lesson:** "to the end of the file" is a dangerous edit boundary. Committing after every day is what made the
  fix a one-liner.

## Next

- **After Day 9, UI polish stops for now.** Next is custom booking questions, then the browser tests in CI, then
  deploy after your review. See [backlog.md](backlog.md) for the order and everything waiting.
