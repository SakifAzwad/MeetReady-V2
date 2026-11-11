# Day 10: Custom booking questions

**Result:** 357 tests (26 new), typecheck, lint, format, `drizzle-kit check` and production build green. The 5
race tests pass on real Postgres. A new browser script (`day10-check.mjs`) passes against the production build
and real Postgres, and so do the Day 4 booking and Day 5 manage scripts: no console errors, no horizontal scroll on
phones. One migration (`0004`). Still not deployed. This was the last Phase 1 feature.

```
src/lib/validation/
├── questions.ts          # question + answer schemas, snapshot, initialAnswers, formatAnswer
├── errors.ts             # Zod issues -> dotted field paths ("questions.2.options.1")
├── event-type.ts         # + questions
└── booking.ts            # + answers, questionsVersion
src/db/schema.ts          # event_types.questions, bookings.answers (jsonb + CHECKs)
drizzle/0004_booking_questions.sql
src/server/
├── booking.ts            # questionsVersion(); answers checked in createBooking()
└── manage-booking.ts     # answers in booking details and the host's list
src/server/email/booking-email.tsx   # answers in the host's email
src/app/(app)/dashboard/event-types/questions-editor.tsx   # the host's editor
src/app/[username]/[slug]/question-fields.tsx              # the guest's fields
src/components/booking-answers.tsx   # dashboard card + guest manage page
e2e/harness/day10-check.mjs
```

## 1. What it does

- **Host:** under "Booking questions" in the event type form, add up to 10 questions. Each has a label, an answer
  type and a Required switch.
  - **Text:** one line, or a textarea with "Long answer".
  - **Pick one:** radio buttons, 2–10 options.
  - **Pick several:** checkboxes, 2–10 options.
  - **Checkbox:** a single yes/no, like "I agree to the call being recorded".
- **Guest:** the questions appear between Email and Notes. Optional ones say "Optional", like Notes already did.
- **Answers appear in three places:**
  - the host's confirmation email;
  - the booking card on the dashboard;
  - "What you shared" on the guest's manage page, together with their notes.
- **Answers are not shown in:**
  - **the guest's email.** They wrote the answers; the manage page shows them.
  - **the `.ics` invite.** Calendar apps sync the description and share it with every attendee.
- **A reschedule keeps the answers.** Editing answers is in the backlog.

## 2. Decisions

### Questions are a jsonb column on `event_types`, not a table

- They're always read and saved together with their event type, in one form, and nothing ever queries across
  questions.
- **With a table:**
  - a `position` column for the order;
  - every save would mean diffing old rows against new ones (insert, update, delete) in a transaction.
- **With jsonb,** a save replaces the array, which is the same thing the form does.
- **The trade-off:** the database can't check what's inside the JSON. So the layering matches the rest of the
  schema:
  - Zod checks the full shape;
  - a `CHECK` (an array, at most 10) is the last guard against a script or a bug.
- **When a table would be right:** querying answers across bookings ("how many said Founder?"). That's Phase 2
  analytics, and it can read the bookings' jsonb with Postgres operators, or move to a table then.

### Answers are a snapshot on the booking

- Each answer stores `{ questionId, label, type, value }`. The label is **copied**, not looked up.
- **Why:** the host can rename or delete a question later. A past booking must still read "Company: Acme", not
  point at a question that's gone, or quietly show the new wording next to an old answer.
- Event types aren't hard-deleted for the same reason (Day 3).
- The browser check proves it: the host deletes a question after the booking, and the manage page still shows
  the answer.

### One schema, built from the questions, used on both sides

- `answersSchema(questions)` builds a Zod object at runtime with one field per question:
  - a required text must be non-empty after trimming;
  - a choice must be one of the options;
  - a multi-choice is de-duplicated and stored in the host's order;
  - a required checkbox must be ticked.
- **It's a `strictObject`:** an answer to a question that doesn't exist is an error, not silently dropped.
- **The booking form** uses it through `zodResolver` for instant feedback. **`createBooking()`** runs it again
  against the questions read **inside the transaction**: the browser's check is a courtesy, the server's is
  the one that counts.
