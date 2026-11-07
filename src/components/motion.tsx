import { Suspense, ViewTransition } from "react";

/*
 * Thin wrappers so pages say what they mean ("this is a page", "this
 * streams in") instead of repeating ViewTransition props. The CSS for the
 * classes is in globals.css, next to the reduced-motion rule.
 */

/**
 * Wrap a page's content. On navigation the old page fades out and the new
 * one rises in. Must live in the page, not the layout: layouts persist across
 * navigations, so they never enter or exit.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
      {children}
    </ViewTransition>
  );
}

/** <Suspense> whose skeleton hands over to the real content instead of being swapped instantly. */
export function Reveal({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <ViewTransition exit="skeleton-out" default="none">
          {fallback}
        </ViewTransition>
      }
    >
      <ViewTransition enter="reveal" default="none">
        {children}
      </ViewTransition>
    </Suspense>
  );
}
