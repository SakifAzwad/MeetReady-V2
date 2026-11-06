# Day 3: Host dashboard — event types and availability

**Result:** 162 tests (64 new), typecheck, lint, format and production build green. Then a real-browser run
(Chrome, driven by Playwright) against the production build and a real Postgres: create, validate, edit and
toggle event types; edit weekly hours; add date overrides; check mobile layout. All steps pass, no console
errors. That run found 4 bugs the unit tests couldn't (see Stories).

```
src/
├── components/ui/                   # shadcn/ui-style kit: button, input, label, switch, card, field
├── lib/
│   ├── utils.ts                     # cn(): merge Tailwind classes
│   ├── format.ts                    # "1 h 30 min", "9:00am", quarter-hour list
│   └── validation/
│       ├── event-type.ts            # Zod: form + server action (+ AI tools later)
│       └── availability.ts          # Zod: weekly schedule, date overrides, overlap check
├── server/
│   ├── event-types.ts               # owner-scoped CRUD (no hard delete)
│   └── availability.ts              # schedule replace (transaction), overrides, defaults
├── db/index.ts                      # Neon in production, `pg` for a localhost Postgres
└── app/(app)/dashboard/
    ├── layout.tsx + dashboard-nav.tsx
    ├── event-types/                 # list, new, [id]/edit, form, actions, toggle/copy controls
    └── availability/                # page, weekly form, date overrides, time select, actions
```

## 1. Event types

### The rule from Day 2, applied: every query scoped to the session user

```ts
.where(and(eq(eventTypes.id, id), eq(eventTypes.userId, userId)))
```

`userId` comes from `requireOnboardedUser()`, never from the request. That's the whole defence against
**IDOR** (insecure direct object reference): v1 let anyone read or edit any event by id or `?email=`.

- **Tested directly:** Bob gets `not_found` when reading, updating or turning off Alice's event type, and
  Alice's row is unchanged afterwards.
- **Mutation-checked:** removing `userId` from the update's WHERE fails the "can't be updated" test.
- **Checked in the running app:** opening another host's `/dashboard/event-types/<their id>/edit` shows
  "not found", and their event's title never appears in the HTML.
- **404, not 403:** "exists but isn't yours" tells an attacker the id is real. Not found reveals nothing.
- **Malformed ids** (`"1 OR 1=1"`, `""`) return not found before reaching Postgres, which would otherwise throw
  "invalid input syntax for type uuid" and turn into a 500.

### No hard delete

Bookings reference event types with `ON DELETE RESTRICT`, and past bookings must keep their title, duration and
location. So "delete" is a switch: off hides it from guests and stops new bookings.

### The form

- **One Zod schema** (`eventTypeSchema`) for the form (instant errors), the server action (the check that counts)
  and later the AI tools. The DB CHECK constraints from Day 1 are the last guard.
- **Location details depend on the location type** (`superRefine`): Zoom needs an `https://` link, phone a
  phone-like number, in-person an address, Google Meet nothing. Switching to Meet drops leftover details so a
  stale phone number isn't stored.
- **"No limit" is `null`**, never `0` or `""`. `0` would mean "zero bookings per day". The selects map the
  empty option to `null` explicitly.
- **Empty number input → `NaN`** → "Duration must be a number". Zod 4 rejects NaN for `z.number()`; tested.
- **Slug auto-fills from the title** until you edit it yourself (`slugify` strips accents: "Café" → "cafe").
- **Server errors land on the right field:** a duplicate link comes back as `fieldErrors.slug` and is shown
  under the Link input with `setError`. The DB UNIQUE constraint decides, so two tabs creating the same slug
  at once can't both succeed.
- **The form sends raw values; the server parses them.** `handleSubmit` hands you the _transformed_ output
  (description `""` → `null`), which the schema wouldn't accept a second time. So the action gets
  `getValues()` and runs the same parse itself.

### Toggling on/off

