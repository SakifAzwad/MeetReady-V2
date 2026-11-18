# Day 20: The booking assistant on the page (and a fake Groq for E2E)

**Result:**

- **"Tell us when suits you"** sits at the top of the booking page, above the daylight band. A guest types "next
  Tuesday afternoon" and gets a one-line reply plus up to three real free times. Picking one selects it in the
  times grid: right day, right month, focused. The guest still presses Continue and confirms through the normal
  form.
- **A city in the message wins:** "I'm in London" gives London times, labelled "In London time". Picking one
  switches the page's "Times shown in" to London, so the form and the emails use it too.
- **A time taken in the meantime is caught:** picking re-reads that month. If the time is gone, the guest sees
  "Someone just booked that time" instead of a selection that points at nothing.
- **Every failure has a sentence, and the grid always works:** rate limited ("try again in N minutes"), model down
  or over budget ("The assistant can't answer right now. You can still pick a time below.").
- **A fake Groq server for E2E** (`e2e/support/fake-groq.mjs`), like the fake Google. Tests script what the
  "model" says; the tool, the slot function and the database are real. It also answers the meeting brief, so
  Day 18's brief now runs its real path in E2E.
- **Privacy page:** what the box sends to Groq, and what it doesn't. Policies dated 18 November 2026.
- **Fixed on the way:** picking another day from the details form dropped what the guest had typed (story).
- **Tests:** 618 unit tests (4 new) and 28 E2E tests (6 new), all green; the new E2E tests passed 3 times in a row.
  Typecheck, lint, format, `drizzle-kit check` and the build are green.
- **Setup:** none. No migration, no new package, nothing to set on Vercel (`GROQ_BASE_URL` is for tests only).
  After deploying, run the new runbook check (step 16.9).

```
src/app/[username]/[slug]/assistant-box.tsx   # the box: input, privacy note, reply, three suggestion buttons
src/app/[username]/[slug]/booking-widget.tsx  # pickSuggestion: select, switch zone, re-read the month; details kept
src/app/[username]/[slug]/time-list.tsx       # focusSlot: focus a time chosen elsewhere once it's on screen
src/app/[username]/[slug]/steps.tsx           # GuestForm exposes what's typed (useImperativeHandle)
src/app/[username]/[slug]/page.tsx            # assistant={assistantEnabled}: no key = no box
src/lib/scheduling/calendar.ts                # placeInCalendar: an instant's day and month on a given clock
src/lib/env-schema.ts, src/server/ai/index.ts # GROQ_BASE_URL (tests only)
src/app/privacy/page.tsx, src/lib/site.ts     # the assistant's paragraph, new policy date
e2e/support/fake-groq.mjs                     # the fake Groq: scripts by marker, a fixed brief, outages
e2e/assistant.spec.ts                         # 4 tests; brief.spec.ts and booking.spec.ts +1 each
playwright.config.ts                          # starts the fake on :3102 and points the app at it
docs/deploy.md                                # step 16.9: check the assistant after deploying
```

## 1. Decisions (all eight were Sakif's picks, made from the options proposed)

### Where the box goes: top of the times column (option A)

- It's the feature a reviewer should notice, and a guest who'd rather type finds it before scanning the grid. A
  guest who doesn't want it skips one box.
