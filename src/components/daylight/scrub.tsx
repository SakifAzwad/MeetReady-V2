"use client";

import { useCallback, useState } from "react";
import type { Interval } from "@/lib/scheduling/intervals";
import { cn } from "@/lib/utils";
import { Band } from "./band";

/*
 * Scrubbing: move along a band to read any moment of the day. One state
 * (`at`, 0–100 across the day) can drive several bands, so on the landing
 * page the marker crosses both people's days at the same instant.
 *
 * Every input does the same thing:
 *   - mouse: hover moves the marker, leaving hides it;
 *   - touch/pen: press and drag (the marker stays when you lift, so it can be read);
 *   - keyboard: the band is a slider (role="slider"): arrows ±15 min,
 *     Page Up/Down ±1 h, Home/End; the readout is its aria-valuetext.
 * `touch-action: pan-y` lets a vertical swipe still scroll the page while a
 * horizontal one scrubs.
 */
const STEP_MINUTES = 15;

export type Scrub = ReturnType<typeof useScrub>;

export function useScrub(range: Interval, start: () => number | null = () => null) {
  const [at, setAt] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const minutes = (range.end.getTime() - range.start.getTime()) / 60_000;
  const instant = at === null ? null : new Date(range.start.getTime() + (at / 100) * minutes * 60_000);

  const fromPointer = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      // Snap to 5 minutes: readable times, and a steady readout while the hand shakes.
      const m = Math.round(((x / rect.width) * minutes) / 5) * 5;
      setAt((m / minutes) * 100);
    },
    [minutes],
  );

  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      fromPointer(e);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      if (dragging || e.pointerType === "mouse") fromPointer(e);
    },
    onPointerUp() {
      setDragging(false);
    },
    onPointerLeave(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType === "mouse" && !dragging && document.activeElement !== e.currentTarget) setAt(null);
    },
    onFocus() {
      setAt((current) => current ?? start() ?? 50);
    },
    onBlur() {
      setAt(null);
    },
    onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
      const current = at === null ? 0 : (at / 100) * minutes;
      const snap = (m: number) => Math.round(m / STEP_MINUTES) * STEP_MINUTES;
      const moves: Record<string, number> = {
        ArrowRight: snap(current) + STEP_MINUTES,
        ArrowUp: snap(current) + STEP_MINUTES,
        ArrowLeft: snap(current) - STEP_MINUTES,
        ArrowDown: snap(current) - STEP_MINUTES,
        PageUp: snap(current) + 60,
        PageDown: snap(current) - 60,
        Home: 0,
        End: minutes,
      };
      const next = moves[e.key];
      if (next === undefined) return;
      e.preventDefault();
      setAt((Math.min(Math.max(next, 0), minutes) / minutes) * 100);
    },
  };

  return { at, instant, minutes, handlers };
}

/**
 * A Band you can scrub. Give one band per page `slider` (its label and
 * spoken readout); the others follow the same state without being separate
 * tab stops. `badge` floats above the marker: at the left edge it's
 * left-aligned, at the right edge right-aligned (translateX(-at%)), so it
 * never leaves the band and needs no measuring.
 */
export function ScrubBand({
  scrub,
  slider,
  badge,
  className,
  ...band
}: React.ComponentProps<typeof Band> & {
  scrub: Scrub;
  slider?: { label: string; valueText: string | null };
  badge?: React.ReactNode;
}) {
  const { at, minutes, handlers } = scrub;
  return (
    <div className={cn("relative", className)}>
      <Band {...band} markerAt={at} />
      <div
        {...handlers}
        {...(slider
          ? {
              role: "slider",
              tabIndex: 0,
              "aria-label": slider.label,
              "aria-valuemin": 0,
              "aria-valuemax": Math.round(minutes),
              "aria-valuenow": at === null ? undefined : Math.round((at / 100) * minutes),
              "aria-valuetext": slider.valueText ?? undefined,
            }
          : { "aria-hidden": true })}
        className="focus-visible:ring-ring/60 absolute inset-0 cursor-ew-resize touch-pan-y rounded-xl outline-none focus-visible:ring-[3px]"
      />
      {badge && at !== null && (
        <div
          aria-hidden
          className="bg-primary text-primary-foreground pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[min(22rem,100%)] rounded-lg px-3 py-2 text-[13px] leading-snug shadow-lg"
          style={{ left: `${at}%`, transform: `translateX(-${at}%)` }}
        >
          {badge}
        </div>
      )}
    </div>
  );
}
