# Day 29: Collective team event types (team scheduling, part 2 of 3)

**Result:**

- **Teams can have event types.** On a team's page, the owner presses **New team event type**: the same form as a
  host's own (questions, buffers, notice and all), with its link at `/team/{team}/{slug}` and a **Hosts** list
  (everyone ticked by default; the first ticked is the organizer). Members see the list; only the owner creates,
  edits or switches one off.
- **Guests book the whole team.** `/team/{team}` lists the team's meetings; `/team/{team}/{slug}` is the normal
  booking page, offering only the times when **every** host works and is free (their own hours in their own
  timezones, their bookings with buffers, their Google busy times). The facts panel shows each host's city and
  clock (Sakif's pick); "You're booked with Acme Sales".
- **One meeting, every host blocked.** A booking has one row in `bookings` (host_id = the organizer) and one row
  per host in the new `booking_hosts`. Postgres refuses any host being in two active meetings at once, whichever
  meeting each is, and whether or not they're its organizer.
- **Emails:** the guest's names every host ("Sakif Azwad and Grace Hopper"); each host gets their own, on their
  own clock, with the AI brief.
- **Guests can cancel a team meeting** from their link (it frees every host). Moving one comes on Day 30, so the
  guest's page offers Cancel only, and says why.
- **Also:** real 404s for team pages from `proxy.ts`; leaving a team (or being removed) takes you off its host
  lists; the landing page and privacy page updated.
- **Not yet (Day 30, as planned):** co-hosts in Google Calendar (the event is in the organizer's only), moving a
  team meeting, team meetings on every host's Bookings page and in Insights. Round-robin is Day 31.
- **Tests:** unit tests for the triggers and the constraint (`booking-hosts.test.ts`), interval intersection
  (with a property test), collective free times, booking and permissions (`team-booking.test.ts`); two race tests
  on real Postgres (`team-booking.race.test.ts`); 2 new E2E tests (`e2e/team-booking.spec.ts`, 3 runs in a row),
  and the full E2E suite passes (55). Four protections were removed one at a time and the tests caught each
  (Stories 1–3, and the extra host rows).
- **Setup:** migration 0015 runs in the build. Runbook **step 22**.
- **Follow-up (after deploying):** permanent email refusals no longer fail a background run (Story 5).

## 1. Decisions (Sakif's picks, from the options proposed)

### `booking_hosts`: the guarantee moves to "who is in each meeting"

Until today a booking was one row with one `host_id`, and the no-overlap constraint (Day 1) said "per host_id".
A collective meeting has several hosts; the constraint could only protect one of them (Story 4).

```
booking_hosts   (booking_id, host_id) primary key, starts_at, ends_at, active
                EXCLUDE USING gist (host_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
                WHERE (active)
```

- **The app writes only `(booking_id, host_id)`.** Triggers do the rest, so the two tables can't disagree:
  - a new booking gets its organizer's row automatically (every existing code path, the MCP tool included, is
    covered without knowing the table exists);
  - an added host's times and `active` are copied from the booking (whatever the app sends is replaced);
  - moving or cancelling a booking updates all of its hosts' rows; if that overlaps any host's other meeting, the
    booking's own UPDATE fails (23P01), which the code already turns into "just taken".
- **Additive migration:** existing bookings get their one row (backfill); the old constraint on `bookings`
  stays. Old code still running during a deploy keeps working: its inserts fire the trigger too.
- **The slot query reads `booking_hosts`**, so a host's personal page is also blocked by a team meeting they
  aren't organizing. One meeting with two hosts appears twice: kept once (Story 3).

### Team event types are event types

`event_types` gained `team_id` and `team_kind` (`collective`, later `round_robin`); `user_id` became nullable, with a
CHECK that exactly one of user or team owns it. Questions, buffers, notice, limits and the whole booking widget
came for free. Nullable `user_id` rather than "the team owner's id" was deliberate: every existing query says
`where user_id = me`, so a team's event type can never leak onto someone's personal pages or MCP tools. Slugs
are unique per team (a team and its owner can both have `sync`).

`event_type_hosts (event_type_id, user_id, position)`: who hosts it, in order; position 0 is the organizer (the
booking's `host_id`, whose dashboard and Google Calendar get it, and whose timezone decides "which day" for the
notice, window and daily limit). The booking page only uses hosts still in the team, and leaving a team removes
the rows in the same transaction.

### Free times: intersect the hours, union the busy

Each host's working windows come from the same `availabilityWindows` as always, in their own timezone;
`intersectAll` keeps the times when all of them work (a merge-sort-style walk, O(n + m), with a property test).
`generateSlots` gained one optional input, `windows`, used instead of a single host's rules. Busy = everyone's
meetings (deduplicated) plus everyone's Google busy times. Nothing else in the pure function changed, and the
property tests from Day 1 still hold.

### Booking: every host's lock, in one order

Booking a team meeting takes an advisory lock per host, then the same re-check as always, then inserts the
booking and the other hosts' rows. The locks are taken **in sorted order** (Story 1). Google is read live for
every host before the transaction; if any one can't be read, nothing is booked (fail closed, Day 15).

### Not now

- Day 30: co-hosts in Google Calendar (one event in the organizer's calendar with the others invited), moving team
  meetings, team meetings on every host's Bookings page and Insights, a better band sentence for teams.
- Backlog: the booking assistant and the embed for team pages, booking a team meeting through MCP.

## 2. Likely interview questions

- **How do you stop double booking across several hosts?** A join table of (meeting, host) with the times copied
  in by triggers, and an EXCLUDE constraint on it. The database guarantees it for every host of every meeting.
- **Why triggers?** The times must match the booking exactly, and every code path must add the organizer. A
  trigger makes both true for code that doesn't know the table exists, including old code during a deploy.
- **How do you avoid deadlocks when locking several rows or keys?** Always acquire in one global order (sorted
  ids). Proven by a race test that deadlocks without the sort.
- **How do you compute "when is everyone free"?** Intersect working windows (per host, per timezone), then
  subtract the union of everyone's busy times; reuse the single-host slot function on the result.
- **Why make `user_id` nullable instead of adding a "team owner" user?** Existing per-user queries then can't see
  team rows by accident: safe by default.
- **Whose timezone decides "today" for a team?** The organizer's, explicitly; documented and tested.

## 3. Stories (problems hit and how they were solved)

### 1. Two locks in two orders: a deadlock in 1.7 seconds

**Problem:** booking a team meeting locks each host. The race test books two team event types that share Ada and
Grace, listed in opposite orders, at the same moment. With the locks taken in list order, one transaction held
Ada's and waited for Grace's while the other held Grace's and waited for Ada's. Postgres detected it after its
one-second deadlock timeout and killed one: `ERROR 40P01: deadlock detected`, 1.7 s into the test.

**What I did:** `lockHosts` sorts the ids and takes the locks in that order. Every booking, solo or team, locks in
the same global order, so the second one simply waits. The race test runs five rounds and passes; with the sort
removed it fails with the deadlock every time.

**Lesson:** when a transaction takes more than one lock, deadlocks are a matter of order, not luck. Pick one
global order and use it everywhere, and write the test that deadlocks without it.

### 2. A move that would have used the wrong event type's rules

**Problem:** reading the reschedule code before changing anything: it finds the event type by the organizer's
username and the booking's slug. Since today, a team's `sync` and its organizer's own `sync` are both valid. A
guest moving a team meeting would have been checked against the organizer's personal event type: its hours, its
buffers, a single host.

**What I did:** the move checks that the event type it found IS the booking's (`eventType.id ===
current.eventTypeId`), or refuses. Team meetings therefore can't be moved until Day 30 adds the team path, and
the guest's page offers Cancel only. A test creates both `sync`s and checks the move is refused; without the
check, it moved.

**Lesson:** a lookup by name that was unique yesterday may not be today. When a key stops being unique, look for
everything that looked things up by it, and compare ids where you can.

### 3. One meeting, counted twice

**Problem:** the slot query now reads `booking_hosts`, one row per host. A team meeting with two hosts came back
twice, and the daily limit ("at most 2 a day") counted one meeting as two: after one booking, the day was full.

**What I did:** the busy list keeps each booking once (by id). The test sets a limit of 2, books once, and expects
the day to still have times; without the dedupe it fails.

**Lesson:** a join multiplies rows. After switching a query to a join table, check every place that counts.

### 4. A constraint the old table couldn't see

**Problem (from the design):** the Day 1 constraint is `EXCLUDE (host_id WITH =, time WITH &&)` on `bookings`.
In a team meeting organized by Ada, Grace isn't in `host_id` at all, so Postgres would happily accept Grace's own
booking at the same time. The app's re-check would usually catch it, but "usually" is what the constraint was
there to remove.

**What I did:** the constraint is now on `booking_hosts`, which has a row for every host. A database test inserts
Grace's own booking over a team meeting she's in and gets 23P01; the old constraint stays for the organizer.

**Lesson:** a constraint can only see its own table's columns. When the shape of the data changes (one host
becomes several), the guarantee has to move to where the new shape lives.

### 5. A refused email that failed the whole run (found by Sakif on the live site)

**Problem:** after deploying, Sakif booked a team meeting from a private window and found the `booking-changed`
run **Failed** in Inngest after 5 minutes: the `email-cohosts` step kept getting `Resend: validation_error: You can
only send testing emails to your own email address`. With no domain, Resend's test sender delivers only to the
account's owner, and a co-host's address is never the owner's. The sender turned every Resend error into a plain
`Error`; a job step that throws is retried (8 times, with growing gaps), then the run fails. The booking, the
guest's and organizer's emails and the webhooks had all gone through; only the run's status (and a Sentry alert
per retry) was wrong. The same was true since Day 17 for any guest booking with an address other than Sakif's:
the runbook always said "use your own email", so it never showed.

**What I did:** the sender now tells two kinds of failure apart. `rate_limit_exceeded`, Resend's own outages
(`internal_server_error`, `application_error`) and errors with no name stay plain errors, retried as before. Any
other Resend error (a refused or invalid recipient, a bad key) is a `PermanentEmailError`: the job reports it once
to Sentry (`booking-emails` or `reminders`), answers `rejected`, and the run completes. Each co-host gets their try
before anything is retried, so one refused address doesn't hold back the others. A refused reminder is recorded
like a sent one, or every 15-minute sweep would try it again. Tests use a mailbox that refuses one address, the
way Resend's test sender does; without the fix, they fail.

**Lesson:** "retry on error" needs a definition of which errors. A retry can only fix what time can fix
(timeouts, rate limits, an outage); a refusal is permanent, and retrying it only delays the failure and repeats
the alert. Classify errors where they come from, and test both kinds.

## Next

Day 30: team meetings for every host (Google Calendar with the co-hosts invited, the Bookings page and Insights),
and moving a team meeting with all its hosts' locks. Then Day 31: round-robin.
