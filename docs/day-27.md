# Day 27: A booking widget for other websites

**Result:**

- **Hosts can put their booking calendar on their own site**, inline or as a popup. **Dashboard → Event types →
  Embed** on any card opens a dialog with both snippets (Inline / Popup tabs), a theme choice (Light, Dark, Follow
  the device) and **Copy code**. The snippets point at the deployment they came from.
- **One script, `public/embed.js`**: plain JavaScript, no dependencies, about 270 lines. It finds
  `data-meetready-inline="user/slug"` elements (also ones a framework adds later) and `data-meetready-popup` links,
  and creates an iframe of **`/embed/{username}/{slug}`**: the same booking widget, server actions and protections
  as the booking page.
- **Only `/embed/…` can be framed**, by any site (`frame-ancestors *`, no `X-Frame-Options`). Every other route
  still refuses (`frame-ancestors 'none'`, `DENY`). The rules moved to `src/lib/security-headers.ts`, and a test runs
  them through Next's own path matcher.
- **The frame fits its content**, growing and shrinking at each step (the page inside reports its height).
- **The popup is a native `<dialog>`**: Escape, × or a click outside closes it, and focus goes back to the link.
  Escape works even when focus is inside the frame. Closing by accident keeps what was typed; after a booking, the
  next open starts fresh. The popup snippet is a real link to the booking page, so it still works without the
  script.
- **A `meetready:booked` DOM event** tells the site a booking was made: username, slug, start and end. Never the
  guest's name, email, notes or answers.
- **See-through on the site's page:** no background of its own, and the iframe's `color-scheme` set to match the
  page inside (without that, the browser paints an opaque box: Story 1).
- **Also:** `embed` reserved as a username and listed in `APP_ROUTES`; `/embed/…` gets the same real 404 from
  `proxy.ts` as the booking page; the assistant box's Privacy link opens in a new tab; a privacy-page paragraph
  (`#embed`); a guide for site owners, `docs/embed.md`; runbook step 20; README screenshot `embed.png`.
- **Tests:** 793 unit tests (22 new) and 50 E2E tests (6 new, in `e2e/embed.spec.ts`, against a fake customer site
  on another origin). The new spec passed 3 times in a row, and the two hardest tests were made to fail once on
  broken code (the resize and Escape protections removed). Typecheck, lint, format, `drizzle-kit check` and the
  build are green.
- **Setup:** none. No migration, no variable. Runbook **step 20** (CodePen, then your portfolio).

## 1. Decisions (Sakif's picks, from the options proposed)

### An iframe, not our widget drawn into the site's page

The alternative is a script that renders the widget straight into the host's page (or into a Shadow DOM web
component). An iframe isolates both ways:

- **The site can't break us:** its CSS never reaches the frame. A shadow root still inherits fonts, colours and
  line heights from the page.
- **We don't trust the site with guests' data:** its scripts (analytics, chat widgets, anything) can't read what a
  guest types into a frame from another origin.
- **Booking stays exactly as it is:** the server actions are same-origin requests from the frame. Drawn into the
  site's page, every request would be cross-origin: CORS, and server actions refuse a foreign `Origin` anyway.

The cost: the frame can't size itself, and keys pressed inside it never reach the page. Both are solved with
messages (below).

### Any site may frame it (`frame-ancestors *`)

Calendly's model. Why it's safe: clickjacking needs a page whose click does something the attacker wants. The
embed page does what the public booking page already does, for anyone, with no login, and a booking still needs a
name and email typed in. Everything with power stays unframeable: the dashboard, a guest's manage page (cancel in
one click), the AI consent page. Proved per route in `security-headers.test.ts` and against the built app in E2E.

And the host's own session can't leak into a frame: Better Auth's cookie is `SameSite=Lax`, which browsers never
send to a frame inside another site. A host browsing a site that embeds their page is an anonymous guest there.

A per-host list of allowed sites went to the backlog: it would protect little, and needs `frame-ancestors` per
host from the database.

**Two rules that don't overlap:** Next merges every matching header rule, and a later rule can override a header
but never remove one. "Deny everywhere, then allow `/embed`" would leave `X-Frame-Options: DENY` on the embed. So:
`/:path((?!embed/).*)` gets the deny headers, `/embed/:path*` the allow header. A test checks every path matches
exactly one.

