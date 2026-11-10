"use client";

import { useSyncExternalStore } from "react";

/*
 * Guest display preferences that live in the browser, not the database.
 * useSyncExternalStore (instead of useState + useEffect) reads localStorage
 * without a hydration mismatch: the server and the first client render use
 * the default, then React switches to the stored value.
 */

const KEY = "meetready:hour12";
const EVENT = "meetready:prefs";

/**
 * The visitor's own clock style, from the browser's locale: en-US says h12,
 * en-GB and de-DE say h23. So most of Europe gets 24-hour times without
 * having to find a toggle.
 */
export function browserPrefers12h(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
}

/** An explicit choice (stored) wins; otherwise the browser's locale decides. */
function read(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored !== "24";
  } catch {
    // storage can be blocked (private mode, embedded frames): fall through to the locale
  }
  return browserPrefers12h();
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(EVENT, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useHour12(): [boolean, (value: boolean) => void] {
  const hour12 = useSyncExternalStore(subscribe, read, () => true);
  const set = (value: boolean) => {
    try {
      window.localStorage.setItem(KEY, value ? "12" : "24");
    } catch {
      // not persisted, but the choice still applies below via the event
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [hour12, set];
}

/** Re-renders once a minute; null on the server (so clocks render nothing until hydrated). */
export function useMinuteClock(): Date | null {
  const minute = useSyncExternalStore(
    (onChange) => {
      const id = window.setInterval(onChange, 15_000);
      return () => window.clearInterval(id);
    },
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return minute === null ? null : new Date(minute * 60_000);
}
