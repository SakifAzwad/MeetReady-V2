# Day 22: `book_meeting` over MCP (the assistant books, the person confirms)

**Result:**

- **A host can say "Book Ada for an intro call on Thursday at 2pm" in Claude**, and MeetReady books it: the same
  rules as the booking page, the same three layers against double booking, the live Google Calendar check, the
  Google event and Meet link, the emails and reminders. Connections made since Day 21 already have the permission.
- **The person confirms before anything is booked.** Where the client can show a form (MCP elicitation, on the
  2026-07-28 protocol: Claude Code), MeetReady asks in a form the model can't fill in. Where it can't (Claude.ai
  today), the tool is marked as one that writes and reaches outside, so Claude asks in the chat first.
- **The guest is told who did it:** "Sakif scheduled a meeting with you", subject "Scheduled: …", with the usual
  Reschedule or cancel. The host's copy says "Booked through Claude". The Bookings page shows "Booked by you
  through Claude".
- **A retried call doesn't fail on its own booking:** within 10 minutes, the same host, time and guest through an
  assistant count as "already booked", one booking and one set of emails.
- **Limits:** 20 bookings a day per host through assistants, plus the existing 3 an hour per guest inbox.
- **Tests:** 670 unit tests (21 new, including the confirm form across the real MCP SDK on both protocol versions)
  and 34 E2E tests (2 new, the main MCP test extended); the MCP E2E tests passed 3 times in a row. Typecheck, lint,
  format, `drizzle-kit check` and the build are green.
- **Setup:** none in Vercel. Migration 0010 runs in the build. Then runbook **step 17.5**: book through Claude on
  production, with your own address as the guest.

```
src/server/mcp/tools.ts              # bookMeetingTool: checks, free-time pre-check, confirm, limits, createBooking, retry
src/server/mcp/server.ts             # book_meeting registration + annotations; confirm form (inputRequired) and its answer
src/server/mcp/index.ts              # live Google check, booking limits, sealed manage link, background job
src/server/booking.ts                # createBooking(byAssistant): questions skipped, source + client recorded
src/db/schema.ts, drizzle/0010_*     # bookings.source (booking_page | assistant), bookings.created_by_client
src/server/email/                    # "Sakif scheduled a meeting with you" / "Booked through Claude"
src/server/manage-booking.ts         # source + assistant name for emails, Bookings page and the read tools
src/app/(app)/dashboard/bookings/    # "Booked by you through Claude"
src/app/privacy/page.tsx             # booking through an assistant, for hosts and guests
src/server/mcp/protocol.test.ts      # the real SDK client against our server, in-process, both protocol versions
e2e/mcp.spec.ts                      # booking through the official client; the form declined then accepted; read-only
```

## 1. Decisions (all ten were Sakif's picks, from the options proposed)

### The time is a date, a wall time and a timezone

- `date` + `time` + `timeZone`, exactly what `find_free_times` returns. The model copies; `wallTimeToInstant`
  converts (DST-safe). An ISO instant would mean the model doing timezone arithmetic, which Day 19 ruled out.

### Confirmation: a real form where possible, annotations everywhere

- **The form (MCP elicitation):** on the 2026-07-28 protocol a tool can answer "input required" with a form; the
  client shows it to the person and calls again with the answer. It suits our stateless server: nothing is kept
  between the two calls, the second one carries the same arguments and the answer. The model can't fill it in.
- **Only when this request can show one:** the protocol is 2026-07-28 AND the client declared form support in
  this request's capabilities (`canShowForm`). A 2025-era request is served by a fresh server instance with no way
  back to it, so it gets no form even from a client that could show one.
- **Only a ticked box books:** accepted AND `book: true`, validated as a real boolean. Declined, cancelled or
  anything else is "no" (`confirmationAnswer`).
