/*
 * MeetReady booking widget for other websites (Day 27). Guide: docs/embed.md.
 *
 *   Inline: <div data-meetready-inline="username/event"></div>
 *   Popup:  <a href="https://…/username/event" data-meetready-popup="username/event">Book a meeting</a>
 *   Then:   <script src="https://…/embed.js" async></script>
 *   Option: data-meetready-theme="dark" | "system" (light by default)
 *   Event:  "meetready:booked" bubbles from the element, detail = { username, slug, startsAt, endsAt }
 *   API:    window.MeetReady.open("username/event", { theme }), .close(), .scan()
 *
 * This file runs on other people's pages, so it is plain JavaScript with no
 * dependencies, touches nothing global except window.MeetReady and its own
 * prefixed CSS classes, and only ever trusts messages from MeetReady's origin
 * AND from a frame it created itself. The messages are described in
 * src/lib/embed.ts (the frame's side); keep the two in step.
 *
 * The booking page always lives in an iframe, never in the site's own DOM: the
 * site's CSS can't break it, the site's scripts can't read what the guest
 * types, and the booking's server actions stay same-origin requests to
 * MeetReady (no CORS, no cookies).
 */
(function () {
  "use strict";

  // The snippet pasted twice on one page: the first copy does the work.
  if (window.MeetReady && window.MeetReady.version) return;

  // MeetReady's address is wherever this script came from, so one snippet works on previews and production.
  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("MeetReady: load embed.js with a <script src> tag (not as a module).");
    return;
  }
  var ORIGIN = new URL(script.src).origin;

  // Same rules as usernames and event slugs: anything else is a typo, or an attempt to frame another page.
  var NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  /*
   * Theme -> the iframe element's color-scheme. A frame is drawn see-through only
   * when its page's color-scheme matches the iframe element's (CSS Color Adjust);
   * otherwise the browser paints an opaque canvas behind it. The embed page sets
   * its own color-scheme from the same theme (src/lib/theme.ts, globals.css), so
   * setting it here too keeps the site's background showing around the card.
   */
  var COLOR_SCHEMES = { light: "light", dark: "dark", system: "light dark" };

  /** Every frame this script made, with the element that owns it (where events are sent). */
  var frames = [];
  var dialog = null;
  var popup = null; // { key, frame, booked }
  var opener = null;
  var savedOverflow = "";

  function parseTarget(value) {
    var parts = String(value || "")
      .trim()
      .toLowerCase()
      .split("/");
    if (parts.length !== 2 || !NAME.test(parts[0]) || !NAME.test(parts[1])) return null;
    return parts[0] + "/" + parts[1];
  }

  function themeOf(value) {
    return Object.prototype.hasOwnProperty.call(COLOR_SCHEMES, value) ? value : "light";
  }

  function makeFrame(target, theme, owner, lazy) {
    var iframe = document.createElement("iframe");
    // Before src: below the fold, an inline frame loads only when the guest scrolls near it.
    if (lazy) iframe.loading = "lazy";
    iframe.src = ORIGIN + "/embed/" + target + (theme === "light" ? "" : "?theme=" + theme);
    iframe.title = "Book a meeting with MeetReady";
    // A starting height close to the real one; the page inside reports its height once it has drawn.
    iframe.style.cssText =
      "display:block;width:100%;height:640px;border:0;background:transparent;color-scheme:" +
      COLOR_SCHEMES[theme];
    var frame = { iframe: iframe, owner: owner, popup: false };
    frames.push(frame);
    return frame;
  }

  /* ─── Messages from the frames ─────────────────────────────────────────── */

  window.addEventListener("message", function (event) {
    // Both checks: the origin proves it's MeetReady, the source proves it's one of OUR frames
    // (the site may embed MeetReady some other way too, or have other frames from us).
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || data.source !== "meetready" || data.version !== 1) return;
    frames = frames.filter(function (f) {
      return f.iframe.isConnected;
    });
    var frame = null;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].iframe.contentWindow === event.source) frame = frames[i];
    }
    if (!frame) return;

    if (data.type === "resize") {
      var height = Number(data.height);
      if (!isFinite(height) || height <= 0) return;
      // Clamped: a frame can't push the site's layout around without limit.
      frame.iframe.style.height = Math.min(Math.max(Math.ceil(height), 120), 4000) + "px";
    } else if (data.type === "booked") {
      if (frame.popup && popup) popup.booked = true;
      var owner = frame.owner && frame.owner.isConnected ? frame.owner : document;
      owner.dispatchEvent(
        new CustomEvent("meetready:booked", {
          bubbles: true,
          detail: {
            username: String(data.username),
            slug: String(data.slug),
            startsAt: String(data.startsAt),
            endsAt: String(data.endsAt),
          },
        }),
      );
    } else if (data.type === "escape") {
      if (frame.popup) close();
    }
  });

  /* ─── Inline ───────────────────────────────────────────────────────────── */

  // A WeakSet, not an attribute: frameworks that render the element (React) shouldn't see it change.
  var mounted = new WeakSet();

  function mountInline(el) {
    if (mounted.has(el)) return;
    var target = parseTarget(el.getAttribute("data-meetready-inline"));
    if (!target) {
      console.warn(
        'MeetReady: data-meetready-inline should be "username/event", got:',
        el.getAttribute("data-meetready-inline"),
      );
      mounted.add(el);
      return;
    }
    mounted.add(el);
    var frame = makeFrame(target, themeOf(el.getAttribute("data-meetready-theme")), el, true);
    el.appendChild(frame.iframe);
  }

  function scan() {
    var found = document.querySelectorAll("[data-meetready-inline]");
    for (var i = 0; i < found.length; i++) mountInline(found[i]);
  }

  /* ─── Popup ────────────────────────────────────────────────────────────── */

  var STYLE =
    ".meetready-dialog{box-sizing:border-box;margin:auto;padding:0;border:0;background:transparent;" +
    "width:min(1100px,calc(100vw - 1rem));max-width:none;max-height:calc(100dvh - 1rem);overflow:auto;" +
    "color-scheme:light}" +
    ".meetready-dialog::backdrop{background:rgba(15,20,36,.6)}" +
    ".meetready-dialog .meetready-bar{display:flex;justify-content:flex-end;padding:0 .5rem .25rem}" +
    // all:unset first: the site's own button styles must not reach ours.
    ".meetready-dialog .meetready-close{all:unset;box-sizing:border-box;display:inline-flex;" +
    "align-items:center;justify-content:center;width:2.25rem;height:2.25rem;border-radius:999px;" +
    "background:#fff;color:#18213a;cursor:pointer;box-shadow:0 2px 8px rgba(15,20,36,.25)}" +
    ".meetready-dialog .meetready-close:focus-visible{outline:3px solid #8fa8d8;outline-offset:2px}";

  function ensureDialog() {
    if (dialog) return dialog;
    var style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    dialog = document.createElement("dialog");
    dialog.className = "meetready-dialog";
    dialog.setAttribute("aria-label", "Book a meeting");

    var bar = document.createElement("div");
    bar.className = "meetready-bar";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "meetready-close";
    button.setAttribute("aria-label", "Close");
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    button.addEventListener("click", close);
    bar.appendChild(button);
    dialog.appendChild(bar);

    // The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) close();
    });
    // Every way out (Escape on the page, the button, the backdrop, close()) ends here.
    dialog.addEventListener("close", function () {
      document.documentElement.style.overflow = savedOverflow;
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
      opener = null;
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function open(value, options, owner) {
    var target = parseTarget(value);
    if (!target) {
      console.warn('MeetReady: open() needs "username/event", got:', value);
      return false;
    }
    if (typeof HTMLDialogElement !== "function") {
      window.location.href = ORIGIN + "/" + target; // very old browser: the booking page itself
      return true;
    }
    var theme = themeOf(options && options.theme);
    ensureDialog();
    var key = target + "?" + theme;
    // The same frame comes back after an accidental close (what was typed is still there),
    // but a fresh one after a booking, so the next guest doesn't see the last confirmation.
    if (!popup || popup.key !== key || popup.booked) {
      if (popup) popup.frame.iframe.remove();
      popup = { key: key, frame: makeFrame(target, theme, null, false), booked: false };
      popup.frame.popup = true;
      dialog.appendChild(popup.frame.iframe);
    }
    popup.frame.owner = owner || null;
    if (!dialog.open) {
      opener = document.activeElement;
      savedOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden"; // the page behind doesn't scroll
      dialog.showModal(); // focus moves to the Close button; Escape and the backdrop close it
    }
    return true;
  }

  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  document.addEventListener("click", function (event) {
    // Ctrl/Cmd/Shift-click and middle-click keep their meaning: open the booking page in a new tab.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var el = event.target instanceof Element ? event.target.closest("[data-meetready-popup]") : null;
    if (!el) return;
    if (!parseTarget(el.getAttribute("data-meetready-popup"))) return; // a broken value: the link stays a link
    event.preventDefault();
    open(el.getAttribute("data-meetready-popup"), { theme: el.getAttribute("data-meetready-theme") }, el);
  });

  /* ─── Start ────────────────────────────────────────────────────────────── */

  window.MeetReady = {
    version: 1,
    open: function (target, options) {
      return open(target, options, null);
    },
    close: close,
    scan: scan,
  };

  scan();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  // Sites built with React, Vue and the like add elements later: mount those as they appear.
  if (typeof MutationObserver === "function") {
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        scan();
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
