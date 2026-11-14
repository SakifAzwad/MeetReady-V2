# Backlog: what's not built yet, and why

One list for everything deferred or decided against, so nothing from the reviews gets lost. Each item says
**why it's waiting** and **when** it fits. Updated as days are delivered (last: Day 17).

## Next, in order

1. **Push Day 17** and set up Inngest: [deploy.md](deploy.md) step 15 (Sakif).
2. **AI features:** booking assistant, MCP server, meeting brief (see the full list below). The booking
   questions feed the meeting brief: the answers are what the host should read before the call. **The AI routes
   get their own rate limits** (one more line in `LIMITS`): each call costs money. Long AI calls can run as
   Inngest jobs (Day 17) instead of holding a request open.

Done: custom booking questions (Day 10), the last Phase 1 feature; browser tests in CI (Day 11); deploy-ready
code and runbook (Day 12); live at <https://meetreadyv2.vercel.app> since 12 Nov 2026; error monitoring (Day 13);
rate limiting (Day 14); Google Calendar busy times (Day 15); privacy policy, terms and a published Google app
(Day 15 follow-up); bookings written to Google Calendar with Meet links (Day 16); background jobs with automatic
retries, reminder emails, backfill on connect and ordered syncs (Day 17).

## Ideas from reviews, deferred

