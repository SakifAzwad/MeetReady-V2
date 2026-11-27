# Day 31: Round-robin team event types (team scheduling, the last part)

**Result:**

- **A team event type can be round-robin:** "One of them, shared fairly", chosen when it's created (the form
  offers it beside "Everyone in the meeting"; it can't change later).
- **Guests see the times when ANY host is free**, each host on their own hours, timezone, meetings, Google
  Calendar and daily limit. The booking page says "With: One of Sakif Azwad or Grace Hopper" instead of every
  host's clock, and the band says "Someone on the team is working 9 AM–11 PM your time." ("Someone is working" /
  "Nobody is working" on the badge).
- **Each booking goes to one host**: of those free at that time, the one with the fewest confirmed bookings of
  this event type made in the last 30 days; on a tie, whoever was assigned one longest ago; then the host list's
  order. The confirmation says who: "You're booked with Grace Hopper", and so do the emails.
- **The meeting is that host's**: one `booking_hosts` row, their dashboard, their Google Calendar, their Insights.
  Moving it (guest or host) keeps the host: only their free times are offered.
- **The team page shows the turns**: "Last 30 days: Sakif 1, Grace 1", the same numbers the rule compares.
- **No migration**: `round_robin` was already a value of `team_kind` (Day 29), and since Day 30 everything reads a
  meeting's hosts from `booking_hosts`.
