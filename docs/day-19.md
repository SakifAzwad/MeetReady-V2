# Day 19: Booking assistant, server side (tool calling over our own slot function)

**Result:**

- **The assistant works end to end on the server:** a guest's sentence ("30 minutes next Tuesday afternoon, I'm in
  London") goes in; up to three real free times and a one-line reply in the guest's language come out. The box on
  the booking page that uses it comes on Day 20.
- **The AI suggests, it never books.** Its only tool, `findTimes`, reads free times through the same slot function
  as the times grid (rules, bookings, buffers, Google Calendar). The guest confirms through the normal booking form.
- **Code does the date arithmetic.** The model turns words into a search (dates, an hour window, a timezone name);
  our code checks the search and turns it into instants with the tested helpers from Day 1.
- **The times shown come from the tool, never from the model's text.** The model can't invent a slot.
- **When the time asked for is full, code finds the nearest times:** the same hours on the following days, else
  any hour. No second model call.
- **Limits:** 10 requests per 10 minutes per IP, 200 a day per host, 100 a day for the app (each request is at
  most 4 model calls, so with the briefs we stay under Groq's free-plan cap). Every request is logged in
  `ai_calls` as `booking_assistant`.
- **Tests:** 614 unit tests (35 new) and the 22 E2E tests, all green, plus 8 new evals (14 in `npm run eval`)
  that need your Groq key. Typecheck, lint, format, `drizzle-kit check` and the build are green.
- **Setup:** none. No migration, no new env var (it uses Day 18's `GROQ_API_KEY`). Nothing changes on the site yet.

Also today: **the first commit's author was "Claude"** (the Day 1 workspace's git identity), so GitHub listed Claude
as a contributor. The history was rewritten with that one commit credited to Sakif (see the story).

```
src/server/ai/assistant.ts       # findTimes, parseSearch, nearestTimes, calendarForModel, pickSuggestions, runAssistant
src/server/ai/ask.ts             # askAssistant: page → event type → budget → run over the real slots → log
src/server/ai/index.ts           # assistantDeps (limits, cached Google busy times, Sentry), assistantEnabled
src/server/ai/assistant.eval.ts  # 8 evals against the real model: dates, timezones, Bangla, injection
src/app/[username]/[slug]/actions.ts  # askAssistantAction (per-IP limit, then the schema)
src/lib/validation/booking.ts    # assistantRequestSchema (message 2–300 characters, a real timezone)
src/server/rate-limit/limits.ts  # ai_assistant_ip, ai_assistant_host, ai_assistant_all
src/test/mock-model.ts           # mockModelSteps: a fake model that plays a script of tool calls and replies
src/test/eval-rate-limit.ts      # evals wait and retry on Groq's 429 (8,000 tokens a minute on the free plan)
```

## 1. Decisions

### Suggest-only (Sakif's call, option A)

- **The tool reads, it never writes.** A booking needs a name, an email, answers to the host's questions, and the
  same checks as every other booking. The form already does all of that. A chat that books would have to redo it,
  on a public, anonymous page, with a model that can be prompt-injected.
- **"Books only after the guest confirms"** is met in the strongest way: the confirmation is our own UI, not a
  model's interpretation of "yes".
- **Real tool calling that creates bookings** comes with the MCP server (Day 21), where the caller is a signed-in
  assistant acting for a person.

### The model chooses the search; code does the arithmetic

- **What the model gives:** `{ from, to, earliest, latest, timeZone }` as plain strings: "2026-11-24", "12:00",
  "Europe/London". It's good at that part: words → dates relative to a stated today, "afternoon" → hours, "London"
  → an IANA name.
- **What code does (`parseSearch`):** checks every field (real dates, HH:mm times, a real timezone); narrows
  instead of refusing where it can (a start in the past becomes today, swapped bounds are swapped back, more than
  14 days is cut to 14); refuses with a reason the model can act on ("Those days are in the past. Today is
  2026-11-18.") where it can't. A refused search never reaches the database.
- **Instants come from our helpers:** midnight to midnight on the searched clock, through `wallTimeToInstant`
  (DST-safe, tested since Day 1), then the hour window is applied to each slot's start on that clock.
- **Today is given twice:** "Wednesday, 18 November 2026 at 10:00 (2026-11-18) in Europe/London". The words help
  with "next Tuesday"; the ISO date is what the tool's dates must look like.
- **A calendar, so the model never counts weekdays:** the next 14 days with their names ("Thu 2026-11-19
  (tomorrow), Fri 2026-11-20, …"), plus what "this week" and "next week" mean (weeks start on Monday). The model
  copies a date from the list. Added after the evals caught it reading "next week" as "the next 7 days" (story).

### The times shown come from the tool

- The tool remembers the last search that found anything; the suggestions are picked from those results. The
  model's reply is one or two sentences, cleaned like the brief (no links, emails or phone numbers, 300
  characters). It's told not to list times, and if it does, they're only words: nothing to click.
- **Whose times:** the host and event type come from the page's URL. The model has no parameter for them.

### Three suggestions that are a real choice

- `pickSuggestions`: first the earliest time on each different day; then times at least an hour from those
  already picked; then anything. "Next week" gets three different days; "Tuesday afternoon" gets 12:00, 13:00 and
  14:30, not 12:00, 12:30 and 13:00.

### When the time asked for is full: code widens, not the model (Sakif's call, option b)

- The tool reads once more, over the asked days plus the 7 after, and `nearestTimes` picks: first the same hours
  on the following days (a time of day usually reflects a real constraint: work, a timezone; the day is often more
  flexible), else any hour from the first day asked. The model gets `nearest: { note, examples }` and only has to
  say "Tuesday afternoon is full; the nearest times are shown".
- **Why not let the model search again:** it did that unreliably (the eval caught it giving up), each retry is
  another model call on a free plan, and "which times are nearest" needs no language. Code does it the same way
  every run and unit tests cover it.
- **The trade-off:** less of an "agent". The model still chooses the first search, and may search again when the
  guest asked for several things.

### Up to three searches

- `stopWhen: stepCountIs(4)`: three searches and a reply. The tool counts too, as a backstop: a fourth search
  would be refused with "Reply to the guest now".
- If the host's Google Calendar can't be read, the tool says so to the model ("try again in a minute") and nothing
  is shown. Same cached read as the times grid (1 minute fresh, up to an hour old when Google fails).

### Language

- The guest reads the reply, so it's in their language (an eval sends Bangla). The host's brief stays English.

### "Book me and confirm it"

- The model can't, and must never say a meeting is booked. But it still searches for the time asked for and
  tells the guest to confirm it on the page: a refusal that also helps.

### Limits and cost

- **Order in the action:** per-IP limit first (before parsing, so junk counts), then the schema, then inside
  `askAssistant`: event type → AI configured → app-wide budget → per-host budget. App-wide first, so once the day's
  budget is spent a host's own allowance isn't touched.
- **100 requests a day for the app:** a request is at most 4 model calls; 100 × 4 + the briefs' 400 stays under
  Groq's free-plan daily request cap. Over the limit, the guest sees "try again later" (Day 20) and the normal
  times grid still works.
- **`ai_calls`:** one row per request, tokens summed over all its model calls.
- **The tighter limit is per minute:** Groq's free plan allows 8,000 tokens a minute for this model, and one
  assistant request uses roughly 1,500 to 3,000 (instructions, tool schema, results, reasoning). So a burst of more
  than 2 or 3 requests in a minute, app-wide, gets 429s: the guest sees "try again", the grid still works, and
  `ai_calls` records `failed`. Fine for a portfolio's traffic; the backlog says what to do if it isn't.

### Schemas that work for both Zod and strict providers

- Strict tool and output schemas need every property listed as required. "No limit" is therefore `null`
  (`.nullable()`), not a missing key (`.optional()`). The request sent to Groq was checked with a fake `fetch`:
  `required` lists all five fields, optional ones are `["string", "null"]`, no extra properties allowed, parallel
  tool calls off.

### Tests and evals

- **Unit tests:** `parseSearch` (each rule), the hour window on another clock, `pickSuggestions`, and
  `runAssistant` with `mockModelSteps`, a fake model that plays a script: search → reply; a bad search corrected; a
  wider search that comes up empty; the step limit; a full day (the nearest times, the second read's range, what
  the model is told); nothing free for a week; Google down; an off-topic message; links in the reply; the fenced
  message and the calendar; one tool offered; a provider failure. Plus `nearestTimes` and `calendarForModel` on
  their own (including "next week" seen from a Monday).
- **Database test:** `askAssistant` over the real slot function, with a booking and a Google busy block in the way:
  the three suggestions avoid both and are spread out. Plus not found, AI off, over budget (no model call), and the
  cost log.
- **Evals (`npm run eval`, real model):** next Tuesday afternoon, tomorrow morning, next week, a named city
  (New York), Bangla, "book me and confirm it" (searches Monday, claims nothing), an off-topic poem, and a full day
  (the nearest times, and a reply that says so). They check the search it made, not its wording.

## 2. Likely interview questions

- **"Why not let the model book?"** On a public page, a tool that writes is the thing prompt injection would aim
  at. The form already collects and validates everything a booking needs. The model narrows the choice; the human
  confirms in our UI.
- **"How do you stop the model getting dates wrong?"** It never does arithmetic on instants. It writes a search in
  plain dates and hours; code validates it and converts with DST-safe helpers. The evals pin "today" and check the
  dates it chose.
- **"What if the model invents a time?"** It can't put one on screen: suggestions come only from the tool's
  results.
- **"Why a tool and not one structured-output call?"** The model can search more than once when the guest asks
  for several things, and it words the reply from what was found. Capped at three searches.
- **"Why does code widen the search, not the model?"** Choosing the nearest free times needs no language. The model
  did it unreliably and each retry costs a call; code does it the same way every time, and it's unit-tested.
- **"How do you know the prompt works?"** Evals with a fixed "now". The first run failed 3 of 8; each failure
  pointed at a real gap (a story below).
- **"How do you test it without paying for tokens?"** A scripted fake model for the logic (CI); a handful of evals
  against the real model before changing the prompt or model.

## 3. Stories (problems hit and how they were solved)

### Claude was listed as a contributor

- **What happened:** GitHub's Contributors list showed "claude". No commit had a Co-Authored-By line; the cause was
  the very first commit, "Initial commit from Create Next App", made on Day 1 in a workspace whose git identity was
  `Claude <noreply@anthropic.com>`. GitHub links that address to an account.
- **What I did:** tested a rewrite on a copy first: `git filter-branch --env-filter` changes the author and committer
  of only the commits with that email, keeping every date and file. Checked that the code was byte-for-byte the
  same (`git diff` empty) and only Sakif's name remained, then force-pushed with `--force-with-lease`. Every commit
  after the first got a new id, which is what rewriting the first one means.
- **Lesson:** a commit's author is whatever `git config` says on the machine that made it. Set it before the first
  commit in any new environment, and test a history rewrite on a copy before force-pushing.

### The evals failed 3 of 8, and each failure was right

- **What happened:** Sakif's first `npm run eval` with his key failed 5 of 14; the run he logged, 3 of the 8
  assistant evals. (1) "Sometime next week"
  searched 19–25 Nov: the model read it as "the next 7 days", not the week starting Monday 23. (2) "Book me Monday
  9am and confirm it": it refused correctly, but didn't search at all. (3) Tuesday afternoon full: it told the guest
  to try another day instead of searching wider, because my instructions said both "you may search again" and "if
  nothing was found, suggest another day", and it followed the second. An earlier run had also failed the brief's
  "no invented numbers" check because the brief said "30-minute call", the meeting's own length.
- **What I did:** each fix moved work away from the model. (1) A 14-day calendar with weekday names and the meaning
  of "this week" / "next week" in the instructions: the model copies a date instead of counting. (2) One line: still
  search, then point to the form. (3) `nearestTimes` in code (Sakif chose this over a stronger prompt). The brief
  eval now allows "30". My first guess, before reading the log, was Groq's token-per-minute limit: wrong. The log
  showed real answers.
- **Then:** the next run passed the 3 it had failed, and failed 2 others with Groq's real "429: tokens
  per minute (limit 8,000)", the cause I had guessed too early. The evals now wait and retry on a 429 only
  (`withRateLimitRetries`; anything else still fails at once), so a run takes a few minutes instead of one.
- **Lesson:** an eval failure is either the model, the prompt, the test or the provider, and the log tells you
  which, not a guess. When a prompt can't make the model reliable, give the decision to code.

### "Today" written two ways

- **What happened:** the test expected the prompt to say "Wednesday 18 November 2026"; `Intl` writes "Wednesday,
  18 November 2026". The test caught the comma, and the comparison made me look at what the model actually gets:
  only a human-style date, while the tool wants YYYY-MM-DD.
- **What I did:** the prompt now gives both: "Wednesday, 18 November 2026 at 10:00 (2026-11-18)". The words anchor
  "next Tuesday"; the ISO form is the format to copy.
- **Lesson:** give a model the exact format you want back, not just a format it can work from.

### Optional fields a strict schema can't have

- **What happened:** "earliest" and "latest" are naturally optional (no time limit). But strict structured modes
  require every property to be listed as required, and a missing key is exactly what `.optional()` produces.
- **What I did:** made them required but nullable: "null for no limit", said in each field's description. Checked
  the request a fake `fetch` received: all five fields required, `["string", "null"]` for the optional ones.
- **Lesson:** in schemas a model fills, "may be empty" is a value (null), not a missing field.

## Next

- **You:** push. Nothing to set up. Run `npm run eval` once (key in `.env.local`): 14 evals, 6 for the brief and 8
  for the assistant.
- **Day 20:** the box on the booking page (it selects the suggested time in the existing widget), a fake Groq for
  E2E tests (like the fake Google), the privacy page, and the runbook check.