`useOptimistic` flips the switch instantly. The server action writes, then calls `refresh()` (Next 16): the
server re-renders the page and sends it back in the same response. If the action fails, React drops the
optimistic value and the real one shows, with "Couldn't save".

## 2. Availability

### Weekly schedule: replace the whole week, in a transaction

The host edits the week as one form, so it's saved as one unit: update timezone, delete the user's rules,
insert the new ones, all in `db.transaction`.

- **Why not diff old vs new rows?** More code and more ways to end up half-old, half-new. Seven days of rules is a
  few rows.
- **Why the transaction?** If an insert fails, the delete rolls back and the old week stays. A guest loading the
  booking page mid-save sees the old week or the new one, never an empty one. **Tested:** a save with an invalid
  row (day 9) fails and the previous schedule and timezone are still there.
- **`tx` is passed where a `Database` is expected.** A Drizzle transaction has the same API as the database, so
  `ensureDefaultAvailability(tx, userId)` joins the transaction without special code.

### Validation

- Ranges on a day can't overlap (touching is fine: 9–12 and 12–5). `findOverlap` sorts, then compares
  neighbours: O(n log n).
- An enabled day needs at least one range.
- A turned-off day **keeps** its ranges (switch it back on and they return), so those are validated too.
- Times are 15-minute steps in a `<select>`, not `<input type="time">`: a time input can't express `24:00`
  (end of day), which availability needs ("until midnight").

### Date overrides

One row per range for that date; one row with null times = day off (the Day 1 schema). Saving replaces that
date's rows in a transaction. The page lists overrides from **today in the host's timezone**, not the server's:
Vercel runs in UTC, so at 2am in Dhaka the server still thinks it's yesterday.

### Defaults for new hosts

Onboarding now also adds Mon–Fri 09:00–17:00, in the same transaction as setting the username. Tested: if the
username is taken, the transaction rolls back and no rules are created. Only added if the host has none, so
re-running never overwrites.

## 3. UI decisions

- **shadcn/ui pattern:** the component source lives in the repo (`components/ui`), built on Radix primitives
  (Switch, Label, Slot) with `class-variance-authority` for variants and design tokens in `globals.css`. The
  shadcn registry was blocked in my build environment, so these were written by hand following shadcn's
  patterns. They aren't byte-for-byte registry copies; `npx shadcn add <component>` on your machine can replace
  any of them, keeping the same props.
- **Native `<select>`** for times and timezones: accessible for free, and phones show their own picker.
- **`Field` component** wires label, hint and error to the control with `aria-describedby` and `aria-invalid`,
  so a screen reader reads "Duration, invalid entry, must be at least 5".
- **`useWatch` instead of `watch()`**: see Stories.
- **Layout has no auth check** (layouts don't re-run on navigation); each page checks inside `<Suspense>`.

## 4. Running the app against a local Postgres

`db/index.ts` now picks the driver from `DATABASE_URL`: Neon's WebSocket driver in production, the standard
`pg` driver for `localhost`. Neon's driver can't talk to a plain Postgres, and this is what lets a Docker
Postgres or a CI service container work, which the end-to-end tests will need.

## 5. Notes

- **A "not found" page returns HTTP 200 here.** With streaming, the static shell (and its 200 status) is sent
  before the `<Suspense>` part decides the record doesn't exist. Next.js adds `noindex` instead. Fine for a
  logged-in dashboard; it would matter for public SEO pages.
- No schema changes today: no new migration.

## 6. Likely interview questions

- **"How do you prevent users editing each other's data?"** `userId` from the session in every WHERE; tested as
  user B against user A's ids; mutation-checked; checked in the running app.
- **"Why 404 instead of 403?"** Doesn't confirm the id exists.
- **"Why replace the schedule instead of updating rows?"** One unit, simpler, atomic with a transaction.
- **"Why are some inputs controlled and some not?"** RHF's `register` is uncontrolled (fast, no re-render per
  keystroke). Custom widgets (switch, colour picker, nullable number selects) use `Controller`.
