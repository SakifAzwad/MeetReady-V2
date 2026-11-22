# Putting MeetReady on your website

MeetReady's booking calendar can sit inside your own site (Day 27). Guests pick a time and book without leaving
your page. The easy way to get the code: **Dashboard → Event types → Embed** on the meeting type you want.

## The two snippets

**Inline:** the calendar sits where you put the first line, and the frame grows and shrinks to fit it.

```html
<div data-meetready-inline="sakifazwad18/intro"></div>
<script src="https://meetreadyv2.vercel.app/embed.js" async></script>
```

**Popup:** a link that opens the calendar over your page. Escape, the × button or a click outside closes it, and
focus goes back to the link. Closing by accident loses nothing: open it again and what the guest typed is still
there (after a booking, the next open starts fresh).

```html
<a href="https://meetreadyv2.vercel.app/sakifazwad18/intro" data-meetready-popup="sakifazwad18/intro">
  Book a meeting
</a>
<script src="https://meetreadyv2.vercel.app/embed.js" async></script>
```

It's a real link on purpose: if the script is blocked or hasn't loaded yet, the click opens your booking page.
Ctrl/Cmd-click opens it in a new tab, as with any link. Any element can be the trigger (a `<button>` too), but
only a link still works without the script.

`sakifazwad18/intro` is `username/event-type-slug`. Put the `<script>` line once per page, even with several
widgets; a second copy does nothing.

## Options

- **Theme:** `data-meetready-theme="dark"` or `"system"` (follows the guest's device; use it only if your site
  does too). Light when absent. The calendar has no background of its own, so your page shows around it.

## When a guest books

The element (the `div` or the link) fires a `meetready:booked` event that bubbles up to `document`:

```js
document.addEventListener("meetready:booked", (event) => {
  const { username, slug, startsAt, endsAt } = event.detail; // ISO 8601 times, in UTC
  // e.g. gtag("event", "booked_meeting", { slug });
});
```

The event carries the meeting type and its times, **never the guest's name, email, notes or answers**. Any site
can embed any booking page, so the page around the frame isn't necessarily the host's. You (the host) get the
guest's details by email, on the dashboard, or through a [webhook](webhooks.md).

## From JavaScript

```js
MeetReady.open("sakifazwad18/intro", { theme: "dark" }); // opens the popup; returns false for a bad name
MeetReady.close();
MeetReady.scan(); // mounts inline elements added since (usually not needed: see below)
```

## React, Next.js and other frameworks

Elements your framework adds after the script loaded are found by themselves (the script watches the page). Load
the script **after** your framework has taken over the page, or the framework may see an `<iframe>` it didn't
render and remove it:

```tsx
import Script from "next/script";

export function BookACall() {
  return (
    <>
      <div data-meetready-inline="sakifazwad18/intro" />
      <Script src="https://meetreadyv2.vercel.app/embed.js" strategy="afterInteractive" />
    </>
  );
}
```

## If your site has a Content Security Policy

Allow MeetReady's script and frame:

```
script-src … https://meetreadyv2.vercel.app;
frame-src … https://meetreadyv2.vercel.app;
```

## If something looks wrong

- **Nothing appears:** check the browser console. A typo in `username/slug` is reported there (`MeetReady: …`).
  A Content Security Policy or an ad blocker can block the script; the popup link still works then.
- **"Page not found" inside the frame:** the event type is off, or the name is wrong.
- **A dark box around the calendar:** the theme doesn't match your page. Pick the theme that matches your site.

## How it works (and why)

- **An iframe, not our code inside your page.** Your CSS can't break the calendar, your scripts can't read what
  the guest types, and the booking goes to MeetReady exactly as it does on the booking page, with the same
  protections (no double booking, rate limits).
- **`/embed/{username}/{slug}`** is the only MeetReady page that other sites may frame (`frame-ancestors *`).
  Every other page refuses (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), so a site can't hide MeetReady's
  dashboard or a guest's cancel page under a click.
- **Messages between the frame and your page** are accepted only from MeetReady's origin _and_ from a frame the
  script created. The frame reports its height (so it never scrolls inside), new bookings, and an Escape the
  guest pressed inside it (key presses inside a frame never reach your page, so the popup couldn't close
  otherwise).
