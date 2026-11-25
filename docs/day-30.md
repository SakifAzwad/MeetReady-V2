# Day 30: Team meetings for every host (team scheduling, part 3 of 3)

**Result:**

- **Google Calendar for teams.** A team meeting is one event in the organizer's calendar, with the co-hosts
  invited as attendees: one Meet link for everyone. Google sends the co-hosts the invitation, and an update when
  the meeting moves or is cancelled (so it reaches them without a domain). The guest is never an attendee: they
  get MeetReady's own email and invite, as since Day 16.
- **Team meetings can be moved:** by the guest from their link (the Reschedule button is back for team meetings),
  and by any host from the Bookings page or through their AI assistant. The new time must suit every host of the
  meeting; every host's lock is taken; every host's row moves in the same UPDATE.
- **Every host sees it.** A co-host's Bookings page, the dashboard's "Coming up" and week view, Insights, their AI
  assistant (`list_bookings`, `get_booking`) and their webhooks all include team meetings. A row says which team
  and who else is in it ("Acme Sales, with Sakif Azwad"). Only the organizer sees the Google Calendar status and
  Retry: the event lives in their calendar.
- **Any host may cancel, move or mark a no-show**, and the others are told who did: the guest's email says "Grace
  moved your meeting", the organizer's says "Grace moved your meeting with Ada", the Bookings page says "Moved by
  Grace". The host who made the change isn't emailed about it (they know), unless an assistant did it.
- **The band on a team's page** says what it shows: "Everyone is working 3–5 PM your time." and "Hosts in Dhaka and
  London"; the scrub badge says "Everyone is working" / "Not everyone is working" (Story 1).