- **It runs before the per-host lock,** so a bad request never makes this host's other guests wait.
- **The request schema** (`bookingRequestSchema`) only checks the outline: an object with at most 10 keys. It
  can't know the rules, because they depend on which event type is being booked.

### When the host edits the questions while a guest is typing

- **The approach is optimistic concurrency, like an HTTP ETag:**
  - the page sends `questionsVersion` with the questions (16 hex characters of a SHA-256 of the JSON);
  - the form sends it back with the answers;
  - if it no longer matches, `createBooking` returns `questions_changed` with the current questions. Nothing
    is booked.
- **What the guest sees:**
  - the form rebuilds from the new questions;
  - it keeps every answer that still fits (`initialAnswers(questions, draft)`): same id, same type, option still
    offered;
  - a notice says: "Sakif just changed these questions. Check your answers and confirm again: what still fits is
    kept."
- **Why any change counts, even a renamed label:** the guest answered what they saw, so the snapshot must
  store what they saw.
- **Why the fingerprint is stable:** Postgres returns jsonb with its keys in a fixed order, so the same
  questions always hash the same.
- **`questionsVersion` is optional in the request,** for tests and a future API. The answers are fully validated
  either way. Only the "you saw an old form" detection needs it.

### Question ids are made in the browser

- `crypto.randomUUID()` runs when the host clicks "Add question". The question has a stable identity before
  its first save, and answers are keyed by it.
- The server only checks that it's a UUID and unique within the event type.
- **Why that's safe:** an id only means something inside its own event type's JSON, so a forged id can't reach
  anything.
- **The alternative,** server-assigned ids, would mean mapping "new question 3" to an id after the save.

### The editor

- **`useFieldArray`** manages the list. Each row reads its own values with `useWatch`, so typing in one question
  doesn't re-render the others.
- **Up/down buttons instead of drag and drop:**
  - they work with a keyboard and a screen reader for free, and they're easy to test;
  - after a move, focus goes back to the button you pressed (or the other one at the edge, where yours is now
    disabled);
  - a polite live region says "Moved Topics to position 2 of 4."
- **Changing the type** keeps the label and Required, and keeps the options when switching between "Pick one"
  and "Pick several".
- **Enter in an option:** in the last one, it adds another option; in any other, it moves to the next. Without
  this, Enter would submit the whole event type form.
- **Server errors land next to the right input.** `z.flattenError` keys errors by the first path segment only,
  so every question's errors would land on "questions". `fieldErrorsByPath` keeps the full path
  (`questions.2.options.1`), which is exactly what React Hook Form's `setError` takes.

### The guest's fields

- **Native inputs.** Radio and checkbox groups are a `<fieldset>` with a `<legend>`, so a screen reader announces
  the question with each option. Keyboard handling and the phone's own controls come for free.
- **Errors and hints** are tied to their group or field with `aria-describedby`, the same way `<Field>` does it.

### Limits

- At most 10 questions and 10 options per question.
- Labels are capped at 200 characters, options at 100, answers at 1000.
- Duplicate labels and duplicate options are rejected, ignoring case and spaces. The answer is the option text,
  so two "Engineer" options couldn't be told apart.
- These limits cap what an anonymous guest can store, which matters until rate limiting arrives.

## 3. Security

- **The host side follows the usual rules:**
  - the user id comes from the session;
  - the action re-validates with the same schema;
  - the update is scoped by `user_id`.
  - A new IDOR test shows Bob can't replace Alice's questions.
- **The guest side is untrusted.** Everything is re-checked on the server: answers to unknown questions, options
  that weren't offered, wrong types and over-long text are all rejected.