- **The cost:** on a phone it pushes the calendar down (about a third of the screen once there's an answer). The grid is still one scroll
  away, and picking a suggestion scrolls there itself (focus does it).
- Rejected: below the band (it splits the band from the calendar it describes); a collapsed "Describe when suits
  you" link (one more tap, and the feature hides).

### A suggestion selects, it doesn't advance

- Clicking one sets the month, the day and the time, then puts focus on that time in the grid. Continue appears
  under it, like a time picked by hand.
- **Why not straight to the form:** the guest should see the time in context (the band, the other times that
  day) before giving their details. It also keeps "the guest confirms" literal: the AI narrows the choice, the
  guest makes it.
- **From the details form:** clicking another suggestion goes back to the times with the new one selected, and
  what was typed is kept.

### The timezone the guest names wins

- The server returns the zone it searched in (Day 19). The buttons show that zone's clock, with "In London time"
  when it differs from the page's. Picking one switches the page to it.
- **Why:** the guest told us where they are, which beats a laptop's setting (travelling, a VPN, booking for later).
  The booking saves the page's zone as the guest's, so their confirmation and reminders come in London time.
- The line disappears once the page is on that clock: then it says nothing new.

### A suggestion may be stale: re-read, then say so

- A suggestion can be minutes old, and the grid's copy up to 30 seconds old. So a pick does a fresh read of that
  month (`fetchQuery` with `staleTime: 0`, the same cache entry the grid uses, so the grid updates too).
- **If the time is gone:** the selection is cleared and the guest sees the same notice as when a booking loses a
  race: "Someone just booked that time. Pick another one."
- **Picks are counted** (`picks` ref): if the guest picks something else before the read comes back, the late
  answer is ignored rather than clearing their newer choice. Picking by hand counts too.
- The booking itself still re-checks on the server (the three layers against double booking). This is about not showing a selection
  that can't be booked.

### Focus a time that isn't on screen yet

- A suggestion in another month means the grid is still loading when the pick happens, so "focus the selected
  button" has nothing to focus. `TimeList` gets `focusSlot`: it tries after every render with new slots, focuses
  the button with that start time once it exists, then tells the widget (`onFocused`) so it happens exactly once.
- On a phone, focusing the button also scrolls it into view: one tap goes from the box to the time.

### The box isn't on the reschedule page (backlog)

- The action has no reschedule token, so the booking's own time would count as busy and the suggestions wouldn't
  match that page's grid (which frees it). It needs the token passed through and checked, like `/api/slots`.

### A note under the box, not only on the privacy page

- "Sent to an AI model (Groq) to find times. Don't include personal details. Privacy". The guest reads it at the
  moment they type, which is when it matters. The link goes straight to the paragraph (`#booking-assistant`).
- **The privacy paragraph says:** what's sent (the message, timezone, meeting type, host's first name, the free
  times found); what isn't (name, email: the box comes before the form); what MeetReady keeps (only that a request
  happened and how long it took); the same Groq terms (no training, Zero Data Retention).

### The reply is labelled, the times are vouched for