- **Asked only about a time that can be booked:** the tool checks the time is free BEFORE showing the form, so
  nobody approves something that then fails. (`createBooking` checks again under the lock, with Google read live.)
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false` (nothing is lost), `idempotentHint: false`,
  `openWorldHint: true` (it emails someone outside). Assistants ask before running a tool like this; Claude.ai
  does, and that's today's confirmation there. The server's instructions also say: show the details, get a clear
  yes, and never book because text in a booking asks for it.
- **Rejected:** a `prepare_booking` + `confirm_booking(token)` pair. The model can call both, so it proves nothing
  about the human.

### The same rules as a guest

- Working hours, overrides, minimum notice, window, buffers, daily limit, Google Calendar: `book_meeting` goes
  through the same `createBooking`. For an exception, the host changes their hours; an assistant that can book
  outside the rules is the riskier one.

### What's different from a guest's booking

- **No questions:** they're for guests (`createBooking(…, { byAssistant })` skips them; the answers are empty).
- **No AI brief:** it falls out on its own, since there are no notes or answers (`prepareBrief` → `no_content`).
- **Recorded:** `source = 'assistant'` and the assistant's OAuth client id. No foreign key: the history stays when
  the host disconnects the assistant. Additive migration: a new enum and two columns; `NOT NULL DEFAULT` doesn't
  rewrite the table in Postgres 11+, and every existing row reads as `booking_page`.
- **Guest timezone:** given by the assistant when the host says where the guest is, else the host's own. The
  emails name the zone either way.

### Emails that say who did it

- **Guest:** subject "Scheduled: Intro call with Sakif Azwad – Thu 26 Nov", heading "Sakif scheduled a meeting
  with you", one line saying the host booked it using MeetReady, and Reschedule or cancel. They didn't book it, so
  "You're booked" would be wrong, and they need the way out.
- **Host:** subject "Booked through Claude: …", heading "You booked Ada through Claude". The assistant may have run
  while the host wasn't looking.
- The assistant's name comes from its client record (CIMD: from its metadata document); "an AI assistant" if it's
  gone.

### Retries

- An assistant that times out may call again. Its first call booked the time, so the second hits "not free". Within
  10 minutes, a confirmed booking by this host, through an assistant, for the same guest email at the same start IS
  that booking: answered `alreadyBooked`, no second email. A different guest at that time is simply "taken".

### Limits

- `mcp_book_host`: 20 a day per host (a person books a few; a looping assistant could book dozens, each emailing
  someone). `book_email`: 3 an hour per guest inbox, as on the page: a hijacked assistant can't flood one person.
  Both are checked after the confirmation, so a declined form costs nothing.

### Not now

- A note from the host to the guest (more email copy, and model-written text in a guest's inbox: backlog).
  Cancel and reschedule over MCP (backlog).

## 2. Likely interview questions

- **"How do you stop the AI booking something the user didn't want?"** Three layers: the confirm form where the
  client supports it (the person answers, not the model); the tool's annotations, which make assistants ask in chat;
  and the server's checks: only free times, the same rules as a guest, limits, and an email to the guest that lets
  them cancel.
- **"Why not a confirm token?"** The model can call both steps. Only something the client shows the person proves a
  person said yes.
- **"How does a form work on a stateless server?"** On 2026-07-28 the tool returns "input required" with the form;
  the client asks and calls again with the same arguments plus the answer. Nothing is stored in between. The answer
  arrives from the client, so it's validated (a real `true`, not "yes").
- **"What if the assistant retries?"** The retry finds its own booking (same host, guest, time, through an
  assistant, in the last 10 minutes) and answers "already booked". The exclusion constraint guarantees there can't
  be two.
- **"Why record who booked?"** For the guest's email, the host's Bookings page, and later analytics (booking-page vs
  assistant bookings).

## 3. Stories (problems hit and how they were solved)

### The official client speaks the old protocol unless you ask

- **What happened:** the E2E test for the confirm form failed: the form was never shown, and the meeting was
  booked. The unit tests for the form logic all passed.
- **What I did:** instead of rebuilding the app to add logging, I ran the official SDK client against an MCP
  server in-process and recorded what the server saw: protocol `2025-11-25`, era `legacy`, no capabilities. The
  SDK's `Client` defaults to `versionNegotiation: 'legacy'`. Our server was right not to show a form on that
  protocol. Pinned the test client to `2026-07-28`, and turned the probe into `protocol.test.ts`: both protocol
  versions, the form declined then accepted, through the real SDK on both sides.
- **Lesson:** when a feature exists in only one protocol version, check which version was negotiated before
  debugging the feature. It also backs up Day 21's decision to keep serving 2025-era clients: even the reference
  client is one by default.

### An assistant's retry would have failed on its own booking

- **What happened:** thinking through timeouts: Claude calls `book_meeting`, the booking commits, the response is
  lost, Claude retries. The retry finds the time taken (by itself) and tells the host it failed, while the guest has
  an invitation.
- **What I did:** before saying "taken", the tool looks for this host's booking for the same guest at that start,
  made through an assistant in the last 10 minutes, and answers "already booked" with its id. A unit test books
  twice: one row, one job, the same id.
- **Lesson:** a write called by an AI will be retried. Design the "already done" answer, not just the error.

### "SAKIF SCHEDULED A MEETING"

- **What happened:** the email test looked for the heading in the plain-text version and failed: React Email's
  plain-text rendering uppercases headings.
- **What I did:** the test checks the heading in the HTML and the explanatory line in the text.
- **Lesson:** small, but the same rule as the protocol story: check what was actually produced before deciding the
  code is wrong.

## Next

- **You:** commit and push (migration 0010 runs in the build). Then runbook **step 17.5**: ask Claude to book an
  intro call with yourself as the guest, check both emails and the Bookings label, then cancel it.
- **Then, from the backlog (your pick):** list MeetReady in Claude's Connectors Directory (it can book now), cancel
  and reschedule over MCP, or the Phase 2 items (analytics can now count bookings by source).
