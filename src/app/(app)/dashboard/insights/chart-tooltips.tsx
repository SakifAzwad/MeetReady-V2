"use client";

import { useRef, useState } from "react";

/*
 * Hover and focus tooltips for the Insights charts (Day 25). The charts are
 * rendered on the server; any element inside with `data-tip` gets a tooltip
 * on hover and on keyboard focus. Text only (React escapes it), and it never
 * gates anything: every value is also in each chart's table.
 */
export function ChartTooltips({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  function show(target: EventTarget | null) {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
    const frame = box.current?.getBoundingClientRect();
    if (!el || !frame || !box.current?.contains(el)) return setTip(null);
    const mark = el.getBoundingClientRect();
    // Centred over the mark, but kept inside the card near its edges.
    const x = Math.min(Math.max(mark.left + mark.width / 2 - frame.left, 90), frame.width - 90);
    setTip({ text: el.dataset.tip ?? "", x, y: mark.top - frame.top });
  }

  return (
    <div
      ref={box}
      className="relative"
      onPointerOver={(e) => show(e.target)}
      onPointerLeave={() => setTip(null)}
      onFocus={(e) => show(e.target)}
      onBlur={() => setTip(null)}
    >
      {children}
      {tip && (
        <div
          role="tooltip"
          className="bg-popover text-popover-foreground pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