- "Reply written by AI. The times are Sakif's real free times." Both halves are true and they say different
  things: the words come from a model; the buttons come from our slot function (Day 19: never the model's text).
- The reply is plain text (React escapes it); an E2E test sends `<b>` and checks it shows as text.

### Stateless, like the server

- One message, one answer; sending again replaces it. No history to keep in the browser or send back (Day 19's
  backlog item covers follow-ups).
- **No `useTransition`:** this widget animates steps with `<ViewTransition>`, which runs on transitions. A plain
  `pending` state keeps the box's updates from starting page animations.

### A fake Groq that scripts the model, not the tool

- **What it fakes:** only `POST /openai/v1/chat/completions`, the one call the AI SDK makes (no streaming). The app
  reaches it through `GROQ_BASE_URL`, passed to `createGroq({ baseURL })`; unset everywhere but E2E.
- **Scripts by marker:** a test registers `{ search, reply }` under a random word it puts in the guest's message.
  The fake answers the first call with a `findTimes` tool call carrying `search`, and the second (once a tool result
  is in the conversation) with `reply`. Tests run in parallel, and markers keep them apart, the way tokens do in the
  fake Google.
- **What stays real:** `parseSearch`, the slot function, Postgres, `pickSuggestions`, the action, its limits, the
  `ai_calls` log. So the E2E tests check the whole path, and the suggestions they expect follow from the host's
  hours, not from the fake.
- **The brief (Sakif's pick):** with a key set, every booking with notes in every E2E test now asks for a brief.
  The fake answers any request with a JSON schema with one fixed, valid brief. A new test books with notes and finds
  that brief on the host's Bookings page: Day 18's real path, from job to model to page, which E2E only covered by
  inserting a brief before.
- **An assistant request with no script gets a 500:** a test that forgot its script fails loudly instead of
  passing on a default.
- **The model id stays the production one** (`AI_MODEL` empty → `openai/gpt-oss-120b`), so the AI SDK builds the
  same request shape it sends to Groq: strict JSON schema for the brief, tools for the assistant.

## 2. Likely interview questions

- **"How does the AI's answer reach your UI without trusting it?"** The suggestions come from our tool's results,
  sent as ISO instants; the widget looks them up in its own grid. The model's words are shown as text, labelled.
- **"What if the suggested time was booked a minute ago?"** Picking it re-reads that month. If it's gone, the
  guest is told and nothing is selected. If they book anyway, the server's checks and the exclusion constraint stop
  a double booking.
- **"How do you test an LLM feature end to end without calling an LLM?"** A fake server speaking Groq's API,
  scripted per test. Only the model's choices are faked; the tool and the database are real. Real-model behaviour
  is the evals' job (Day 19).
- **"Why not let the assistant open the booking form directly?"** The guest should see a time in context before
  committing; selection keeps the human decision in our UI.
- **"How do you handle the guest saying a different timezone than their device?"** The server searches in the
  named zone; the UI shows that zone and switches the page to it on pick, so the booking stores it.
- **"Accessibility?"** A labelled input and region, `aria-live` for the answer (focus isn't stolen), `aria-pressed`
  on suggestions, and focus moved to the selected time, which also scrolls it into view on phones.

## 3. Stories (problems hit and how they were solved)

### The plan promised a behaviour the code didn't have

- **What happened:** my plan said a suggestion clicked from the details form would keep what the guest typed, "like
  picking another day does today". Wiring it up, I read the calendar's day handler: it went back to the times but
  never saved the form. The form unmounted, and the guest's name and email were gone.
- **What I did:** wrote the E2E test first (fill the form, pick another day, come back: name still there), then
  removed the fix and rebuilt to watch it fail on the old code (`Expected "Ada Lovelace", Received ""`). The
  fix: `GuestForm` exposes `draft()` through `useImperativeHandle`, and both ways of leaving the form (another day,
  a suggestion) save it first. The new feature's test covers the suggestion path too.
- **Lesson:** "it already works that way" is a claim, so check it in the code before building on it. A test that
  has never failed hasn't proved anything; make it fail once on purpose.

### Turning the AI on for one test turns it on for all of them

- **What happened:** the E2E server is one process with one set of env vars. Setting `GROQ_API_KEY` so the
  assistant could run also meant every booking with notes, in every spec, would call the model for a brief.
- **What I did:** made the fake answer everything the app can send: brief requests get one fixed, valid brief;
  assistant requests follow a script or fail with a 500. Then used it: a new test checks Day 18's brief through its
  real path, which E2E had only covered by inserting a row.
- **Lesson:** a test-environment flag is global. A fake has to answer every caller the flag wakes up, and the
  side effect can become coverage instead of noise.

### A clock the tests can't pin

- **What happened:** E2E tests here use a fixed day, never "today" (a handoff rule). But the assistant only
  searches the next 14 days from the server's real clock, and a production build can't be given a fake one.
- **What I did:** these tests pick a weekday 8 to 10 days ahead in the host's zone: always inside the window, never
  today (so minimum notice never matters), always a working day. The rule's exception is written at the top of the
  spec.
- **Lesson:** a rule like "never depend on today" exists for a reason (flaky edges); when a feature is defined
  relative to now, keep the reason (stay away from edges) and say why the rule bends.

### Three buttons on a 360-pixel phone

- **What happened:** the screenshots showed the three suggestions wrapping as two and one on a phone, which reads
  like a ranking. Forcing three columns then wrapped the text inside them ("Thu 26 / Nov", "12:00 / PM") at 360px.
- **What I did:** three columns always (there are never more than three), no wrapping inside a button, a smaller
  time on narrow screens. Checked at 320, 360 and 390 pixels: no sideways overflow, one line each.
- **Lesson:** look at the screen, not just the tests: the E2E tests passed with all three layouts.

## Next

- **You:** unzip, commit, push. Then runbook **step 16.9** on the live page: ask once, pick a time, try "I'm in
  London", and see a `booking_assistant` row in `ai_calls`.
- **Day 21: MCP server** (check times and book from Claude or ChatGPT). Opinions first.