- **Also:** the public team page says "With one of …", the landing page and FAQ (round-robin left "Coming next"),
  the privacy page (the team sees each host's count).
- **Tests:** 20 new unit tests (`pickHost` with two property tests, `round-robin.test.ts` for free times,
  assignment, Google, moves and the team page, the band's words), 3 race tests on real Postgres
  (`round-robin.race.test.ts`), 1 new E2E test (`e2e/round-robin.spec.ts`, 3 runs in a row). Full suites: 890 unit
  - 14 race, 57 E2E. Without the locks, all three race tests fail (Story 1).
- **Setup:** nothing in Vercel. Runbook **step 24**.

## 1. Decisions (Sakif's picks, from the options proposed)

### Free times: each host on their own, then the union

Collective intersects everyone's hours. Round-robin runs the same pure `generateSlots` once per host, with that
host's schedule, meetings (with buffers), Google busy times and daily limit ("2 a day" means 2 each), and offers a
time if any host has it. `getBookingCalendar` also returns `freeHosts`: who is free at each time. That's the
candidate list when the guest books. The band's windows are the union of everyone's working hours.

### Who gets it: `pickHost`, a pure function

```
candidates = hosts free at that exact time
order by:   confirmed bookings of this type made in the last 30 days   (fewest first)
            when they were last assigned one                           (longest ago / never first)
            place on the host list, then id                            (never random)
```

- **By booking date, confirmed only** (option 1). A cancelled meeting didn't take their time. Counted by meeting
  date, a booking made today for March wouldn't count until March, and the same host would keep winning.
- **Deterministic:** the same facts always give the same host, so tests can say which. Two property tests check it
  always returns a candidate with the fewest bookings, and that the input's order never matters.

### Booking: every host in the pool locked, sorted (option 2)

The same three layers as always. Under the locks: re-check the time, count, pick, insert with
`host_id` = the chosen host. Locking the whole pool (at most 20) makes round-robin bookings of those hosts take
turns, which is what keeps the counts true when guests book at once (Story 1). The cost is that a busy team's
bookings queue for a few milliseconds each; the alternative (an event-type lock plus the chosen host's lock) waits
less but adds a second lock order to reason about.

### Moves keep the host (option 3)

A moved round-robin meeting is checked against its own hosts (Day 30's `eventTypeForBooking`), which is one
person. So it worked without new code; a test proves it: 12:00 UTC is Grace's hours only, so Ada's meeting can't
move there. Reassigning would move the Google event to another calendar and change who gets emailed.

### A calendar that can't be read: that host sits out (option 4)

Collective needs every host, so one unreadable calendar refuses the booking (fail closed, Day 15). Round-robin
needs one free host, so `busyByHost` leaves the unreadable one out and the others can still take it. Nobody
readable = "calendar unavailable", as before (Story 3).

### What the guest sees (option 5), the kind (option 6), the counts (option 7)

- Before booking: who they might meet, not each host's clock (whose clock matters isn't known yet). After: the
  host's name, in the confirmation and the emails.
- The kind is chosen on create; the edit form shows it as fixed. Switching an event type with bookings would change
  what those bookings mean.
- The counts on the team page are visible to every member: the privacy page says so.

### Not built (backlog)

Weights or priorities per host, reassigning a meeting to another host, a cap per host per week, round-robin on the
booking assistant, the embed and MCP's `book_meeting`.

## 2. Likely interview questions

- **How do you assign round-robin bookings fairly?** Among the hosts free at that time: fewest recent bookings of
  that type, then longest since their last one, then a fixed order. A pure function, unit- and property-tested.
- **Why count by when it was booked, not when the meeting is?** Fairness is about assignments. By meeting date, a
  far-off booking wouldn't count yet, and the same host would keep winning in the meantime.
- **What race does the lock prevent here, if the constraint already stops double booking?** Two transactions that
  both read "Ada 0, Grace 0" and both pick Ada. The constraint turns the second into "just taken" although Grace
  was free; with different times it lets both through and the split goes unfair. That's a read-then-decide race
  (write skew): the decision depends on rows the other transaction is about to change.
- **How do you compute "times when anyone is free"?** Per-host slot generation, then a union keyed by start time,
  remembering who is free at each.
- **What does "fail closed" mean when one of five calendars is down?** For collective, no booking. For round-robin,
  that host sits out: the rule protects against booking someone over a meeting we can't see, and only that person
  is at risk.

## 3. Stories (problems hit and how they were solved)

### 1. The constraint can't make it fair

**Problem:** the plan locks every host in the pool before counting. To check the locks earn their place (double
booking is already impossible: the EXCLUDE constraint on `booking_hosts` guarantees it), I removed them for
round-robin and ran the race tests. They showed what the constraint doesn't guarantee. Two guests booking the same time while both hosts were free both read "Ada 0, Grace 0", both
picked Ada, and the second got "just taken" although Grace was free. Ten guests booking ten different times at
once came out 1–9, 6–4 and 6–4 over three runs, never reliably 5–5.

**What I did:** a round-robin booking locks every host in the pool, in sorted order (the Day 29 deadlock rule),
before it counts. The transactions take turns, each one counts what the previous one committed, and the tests pass:
both guests booked (one each), the one-free-host case answers "slot_unavailable" from the re-check (not
"slot_taken" from the constraint), and ten at once split 5–5, on every run.

**Lesson:** a database constraint protects a fact ("no overlap"), not a decision. When a transaction reads
something, decides, then writes, and another transaction can change what it read in between (write skew), the
decision needs the transactions to take turns. Test the decision's outcome, not only the constraint's.

### 2. A flat list of busy times would have blocked everyone

**Problem (from the design):** since Day 15, a host's Google busy times reach slot generation as one flat list.
For a team that was fine: collective needs every host free, so anyone's busy time blocks the team. For round-robin
it's wrong: Ada's dentist appointment must block Ada, not Grace. Passing the flat list would quietly offer fewer
times than there are, with no error anywhere.

**What I did:** a new option, `externalBusyByHost`, and a guard: round-robin with several hosts and a flat list
throws ("needs externalBusyByHost"). The guard fired on the first test run, in my own code: `createBooking` passed
its usual flat list (empty, but present) to round-robin. Seven tests failed with that message, and the fix was one
line: pass the list that fits the kind.

**Lesson:** when a value's shape stops fitting a new case, make the wrong call fail loudly instead of silently
returning a smaller answer. The first caller it catches may be your own.

### 3. Fail closed for whom?

**Problem (from the design):** Day 15's rule: if Google can't be read, don't book (a meeting on top of one we can't
see is worse than "try again"). For collective that means no booking, because every host must be free. Copied to
round-robin, one host's expired token would close the team's page to every guest, though the rule only needed to
protect that one host.

**What I did:** `busyByHost` reads each host's calendar separately and returns the ones it could read; only those
are candidates, in the slots API and when booking. Tests: Ada's calendar down, the booking goes to Grace; both down,
"calendar unavailable". A host's Google meeting also blocks only them.

**Lesson:** apply a safety rule at the level of the thing it protects. "Don't book over a meeting we can't see" is
about one person's calendar, so it removes one person, not the whole team.

### 4. A test that looked for a time the page hides on purpose

**Problem:** the E2E test checked that a guest in Dhaka is offered 10:30 PM (only Grace, in London, works then).
It wasn't in the list, though the API had it: since Day 9, times outside the guest's daytime (8 AM–8 PM) fold into
one "later" line, closed by default. Then the email check failed on `You're booked`: the HTML has `You&#x27;re`.

**What I did:** the test checks 7:30 PM (Grace only, still in daytime) and the email's text without the apostrophe.
Both were the test's assumptions, not bugs.

**Lesson:** before calling a failing E2E test a bug, check what the user actually sees: a feature from 20 days
earlier (folding night times) and HTML escaping both change the page on purpose.

## 4. Known limits

- Assignment counts one event type at a time: a host busy with other team meetings isn't "used" more for it (their
  calendar still blocks the times).
- No per-host weights or caps; a host who should get fewer is simply left off the list.

## Next

Team scheduling is done (Days 28–31). Next: pick from the backlog (the domain day waits until a domain is bought).