### A separate route, `/embed/{username}/{slug}`

Not `?embed=1` on the booking page: headers in Next are chosen by path, and a query flag would also make the
static booking page read search params (dynamic rendering). The route renders the same `BookingWidget` with no page
chrome, plus `EmbedRoot` (height and Escape messages) and `EmbedWidget` (the booked message). The widget gained one
prop, `onBooked`, rather than knowing it's embedded (Day 25's rule: pass the difference in).

### Messages: checked by origin AND source, private data never sent

```
frame → page: { source: "meetready", version: 1, type: "resize" | "booked" | "escape", … }
```

- **embed.js accepts a message only if `event.origin` is MeetReady's** (taken from the script's own `src`) **and
  `event.source` is one of the frames it created.** Origin alone isn't enough: the site may frame MeetReady another
  way too. A message the site forges itself is ignored (tested).
- **The frame sends with `targetOrigin "*"`.** It can't know which site it's in (`location.ancestorOrigins` doesn't
  exist in Firefox). That's acceptable only because no message carries anything private, and that's a rule of its
  own: any site can embed any host's page, so the page around the frame isn't necessarily the host's. The guest's
  details reach the host by email, dashboard or signed webhook, never through the page.
- **`version: 1`** in every message: a page left open across a deploy runs the old script against the new frame.
  The version lets a future script and frame tell each other apart.

### Resizing: measure our own box

The frame reports `[data-embed-root]`'s height through a `ResizeObserver`; embed.js sets the iframe's height,
clamped to 120–4000 px. Not the document's height: the root layout gives `<body>` a min-height of the viewport, and
inside a frame the viewport is the iframe. Sized from the document, the frame could grow but never shrink (Story 2).

### The popup: a native `<dialog>`

`showModal()` gives focus moving into the dialog, the rest of the page inert, Escape, and the top layer (no
z-index fights with the site), all for free. embed.js adds: scroll lock on the page, focus back on the link, a
backdrop click, and Escape from inside the frame (Story 3). Its CSS classes are prefixed `meetready-`, and the
close button starts from `all: unset` so the site's button styles don't reach it.

### A link, not a button, in the popup snippet

`<a href="…/user/slug" data-meetready-popup="user/slug">`. The script turns a plain click into the popup.
Ctrl/Cmd/middle-click keep their meaning (new tab), and if the script is blocked, slow or broken, the link opens
the booking page. Progressive enhancement, tested by serving an empty `embed.js`.

### Theme: from the snippet, light by default

The embed's theme comes from `?theme=dark|system` (set by `data-meetready-theme`), never from storage. The guest's
saved choice belongs to MeetReady's own pages, and inside a frame the browser keeps a separate per-site copy of our
storage anyway (storage partitioning). The head script (`THEME_SCRIPT`) checks the path first.

**Changed from the plan:** I proposed "follow the device" as the default. While building, it turned out wrong: most
sites don't follow the device, so a guest in dark mode would get a dark calendar in a light page, on an opaque dark
box (Story 1). Light is the default; `system` is an option for sites that do follow the device.

### Not now (backlog)

