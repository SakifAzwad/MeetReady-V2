import type { BandSegment } from "@/lib/scheduling/daylight";
import type * as React from "react";
import { cn } from "@/lib/utils";

/*
 * The daylight band, drawn: one day from midnight to midnight, with working
 * hours bracketed. Used by the booking page and the landing page.
 *
 * The colours are symbolic (night, dawn, day, dusk at fixed hours), not real
 * sunrise times: the point is "3 AM is the middle of the night for you", not
 * astronomy. They match the part-of-day dots on the booking page's time rows.
 * Decorative for screen readers: every use pairs it with a sentence in words.
 */
const DAYLIGHT =
  "linear-gradient(90deg, var(--night) 0%, var(--night) 17%, var(--dawn) 25%, var(--band-day) 33%, var(--band-noon) 55%, var(--band-day) 70%, color-mix(in oklab, var(--dusk), white 35%) 78%, var(--dusk) 82%, var(--night) 90%, var(--night) 100%)";

export function Band({
  segments,
  nowAt = null,
  shiftHours = 0,
  className,
  children,
}: {
  segments: Pick<BandSegment, "left" | "width">[];
  nowAt?: number | null;
  /**
   * Slides the colours so the band shows a day `shiftHours` ahead of the x axis.
   * The landing page uses it to draw the host's day on the visitor's timeline:
   * one x position is one moment for both, only the colours (local time) differ.
   */
  shiftHours?: number;
  className?: string;
  /** Extra marks drawn on top (the dashboard uses it for booked meetings). */
  children?: React.ReactNode;
}) {
  // 0–1 of a day. The gradient is tiled twice in a 200%-wide strip, so sliding
  // it left by up to one tile never shows a gap.
  const shift = (((shiftHours / 24) % 1) + 1) % 1;
  return (
    // The faint ring keeps the night ends visible against a dark card.
    <div
      aria-hidden
      className={cn(
        "relative h-12 overflow-hidden rounded-xl ring-1 ring-black/5 ring-inset dark:ring-white/25",
        className,
      )}
    >
      <div
        className="absolute inset-y-0 left-0 w-[200%] transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{
          backgroundImage: DAYLIGHT,
          backgroundSize: "50% 100%",
          backgroundRepeat: "repeat-x",
          transform: `translateX(-${shift * 50}%)`,
        }}
      />
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