| Idea                                                                             | From   | Why it waits                                                                                                                                                                                                                                                                           | When                                               |
| -------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **5-minute slot hold** while a guest types                                       | Day 9  | Good interview piece (expiring holds, same race tests as booking, Postgres only). But the page is public with no login: without rate limits a script could hold every slot. Abandoned holds also hide free times for 5 minutes.                                                        | After calendar sync (Sakif's call, Day 15)         |
| **Pick which calendars count** (not just primary)                                | Day 15 | Primary covers most people. Others need a calendar list (one more scope or `calendarList` call) and a picker in the card. The table already has `calendar_id`.                                                                                                                         | When a host asks                                   |
| **Push updates instead of a 1-minute cache** (Google watch channels)             | Day 15 | Webhooks from Google need a public HTTPS endpoint, channel renewal every few days and a sync token per calendar. The cache plus the live check at booking already give the right answer.                                                                                               | With many hosts                                    |
| **Google app verification**                                                      | Day 15 | Published but unverified: anyone can connect a calendar after a "Google hasn't verified this app" warning, 100 accounts at most, ever. Verification removes both. Needs a demo video, domain ownership in Search Console and Google's review (the privacy policy exists since Day 15). | Before real users connect calendars                |
| **A "pending" Meet link**                                                        | Day 16 | Google can answer a Meet request with status `pending`; the link then arrives later. Today the booking just has no link until the next sync.                                                                                                                                           | If it shows up in Sentry                           |
| **Transactional outbox** for job events                                          | Day 17 | The textbook fix for "booking saved, event never sent": write the event in the booking's transaction, relay it after. Today a failed send to Inngest runs the jobs inline instead, which covers an Inngest outage at this size.                                                        | With many bookings, or a second consumer of events |
| **Reminder settings** (per event type: on/off, how long before; host reminders)  | Day 17 | Guests get a day and an hour before, fixed (`REMINDERS`). Settings need a form, a schema change and the sweep reading per-type rules.                                                                                                                                                  | When a host asks                                   |
| **Inngest on previews**                                                          | Day 17 | Previews run jobs inline (keys are Production only). Running them through Inngest needs Vercel's protection bypass and branch environments.                                                                                                                                            | If a preview needs to show reminders               |
| **E2E through the real queue**                                                   | Day 17 | CI runs jobs inline; the Inngest path was checked once by hand against the dev server. A CI job could start `inngest-cli dev` and run one booking through it.                                                                                                                          | If the Inngest wiring changes often                |
| **Pick a time on the daylight band** (tap or drag, snapping to free times)       | Day 16 | The most original option for the time picker, but tapping a 30-minute strip is fiddly on a phone, and it still needs the grid as a keyboard-friendly fallback. The grid (option A) shipped first.                                                                                      | As polish, after the AI features                   |
| **Guest calendar overlay** ("check my conflicts")                                | Day 9  | Reuses the host Google Calendar sync, which matters more and comes first. Calendar access is a sensitive Google permission: until the app passes Google's review, users see an "unverified app" warning. Must stay optional, read-only, never stored.                                  | After host Google Calendar sync                    |
| **Guest edits their answers** when rescheduling                                  | Day 10 | The manage page shows answers read-only. Editing needs a form there and a host notification ("Ada changed her answers"). Rarely needed: notes cover it.                                                                                                                                | With Phase 2 webhooks                              |
| **Conditional questions** ("ask B only if A = Founder")                          | Day 10 | Turns a list into a small rules engine (and its validation). It's what routing forms do, so it belongs there.                                                                                                                                                                          | With routing forms (Phase 3)                       |
| **More E2E coverage:** onboarding, availability editor, guest timezone switching | Day 11 | The four specs cover the flows where a break costs a booking. These pages are covered by unit tests and the Day 3/8/9 scripts; porting them is mechanical.                                                                                                                             | When one of them changes next                      |
| **Script Content-Security-Policy** (nonces)                                      | Day 12 | Headers stop framing and sniffing already. A strict script CSP needs a nonce per request, which conflicts with prerendered static shells; Next's hash-based option is still young.                                                                                                     | After Sentry (CSP violation reports can go there)  |
| **A custom domain** (emails to every guest)                                      | Day 12 | About $10/year; Resend's test sender only reaches the owner's address until a domain is verified. No code change: env vars and DNS.                                                                                                                                                    | Whenever Sakif buys one                            |
| **Performance tracing** in Sentry                                                | Day 13 | Errors only for now: tracing spends the free quota, and with little traffic there's nothing to measure. One option (`tracesSampleRate`) when there is.                                                                                                                                 | When real traffic arrives                          |
| **Preferred hours** (was: "focus / open for meetings" tags)                      | Day 8  | Reshaped: focus time that guests mustn't book is simply not-available hours. The real feature is "bookable, but shown first": it needs a schema change and editor work.                                                                                                                | With AI smart slot ranking                         |

## Decided against

| Idea                                       | From     | Why not                                                                                                                                                                                       |
| ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One sleeping run per booking for reminders | Day 17   | Bookings can be further ahead than a free-plan run may live, and every reschedule or cancel must cancel the run: a second copy of the schedule. A 15-minute sweep reads the database instead. |
| Resend's scheduled emails for reminders    | Day 17   | At most 30 days ahead, the Meet link frozen at scheduling time, and each change must find and cancel the scheduled email.                                                                     |
| Vercel Cron for the reminder sweep         | Day 17   | The Hobby plan runs it once a day. Inngest's cron runs every 15 minutes and comes with the queue.                                                                                             |
| Retrying Google before the booking emails  | Day 17   | The emails wait for Google (Meet link), so retries there would hold the guest's confirmation for minutes. One try, then a separate retrying job.                                              |
| The raw manage token in job events         | Day 17   | Inngest stores events. The event carries the booking id; the job decrypts the token from our database (encrypted copy, Day 17).                                                               |
| `calendar.readonly` to read busy times     | Day 15   | It would let us read every event's details. Free/busy can't see them.                                                                                                                         |
| Calling Google inside the booking lock     | Day 15   | Holds a database connection and the host's lock during a network call. The live check runs first.                                                                                             |
| Times grouped in collapsible sections      | Day 16   | One more tap before any time is visible, on the page's most common action. The grid shows them all in a few rows.                                                                             |
| Rate-limiting sign-in                      | Day 14   | Sign-in is Google-only: there's no password to guess, and Google protects its own login.                                                                                                      |
| Failing closed when Redis is down          | Day 14   | Turns a Redis outage into "nobody can book". Limits stop rare abuse; double booking is stopped by Postgres either way.                                                                        |
| Postgres or in-memory as the limit store   | Day 14   | Memory isn't shared between serverless instances. Postgres would add a write to the hottest read paths.                                                                                       |
| Retries for E2E tests                      | Day 11   | A pass on the second try is a hidden bug. Traces and screenshots are kept instead (Day 11 story: the one flake was a real race).                                                              |
| A "log in as" route for tests              | Day 11   | A backdoor in production code, one env var away from live. Tests seed a session and sign the cookie instead.                                                                                  |
| Drag and drop to reorder questions         | Day 10   | Needs a keyboard alternative anyway, which is what the up/down buttons are; they're also trivial to test.                                                                                     |
| Answers in the `.ics` description          | Day 10   | Calendar apps sync the description and share it with every attendee. Answers are for the host: email and dashboard.                                                                           |
| Month view on the dashboard                | Day 8    | Thirty bands is noise; the Bookings page covers the long view. Week paging was built instead.                                                                                                 |
| Dimming night times to 50% (option B)      | Day 9    | Doesn't change reading order (3 AM still comes first), and 50% opacity reads as disabled. Folding was built.                                                                                  |
| Green "Copied" accent                      | Day 9    | Colour in this design means time of day only. The button fills navy instead.                                                                                                                  |
| "Daytime only" filter chips                | Day 9    | Same problem as the folding, with two controls instead of one. Merged into the fold.                                                                                                          |
| Emoji in labels and readouts (☀️ 🌙 ☕)    | Days 8–9 | Says more than we know ("off work") and renders inconsistently. Words do it: "outside Sakif's working hours", "after sunset".                                                                 |

## Remaining roadmap (from the v1 context doc)

- **Phase 2:**
  - real analytics (bookings over time, cancellation and no-show rate, popular times);
  - marking no-shows;
  - signed webhooks (`booking.created`, `booking.cancelled`);
  - an embeddable booking widget (inline and popup).
- **Phase 3 (pick 2–3):**
  - team scheduling (round-robin; collective = everyone free);
  - group events with seats;
  - meeting polls;
  - routing forms;
  - paid bookings;
  - a public API with keys;
  - recurring bookings;
  - English and Bangla.
- **AI:**
  - booking assistant (tool calling, books only after confirmation);
  - MCP server (check times and book from Claude or ChatGPT);
  - meeting brief for the host;
  - email-to-booking;
  - smart slot ranking (with preferred hours);
  - post-meeting notes.

## Known issues

- **`/booking/{made-up-token}` returns 200** with the not-found page and `noindex` (Day 12). Profile and booking
  pages got real 404s from Proxy; the manage page didn't, because its URL is private and never linked publicly.
- **Sun times use each timezone's main city** (Day 9). Someone in Chattogram sees Dhaka's sunrise, a few
  minutes off. Knowing the exact town would need a location permission, which isn't worth it for colours.
- **The hero's colours no longer slide between cities** (Day 9). Real skies are per-city gradients, and CSS can't
  animate between two gradients. The brackets still slide.
