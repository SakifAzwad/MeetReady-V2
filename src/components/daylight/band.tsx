import type { BandSegment } from "@/lib/scheduling/daylight";
import type * as React from "react";
import { cn } from "@/lib/utils";

/*
 * The daylight band, drawn: one day from midnight to midnight, with working
 * hours bracketed. Used by the booking page and the landing page.
 *
 * The colours come from the real sun when a page knows the place and date
 * (skyGradient in lib/scheduling/sky.ts). DAYLIGHT below is the symbolic day
 * for illustrations with no particular place: login, 404.
 * Decorative for screen readers: every use pairs it with a sentence in words.
 */
export const DAYLIGHT =
  "linear-gradient(90deg, var(--night) 0%, var(--night) 17%, var(--dawn) 25%, var(--band-day) 33%, var(--band-noon) 55%, var(--band-day) 70%, color-mix(in oklab, var(--dusk), white 35%) 78%, var(--dusk) 82%, var(--night) 90%, var(--night) 100%)";

export function Band({
  segments,
  nowAt = null,
  markerAt = null,
  gradient = DAYLIGHT,
  highlights = [],
  className,
  children,
}: {
  segments: Pick<BandSegment, "left" | "width">[];
  nowAt?: number | null;
  /** The scrub marker (0–100), drawn over everything; see ScrubBand. */
  markerAt?: number | null;
  /**
   * The sky: skyGradient(zone, range) for real sunrise and sunset. Defaults
   * to the symbolic day, for illustrations with no particular place or date.
   */
  gradient?: string;
  /** Parts of the brackets to light up (the booking page: the host's hours inside your daytime). */
  highlights?: Pick<BandSegment, "left" | "width">[];
  className?: string;
  /** Extra marks drawn on top (the dashboard uses it for booked meetings). */
  children?: React.ReactNode;
}) {
  return (
    // The faint ring keeps the night ends visible against a dark card.
    <div
      aria-hidden
      className={cn(
        "relative h-12 overflow-hidden rounded-xl ring-1 ring-black/5 ring-inset dark:ring-white/25",
        className,
      )}
      style={{ backgroundImage: gradient }}
    >
      {/* Drawn under the brackets: a soft white fill with a glow, so the good part reads first. */}
      {highlights.map((h, i) => (
        <div
          key={`h${i}`}
          className="absolute inset-y-1.5 rounded-lg bg-white/60 shadow-[0_0_16px_4px_rgb(255_255_255/0.55)] transition-[left,width] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
          style={{ left: `${h.left}%`, width: `${h.width}%` }}
        />
      ))}
      {/*
       * Keyed by position in the list (not by value) so that when the day or
       * the city changes, the same bracket slides to its new place via the
       * CSS transition instead of being replaced.
       */}
      {segments.map((s, i) => (
        <div
          key={i}
          className="absolute inset-y-1.5 rounded-lg border-2 border-white shadow-[0_0_0_2px_rgb(24_33_58/0.3)] transition-[left,width] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
          style={{ left: `${s.left}%`, width: `${s.width}%` }}
        />
      ))}
      {children}
      {nowAt !== null && (
        <div
          className="absolute inset-y-0 w-0.5 bg-white transition-[left] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
          style={{ left: `${nowAt}%` }}
        />
      )}
      {markerAt !== null && (
        <div
          className="absolute inset-y-0 -ml-[2px] w-1 rounded-full bg-white shadow-[0_0_0_1.5px_rgb(24_33_58/0.55)]"
          style={{ left: `${markerAt}%` }}
        />
      )}
    </div>
  );
}

export function BandTicks({ hour12 = true }: { hour12?: boolean }) {
  return (
    <div aria-hidden className="text-muted-foreground flex justify-between text-xs">
      <span>Midnight</span>
      <span>{hour12 ? "6 AM" : "06:00"}</span>
      <span>{hour12 ? "Noon" : "12:00"}</span>
      <span>{hour12 ? "6 PM" : "18:00"}</span>
      <span>Midnight</span>
    </div>
  );
}