- **"How do you keep client and server validation in sync?"** Same Zod schema imported by both.
- **"What's an optimistic update, and what if it fails?"** `useOptimistic` + server action + `refresh()`.

## 7. Stories (problems hit and how they were solved)

### A "flaky" test was a real bug: forms were blank until JavaScript loaded

- **What happened:** the browser test saved Monday's second range as 18:00, reloaded, and read the value back.
  One run said 18:00, the next said 00:00.
- **What I did:** checked the database first: it had 18:00, so saving worked. Then fetched the raw server HTML:
  no `<option selected>` on any time picker or the timezone, and the edit form's title input had no `value`.
  React Hook Form's `register()` is uncontrolled and fills fields from JavaScript **after hydration**, so until
  then every picker showed its first option (12:00am) and the edit form was empty. The test read the field in
  that gap.
- **Fix:** pass each registered field its starting value as `defaultValue`, so it's in the server HTML.
  Verified in the HTML (`6:00pm`, `Asia/Dhaka`, `value="Deep dive"`) and with zero hydration warnings.
- **Lesson:** a test that "sometimes fails" is often reporting a real race. Don't rerun until green. On a slow
  phone, a host would have seen their hours as midnight.

### The build failed on `usePathname()`

- **What happened:** the nav highlights the current page with `usePathname()`. The build failed on
  `/dashboard/event-types/[id]/edit`.
- **Why:** with Cache Components, the static shell is built before the `[id]` is known, so the path isn't known
  either, and a hook reading it must be inside `<Suspense>`.
- **Fix:** the layout renders the nav in `<Suspense>` with the same links (no highlight) as the fallback, so
  nothing visibly jumps.
- **Lesson:** same rule as Day 2's cookies, for URL data: anything request-specific goes behind Suspense.

### The linter caught a React Compiler incompatibility

- **What happened:** ESLint warned that `watch()` from React Hook Form "cannot be memoized safely": the React
  Compiler would skip optimising the form and could show stale values.
- **Fix:** `useWatch({ control, name })`, which subscribes to just that field and is compiler-safe.
- **Lesson:** take lint warnings from the React hooks plugin seriously; they're about correctness, not style.

### 1 pixel of overflow on mobile

- **What happened:** the mobile check measured `scrollWidth - innerWidth = 1` on the availability page, enough
  for the page to wobble sideways under your thumb.
- **What I did:** listed elements whose right edge passed the viewport: the form card. Cause: grid items default
  to `min-width: auto`, so the longest timezone name in the select stretched the column.
- **Fix:** `grid-cols-[minmax(0,1fr)]`. Overflow 0. Also fixed the nav wrapping "Event types" onto two lines.
- **Lesson:** measure layout in a test instead of eyeballing screenshots.

### Ambiguous labels, found by automating the browser

- **What happened:** the test asked for the field labelled "Range 1 start" and Playwright found seven: one per
  weekday plus the override form.
- **Fix:** labelled them "Override range 1 start" and so on. If a test can't tell fields apart by label, neither
  can a screen-reader user.
- **Lesson:** writing tests that find elements by accessible name (`getByLabel`, `getByRole`) doubles as an
  accessibility audit.

### Testing a Google-login app without Google

- **Problem:** a real browser test needs a logged-in host and a database, but there were no Google credentials
  and no Docker in my environment.
- **What I did:** ran PGlite as a Postgres server over TCP with the real migrations, added the `pg` driver path
  for localhost, and created a session row plus a correctly signed session cookie (read Better Auth's source:
  HMAC-SHA256 of the token with `BETTER_AUTH_SECRET`). The production build accepted it like a real login.
- **A detour worth admitting:** one run tested a stale server, because the old process still held port 3000.
  I wrote a restart script that waits for ports and checks for `EADDRINUSE` before trusting results.
- **Lesson:** make the test environment trustworthy before blaming the app.

## Next (day 4)

The public booking page `/[username]/[event]`: month view, free slots from `generateSlots()` in the guest's
timezone, booking form, and the booking action with the Day 1 exclusion constraint turning a race into
"that slot was just taken".