- **Also:** the landing page (the "More for team meetings" item left "Coming next"), the FAQ, the privacy page
  (co-hosts' emails go to Google as event guests), and the webhooks guide.
- **Tests:** 24 new unit tests (team moves, permissions, Bookings/week/Insights for co-hosts, emails, Google
  attendees, webhooks, MCP, the band's words, labels), 1 new race test on real Postgres, 1 new E2E test
  (`e2e/team-meetings.spec.ts`, 3 runs in a row). Full suites: 870 unit + 11 race, 56 E2E. Three protections were
  removed one at a time and a test caught each (Stories 2–4).
- **Setup:** migration 0016 (one column) runs in the build. Runbook **step 23**.

## 1. Decisions (Sakif's picks, from the options proposed)

### A meeting's hosts are its `booking_hosts` rows

Day 29 moved the no-double-booking guarantee to `booking_hosts`. Day 30 makes everything else read the same rows:
the host-side queries (`hostedBy`, an `EXISTS` on `booking_hosts`, so a three-host meeting is still one row), the
move, Google's attendees and the emails. The event type's host list only decides who new bookings go to.

### Moving: the meeting's own hosts, found by id

`eventTypeForBooking(db, booking)` returns the booking's event type **by id** (never by username + slug, which a
team's type can share with its organizer's: Day 29 story 2), with the **meeting's** hosts, organizer first. Someone
added to the event type since isn't in this meeting; someone taken off it still is. The move then does what a
booking does: Google read live for every host (minus the meeting's own time), every host's lock in sorted order,
the re-check, and the UPDATE, which the triggers copy to every host's row (Story 3). The slots API and both MCP
tools use the same function, so the times shown are the times the move accepts.

### Any host may change it (option 1 of 2)

Cancel, move and no-show are allowed to every host of the meeting (`hostedBy` in the WHERE clause, the same rule as
reading it). A team member who isn't in the meeting gets the same 404 as anyone else. New column
`bookings.changed_by_host_id` (nullable, `on delete set null`): which host made the latest cancel or move. It
follows Day 24's "latest change" rule, like `changed_by_client`. Null on a host change from before today means the
organizer, the only one who could. Emails use `hostIsTold(b, change, hostId)`: everyone except the host who made
the change by hand.

### Google: the organizer's calendar, co-hosts invited (options 2 and 3)

- **Whose calendar:** the organizer's only. If they haven't connected Google, no calendar gets the event and the
  co-hosts keep the `.ics` in their email. "The first host with a calendar holds it" went to the backlog: it needs
  a column for which calendar holds each event and changes to backfill and Retry.
- **`sendUpdates=all`** for a team meeting's event (only co-hosts are attendees, so only they hear from Google),
  `none` for everything else as before. Their MeetReady email then has no `.ics`, like the organizer's since Day
  16: one calendar entry, not two.
- **Attendees only on create.** Google's PATCH replaces an array it's given, and we'd send it without each
  co-host's RSVP. A meeting's hosts never change after booking, so updates leave the list as Google has it.

### Someone who leaves the team (option 4)

Stays on meetings already booked: the guest was promised them. New bookings stop, as since Day 29.

### MCP and webhooks (option 5)

Both include team meetings. `list_bookings` / `get_booking` add `team`, `hosts` (the caller marked "(the user)")
and `organizer`; `cancel_booking` and `reschedule_booking` work on them through the same functions as the
dashboard; `find_free_times` with a `bookingId` uses that booking's type (Story 2). Webhooks go to every host's
endpoints, one delivery row each. `book_meeting` still refuses a team's event type (backlog).

### Not built

- No index: the plan proposed one on `booking_hosts (host_id, starts_at)`, but Day 29 already has it (a plain
  btree beside the partial gist index of the constraint).
- Backlog: any connected host holding the event; removing a host from one meeting; the team owner seeing every
  team meeting.

## 2. Likely interview questions

- **How does a team meeting get into everyone's calendar?** One event in the organizer's calendar, the co-hosts as
  attendees, `sendUpdates=all`. Google delivers the invitation and keeps it current; one Meet link. The guest is
  never an attendee (they'd get two invitations).
- **Why not write one event per host?** N writes, N Meet rooms (or one link copied into N events), N sync states to
  track. One event with attendees is how calendars model a meeting with several people.
- **When the meeting moves, whose availability counts?** The people in that meeting (its `booking_hosts` rows), not
  the event type's current list. A change to existing data is checked against that data's own facts, not today's
  settings.
- **How do you know the locks matter if the constraint catches everything anyway?** The race test checks HOW the
  loser lost: with every host's lock it's the re-check ("slot_unavailable"); with the organizer's lock only, the
  constraint ("slot_taken").
- **"The host" became several people. What changed?** Every "the host did it" needed "which host": a column for
  who made the latest change, emails that name them, labels that say "you" only to them.
- **Why `EXISTS` and not a join for "meetings I host"?** A join with `booking_hosts` returns a meeting once per
  host; `EXISTS` filters without multiplying rows (Day 29 story 3).

## 3. Stories (problems hit and how they were solved)

### 1. A band that spoke for one city on a page for two

**Problem (found reading the code before starting):** on a team's booking page the daylight band's windows are
the intersection of every host's hours (Day 29). But the words around it were the single-host ones, fed the team's
name: the sentence said "Acme Sales works 3–5 PM in Dhaka, which is …", the organizer's city for a team spread over
Dhaka and London; the scrub badge showed only the organizer's clock ("2:30 PM in Dhaka") and "Outside Acme's
working hours" (the first word of "Acme Sales", the rule that turns "Sakif Azwad" into "Sakif"). At 8:30 AM London
time Sakif is working and Grace isn't, and nothing on the band said which. The data had changed meaning (one
person's hours → everyone's shared hours); the sentences describing it hadn't.

**What I did:** `lib/scheduling/team-band.ts` and a `team` mode in `momentReadout`: "Everyone is working 3–5 PM
your time." on the guest's clock, "Hosts in Dhaka and London" (cities once each, "and 2 more" past three), and
"Everyone is working" / "Not everyone is working" on the badge. The facts panel already lists each host's clock, so
the badge doesn't repeat them. Unit tests pin the wording, including the 8:30 AM case; the E2E test checks the
sentence on the page.

**Lesson:** words on screen are claims about data. When a value's meaning changes (one person → a group), search
for every sentence that describes it, not just the code that computes it.

### 2. The same wrong lookup, in two more places

**Problem:** Day 29 fixed the move: it found the event type by username + slug, and a team's `sync` and its
organizer's own `sync` share a slug. Reading the MCP tools today: `find_free_times` with a `bookingId` and
`reschedule_booking`'s pre-check did the same lookup. For a team meeting, `find_free_times` found Ada's personal
`sync` (60 minutes, her hours only) and offered times under its rules. It's read-only, and the move itself would
have refused, so the visible effect was an assistant suggesting times and then failing to book them.

**What I did:** both tools use `eventTypeForBooking` (by id, with the meeting's hosts) and read every host's Google
busy times. A test gives Ada her own 60-minute `sync`, books the team's, and asks `find_free_times`: 30 minutes, the
shared hours. Put back the old lookup and it answers 60.

**Lesson:** a bug fixed in one place is a pattern, and patterns repeat. After fixing one, search for every copy
(here: every `getPublicEventType(…, username, slug)` that starts from a booking) before calling it done.

### 3. The constraint would have hidden a missing lock

**Problem:** the race test for moves (a team meeting moved to 10:30 while Grace books her own 10:30) passed with
"exactly one wins", whether the move took every host's lock or only the organizer's. Without Grace's lock both
passed the re-check, and the EXCLUDE constraint refused one at the UPDATE. The outcome was right either way, so the
test couldn't tell whether the lock layer worked.

**What I did:** the test also checks how the loser lost. With every host's lock (sorted), the second one waits,
re-checks, sees the first, and answers `slot_unavailable`. With only the organizer's lock it gets `slot_taken`
from the constraint, and the test fails (checked by removing it, five rounds).

**Lesson:** when protections overlap, a test of the end result only proves that at least one of them worked.
Assert something only the layer under test produces.

### 4. Whose hours count when a meeting moves

**Problem (from the design, then proven):** the easy way to move a team meeting is to load its event type the way
the booking page does, with today's host list. But the people in a meeting are fixed when it's booked, and the
triggers move exactly those rows. If Grace has been taken off the event type and Linus added, the easy way checks
Linus's calendar (who isn't coming) and skips Grace's (who is). It then offers a time Grace is busy at, and the
constraint refuses it at the last step.

**What I did:** `eventTypeForBooking` takes the hosts from the booking's own `booking_hosts` rows. A test books
with Ada and Grace, switches the event type to Ada and Linus, makes Grace busy at 10:30 and Linus at 10:00: 10:30
is refused at the re-check, 10:00 moves. Load today's host list instead and 10:30 ends in `slot_taken`, a time we
offered and then couldn't keep.

**Lesson:** changing existing data means checking it against its own facts (who is in this meeting), not today's
settings (who would be in a new one).

### 5. "The host" stopped being one person

**Problem (from the design):** since Day 24 the code said "cancelled by the host" or "moved by the host" and
assumed everyone knew who that was. Emails worked it out from the rule "the host did it, so the host isn't told",
and the Bookings page said "Moved by you". With any host allowed to change a team meeting, "the host" could be
Grace. The organizer would never have been told, Grace would have been emailed about her own move, and the
organizer's Bookings page would have said "Moved by you" about a move they never made.

**What I did:** `bookings.changed_by_host_id` records which host made the latest cancel or move. `hostIsTold` decides
each host's email; the guest's email and the other hosts' name the person ("Grace moved your meeting"); the labels
say "you" only to that host. A change from before today has no id and counts as the organizer's, the only one who
could make it. E2E: Grace moves it, the guest and the organizer get "Grace moved…", and Grace's inbox stays at two.

**Lesson:** when a role that was one person becomes several, every "the X" in the code needs a "which X". Look for
the places that only worked because there was one.

## 4. Known limits

- **Team meetings booked before today** are in the organizer's Google Calendar without the co-hosts invited
  (attendees are sent only when an event is created). On later changes their emails also skip the `.ics`, because
  the booking is marked synced. Only step 22's test meetings exist like that: cancel and book again.
- **The real Google wasn't called in tests** (never is): the attendee and `sendUpdates` behaviour is checked against
  the fake Google and Google's API reference, and live in runbook step 23.

## Next

Day 31: round-robin (one host per booking: fewest bookings of that type in the last 30 days, ties to whoever was
booked longest ago; race tests when two guests book the same time).
