# Backlog: what's not built yet, and why

One list for everything deferred or decided against, so nothing from the reviews gets lost. Each item says
**why it's waiting** and **when** it fits. Updated as days are delivered (last: Day 9).

## Next, in order

1. **Custom booking questions:** hosts add their own fields (text, choice, checkbox) to the booking form.
   This is the last Phase 1 feature.
2. **Browser tests in CI:** turn the scripts in this project's history (booking, race, manage, design checks)
   into Playwright tests that run on every push.
3. **Deploy:** Vercel and Neon. Environment variables must be set **before** the build (Day 7 story: the landing
   page is static). Then:
   - decide on the `/unknown-username` status (see Known issues);
   - add error monitoring (Sentry).
4. **Rate limiting** on the public booking routes (and later the AI routes). Upstash Redis is planned. This
   needs to be in place before the slot hold below.
5. **Google Calendar sync for hosts:** busy times from the host's calendar block slots, and bookings get a Meet
   link.
6. **Reminder emails** (a day and an hour before) with Inngest, plus email retries.
7. **AI features:** booking assistant, MCP server, meeting brief (see the full list below).

## Ideas from reviews, deferred

| Idea                                                        | From  | Why it waits                                                                                                                                                                                                                                          | When                              |
| ----------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **5-minute slot hold** while a guest types                  | Day 9 | Good interview piece (expiring holds, same race tests as booking, Postgres only). But the page is public with no login: without rate limits a script could hold every slot. Abandoned holds also hide free times for 5 minutes.                       | With rate limiting, around deploy |
| **Guest calendar overlay** ("check my conflicts")           | Day 9 | Reuses the host Google Calendar sync, which matters more and comes first. Calendar access is a sensitive Google permission: until the app passes Google's review, users see an "unverified app" warning. Must stay optional, read-only, never stored. | After host Google Calendar sync   |
| **Preferred hours** (was: "focus / open for meetings" tags) | Day 8 | Reshaped: focus time that guests mustn't book is simply not-available hours. The real feature is "bookable, but shown first": it needs a schema change and editor work.                                                                               | With AI smart slot ranking        |

## Decided against

| Idea                                    | From     | Why not                                                                                                                       |
| --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Month view on the dashboard             | Day 8    | Thirty bands is noise; the Bookings page covers the long view. Week paging was built instead.                                 |
| Dimming night times to 50% (option B)   | Day 9    | Doesn't change reading order (3 AM still comes first), and 50% opacity reads as disabled. Folding was built.                  |
| Green "Copied" accent                   | Day 9    | Colour in this design means time of day only. The button fills navy instead.                                                  |
| "Daytime only" filter chips             | Day 9    | Same problem as the folding, with two controls instead of one. Merged into the fold.                                          |
| Emoji in labels and readouts (☀️ 🌙 ☕) | Days 8–9 | Says more than we know ("off work") and renders inconsistently. Words do it: "outside Sakif's working hours", "after sunset". |

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

- **`/nobody` returns 200, not 404** (Day 7). The username route streams before the lookup finishes, so
  `notFound()` can only swap the content and add `noindex`. Nothing is indexed, but the status is wrong.
  Decide on deploy day: check the username before streaming.
- **Sun times use each timezone's main city** (Day 9). Someone in Chattogram sees Dhaka's sunrise, a few
  minutes off. Knowing the exact town would need a location permission, which isn't worth it for colours.
- **The hero's colours no longer slide between cities** (Day 9). Real skies are per-city gradients, and CSS can't
  animate between two gradients. The brackets still slide.
