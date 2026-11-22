"use client";

import { useEffect, useRef } from "react";
import { embedMessage, type EmbedMessage } from "@/lib/embed";
import { BookingWidget } from "@/app/[username]/[slug]/booking-widget";

/** To the site around the frame. "*": see src/lib/embed.ts (no private data, origin unknowable). */
function tellParent(message: EmbedMessage) {
  if (window.parent === window) return; // opened directly, not in a frame
  window.parent.postMessage(message, "*");
}

/**
 * The embed's outermost box. Reports its own height to the site around the
 * frame whenever it changes (a step, a notice, the assistant's reply), so
 * public/embed.js can size the iframe to fit and the guest never scrolls
 * inside it. Also passes on an unused Escape, so a popup can close.
 *
 * It measures this box, not the document: the root layout gives <body> a
 * min-height of the viewport, which inside a frame IS the iframe's height. The
 * document can then only ever be as tall as the frame or taller, so a frame
 * sized from the document could grow but never shrink back.
 */
export function EmbedRoot({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const report = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      tellParent(embedMessage({ type: "resize", height }));
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();

    // Escape inside a frame never reaches the site's popup (src/lib/embed.ts). Bubbling phase on
    // window: React's own handlers have run by now, so one that used the key has called preventDefault.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) tellParent(embedMessage({ type: "escape" }));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={box} data-embed-root className="flex flex-col items-center gap-3 p-2 sm:p-3">
      {children}
    </div>
  );
}

type WidgetProps = Omit<React.ComponentProps<typeof BookingWidget>, "onBooked" | "reschedule" | "layout">;

/** The normal booking widget, plus a "booked" message for the site (only times: no guest details). */
export function EmbedWidget(props: WidgetProps) {
  const { username, slug } = props.event;
  return (
    <BookingWidget
      {...props}
      onBooked={(b) =>
        tellParent(
          embedMessage({
            type: "booked",
            username,
            slug,
            startsAt: b.startsAt.toISOString(),
            endsAt: b.endsAt.toISOString(),
          }),
        )
      }
    />
  );
}
