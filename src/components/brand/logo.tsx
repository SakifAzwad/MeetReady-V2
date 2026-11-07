import { ViewTransition } from "react";
import { cn } from "@/lib/utils";

/*
 * The mark is the product's own drawing: one day from night through dawn,
 * day and dusk, with a white bracket for working hours. Same idea as the
 * band on the booking page, squeezed into a square.
 *
 * Built in CSS rather than inline SVG: an SVG gradient needs an id, and two
 * logos on one page (header and footer) would share it. src/app/icon.svg is
 * the same drawing for the favicon.
 */
const MARK_GRADIENT =
  "linear-gradient(90deg, #1d2540 0%, #1d2540 10%, #f4b183 24%, #e3eefb 36%, #cfe0f6 56%, #b9a6dd 72%, #8b6cc2 84%, #1d2540 100%)";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative inline-block size-7 shrink-0 rounded-[23%]", className)}
      style={{ backgroundImage: MARK_GRADIENT }}
    >
      <span className="absolute inset-x-[23%] inset-y-[31%] rounded-[30%] border-2 border-white shadow-[0_0_0_1px_rgb(29_37_64/0.3)]" />
    </span>
  );
}

/**
 * Mark + wordmark. With `morph`, the mark gets a view-transition name, so
 * going from the landing page to the login page it glides to its new place
 * instead of blinking out and back in: same brand, same object. Only one
 * logo per page may have it (names must be unique), so the footer's doesn't.
 */
export function Logo({
  className,
  markClassName,
  wordmarkClassName,
  morph = false,
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  morph?: boolean;
}) {
  const mark = <LogoMark className={markClassName} />;
  return (
    <span
      className={cn(
        "font-display inline-flex items-center gap-2 text-xl font-bold tracking-tight",
        className,
      )}
    >
      {morph ? (
        <ViewTransition name="brand-mark" share="morph" default="none">
          {mark}
        </ViewTransition>
      ) : (
        mark
      )}
      <span className={wordmarkClassName}>MeetReady</span>
    </span>
  );
}