- **Escaping:** answers are rendered as JSX text by React (the page) and React Email (the host's email), the same
  path as notes, which the Day 5 HTML-injection test covers.
- **Answers never go into the guest's email or the invite.** A test checks the text, HTML and both `.ics` files.

## 4. Likely interview questions

- **"Why jsonb and not a questions table?"** They live and die with the event type, are always loaded together,
  and are never queried on their own. jsonb makes a save one write instead of a diff. I'd switch to a table
  if I needed to query or index individual questions. Zod checks the shape, and a CHECK constraint is the
  backstop.
- **"What happens to old answers when a question changes?"** Nothing. Each booking stores a snapshot with the
  label it was asked under, the same idea as an order line keeping the price at the time of purchase.
- **"How do you validate a form whose fields are data?"** I build the Zod schema from the data:
  `answersSchema(questions)`. The same function runs in the browser and in the server transaction, against the
  questions as they are at that moment.
- **"What if the form changes under the user?"** Optimistic concurrency. The form carries a version (a hash of the
  questions), and the server compares it. On a mismatch it refuses with the new questions, and the client
  rebuilds the form, keeping what still fits. It's the same idea as an ETag with `If-Match`.
- **"Why not drag and drop?"** Buttons are accessible by default and trivially testable. Drag and drop needs a
  keyboard alternative anyway, which is the buttons.

## 5. Stories (problems hit and how they were solved)

### A required checkbox that wasn't required

- **What happened:** the unit test "required questions are required, whatever their type" failed for one
  type. A required checkbox with **no answer sent at all** passed validation.
- **Why:** I'd written it as `z.boolean().optional().refine(v => v === true)`. In Zod 4, when an object key
  is missing and its schema is optional, the key is skipped entirely, refinement included. "Must be ticked"
  never ran.
- **What I did:** required questions are no longer `.optional()` at all. A missing key fails the base type
  with the same message, "Tick this to continue". A test now covers "required and missing" for every type,
  not just "required and empty".
- **Lesson:** "not sent" and "sent empty" are different inputs, and a hand-written request will send the first.
  Test both.

### Errors that would have landed on the wrong field

- **What happened:** reading the event type action before wiring in the questions, I saw it returned
  `z.flattenError(error).fieldErrors`. That keys errors by the first path segment only, so an error at
  `questions.2.options.1` would have become a single error on "questions", with no input to show it next to.
- **What I did:** a small helper, `fieldErrorsByPath`, keys errors by the full dotted path, which is the format
  React Hook Form's `setError` takes. It has its own test.
- **Lesson:** the error format has to match the shape of the form. A helper that worked for flat forms
  silently stops working when the form gets nested.

### A test locator that matched four things

- **What happened:** the browser script's first run failed: `getByLabel("Question")` matched the label input,
  **and** "Move question 1 up", "Move question 1 down" and "Remove question 1".
- **Why:** Playwright's label match is a substring match by default, and my accessible names say which question
  a button acts on, which is the right call for screen readers.
- **What I did:** the script uses exact role queries: `getByRole("textbox", { name: "Question", exact: true })`.
- **Lesson:** good accessible names make substring locators ambiguous. Write test locators the way a screen
  reader user would ask: by role and exact name.

### A stale email broke an old script

- **What happened:** after the new Day 10 script, the Day 5 manage script failed. It couldn't find the manage
  page.
- **Why:** the scripts share an email outbox folder. The manage script took the newest guest email, which was
  left over from the Day 10 run, for a booking that the reseeded database no longer had. The manage page
  correctly returned 404.
- **What I did:** the manage script now empties the outbox before it starts, like the Day 10 script does.
- **Lesson:** a test should set up its own world, not inherit one. Each script reseeds the database, so it has
  to reset the outbox too.

### The underline that wasn't there

- **What happened:** in the editor screenshot, every "Question 1" heading looked underlined.
- **Why:** the computed style had no text decoration. Zoomed in, it was the tail of Bricolage Grotesque's "Q",
  which runs under the letters and reads as a line at 14px in a muted colour.
- **What I did:** these small row headings now use the body font, Figtree, like the field labels next to them.
  Bricolage stays for real headings.
- **Lesson:** a display face is for display sizes. Zooming into the screenshot answered in seconds what the
  CSS couldn't.

## Next

- **Browser tests in CI:** turn the harness scripts (now including Day 10) into Playwright tests. Then deploy.
  See [backlog.md](backlog.md).