Pre-filling name and email (in the URL they'd land in request logs; a message after load is the clean way), a list
of allowed sites per host, bookings by source in Insights, a versioned script with long caching.

## 2. Likely interview questions

- **Why an iframe?** Isolation both ways (CSS in, data out) and same-origin server actions. The cost is height and
  keyboard messages.
- **Isn't `frame-ancestors *` a clickjacking hole?** Only on a page with nothing to steal: it does what the public
  booking page does, and needs typed input. The pages with power refuse to be framed, tested per route. The
  session cookie is `SameSite=Lax`, so a frame is never signed in.
- **How does the parent trust a `postMessage`?** Check `event.origin` against a known origin AND `event.source`
  against the frames you created. Never trust `data` alone; validate its shape and clamp numbers.
- **Why `targetOrigin "*"`?** The frame can't reliably know its parent. Fine because the messages hold nothing
  private, by design.
- **What breaks in a third-party iframe?** Cookies (`SameSite=Lax` isn't sent; we need none), storage (partitioned
  per top-level site, or blocked in Safari: theme comes from the URL, and storage reads are in `try`), keyboard
  events (Escape), and sizing.
- **How does auto-resize work, and what's the trap?** `ResizeObserver` on your own content box, message, parent sets
  the height. Measuring the document creates a loop with anything sized from the viewport.
- **How do you ship a script that runs on sites you don't control?** No dependencies, no globals but one,
  prefixed CSS, defensive styles (`all: unset`), loaded twice = harmless, works with SPAs (`MutationObserver`),
  degrades to a link. Backward compatibility forever: the URL is the contract.
- **How did you test it?** A fake customer site on 127.0.0.1 (a different site from `localhost`) serving the real
  snippet; Playwright `frameLocator` books inside the frame, then checks the DOM event, the database and the frame's
  height.

## 3. Stories (problems hit and how they were solved)

### 1. A transparent frame that painted a black box

**Problem:** the embed page has no background, so the site's page should show around the calendar. With
`theme=dark` on a light page, a screenshot showed the calendar on a solid near-black rectangle filling the frame.
Nothing in our CSS was black.

**What I did:** the CSS Color Adjust spec: an iframe is drawn see-through only when the color-scheme of the page
inside matches the iframe element's own. Our dark page says `color-scheme: dark`; the iframe element on a site
inherits `normal` (light). On a mismatch the browser paints an opaque canvas in the inner page's scheme. Fix:
embed.js sets the iframe's `color-scheme` from the same theme it puts in the URL (`light`, `dark`, or `light dark`
for system). Two screenshots, the script with and without that line, confirmed it, and the E2E test checks both
the transparent body and the iframe's computed `color-scheme`.

**Lesson:** a frame's transparency is a contract between two documents. When styling crosses a frame, check what
each side declares, and test it with a screenshot and a computed style, not by reading CSS.

### 2. A frame that could grow but never shrink

**Problem:** the first idea for auto-resize is "send `document.documentElement.scrollHeight`". Our root layout
gives `<body>` `min-height: 100%`, and inside a frame 100% is the iframe's height. So the document is always at
least as tall as the frame: when the content shrinks (the confirmation is shorter than the form), the reported
height stays put, and the guest sees a big empty gap.

**What I did:** measured our own outermost box (`[data-embed-root]`, which sizes to its content) instead. The test
books through the frame and asserts the frame is within a pixel of the content at three moments, and that it is
shorter on the confirmation than on the form. Then I put the document measurement back for one run: the test failed
with the frame about 600 px taller than what was in it.

**Lesson:** inside a frame, anything sized from the viewport is sized from the frame. Measure your own box, and
test the shrinking direction: growing works even with the broken version.

### 3. Escape that never reached the dialog

**Problem:** a native `<dialog>` closes on Escape, but in the popup the guest is typing inside the frame, and key
events go to the frame's document. The site's page never sees them, so Escape did nothing exactly when the guest
was most likely to press it.

**What I did:** the frame listens for Escape on `window` in the bubbling phase and, if nothing inside used it
(`defaultPrevented`: the timezone list and the assistant's box use Escape themselves), posts an `escape` message.
embed.js closes the popup only for a message from the popup's own frame (an inline frame on the same page sends
them too). The E2E test presses Escape in the frame's Name field and checks the dialog closes and focus is back on
the link; with the message removed, it fails.

**Lesson:** a frame is a keyboard boundary. Each keyboard behaviour that spans the two documents needs its own
message, and a test that presses the key inside the frame.

### 4. A link that would have opened the privacy page inside the frame

**Problem:** reading every link in the widget before building, the assistant box's "Privacy" was a Next.js
`<Link>`. Inside the embed it would navigate client-side within the iframe, replacing the half-filled booking with
the privacy page. A full load would have been worse: `/privacy` refuses to be framed.

**What I did:** a plain `<a target="_blank" rel="noopener">`, with "(opens in a new tab)" for screen readers. That
helps the normal booking page too: a guest checking the policy no longer loses what they typed. The embed's own
credit link does the same.

**Lesson:** framing changes what every link does. List the links in anything you embed, and decide for each where
it should open.

## Next

Push Day 27, then runbook step 20 (CodePen, then the portfolio). Phase 2 is done. Candidates for Day 28 in
`docs/backlog.md`: the 5-minute slot hold, round-robin team scheduling, or the domain day.
