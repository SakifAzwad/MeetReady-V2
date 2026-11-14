"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTime, formatTimeRange } from "@/lib/scheduling/calendar";
import {
  cityName,
  PART_OF_DAY_LABEL,
  partOfDay,
  splitByDaytime,
  type PartOfDay,
} from "@/lib/scheduling/daylight";
import type { Slot } from "@/lib/scheduling/generate-slots";
import { cn } from "@/lib/utils";

/** Same colours as the band: the dot on each row points back to its part of the band. */
const DOT: Record<PartOfDay, string> = {
  early: "bg-night dark:bg-[#5b6a99]",
  morning: "bg-dawn",
  afternoon: "bg-afternoon",
  evening: "bg-dusk",
  night: "bg-night dark:bg-[#5b6a99]",
};

/**
 * A grid of times, grouped by part of the GUEST's day, in time order (a list
 * until the Day 16 follow-up: half-hour meetings made it 16 rows long). When
 * the host is in another timezone, each time also shows theirs, small (the
 * two clocks from direction A). Click a time to select it; "Continue" appears
 * under its group.
 *
 * Times outside the guest's daytime (8 AM–8 PM) are folded into one line
 * above and below, so the first time anyone reads is a sensible one. If none
 * are in daytime, nothing is folded. A folded group opens by itself when it
 * holds the selected time.
 */
export function TimeList({
  slots,
  timeZone,
  hostTimeZone,
  hour12,
  selected,
  onSelect,
  onContinue,
  label,
  focusOnMount = false,
}: {
  slots: Slot[];
  timeZone: string;
  hostTimeZone: string;
  hour12: boolean;
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  onContinue: (slot: Slot) => void;
  label: string;
  /** Coming back from the details step: put keyboard focus back on the chosen time. */
  focusOnMount?: boolean;
}) {
  const showHost = slots[0]
    ? formatTime(slots[0].start, hostTimeZone) !== formatTime(slots[0].start, timeZone)
    : false;
  const { before, daytime, after } = splitByDaytime(slots, timeZone);
  // Which folds are open, per day (label), so changing day folds them again.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const holds = (group: Slot[]) =>
    !!selected && group.some((s) => s.start.getTime() === selected.start.getTime());
  const isOpen = (which: "before" | "after", group: Slot[]) => open.has(`${label}:${which}`) || holds(group);
  const toggle = (which: "before" | "after") =>
    setOpen((prev) => {
      const next = new Set(prev);
      const key = `${label}:${which}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    const root = groupRef.current;
    const target =
      root?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? root?.querySelector("button");
    target?.focus();
    // Mount only: focus once when the list comes back, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = (group: Slot[], continuesFrom?: Slot) => (
    <Rows
      slots={group}
      continuesPart={continuesFrom ? partOfDay(continuesFrom.start, timeZone) : undefined}
      timeZone={timeZone}
      hostTimeZone={hostTimeZone}
      hour12={hour12}
      selected={selected}
      onSelect={onSelect}
      onContinue={onContinue}
      showHost={showHost}
    />
  );

  return (
    <div ref={groupRef} role="group" aria-label={label} className="flex flex-col">
      {before.length > 0 && (
        <Fold
          open={isOpen("before", before)}
          onToggle={() => toggle("before")}
          text={foldText(before, "earlier", timeZone, hour12)}
        >
          {rows(before)}
        </Fold>
      )}
      {/* With the fold open, 7:30 and 8:00 AM are both "Morning": don't head them twice. */}
      {rows(daytime, before.length > 0 && isOpen("before", before) ? before.at(-1) : undefined)}
      {after.length > 0 && (
        <Fold
          open={isOpen("after", after)}
          onToggle={() => toggle("after")}
          text={foldText(after, "later", timeZone, hour12)}
        >
          {rows(after)}
        </Fold>
      )}
    </div>
  );
}

/** "Show 10 earlier times, 3:00–7:30 AM" */
function foldText(group: Slot[], which: "earlier" | "later", timeZone: string, hour12: boolean): string {
  const n = group.length;
  const range = formatTimeRange(group[0]!.start, group.at(-1)!.start, timeZone, hour12);
  return `${n} ${which} ${n === 1 ? "time" : "times"}, ${n === 1 ? formatTime(group[0]!.start, timeZone, hour12) : range}`;
}

/** A disclosure: button with aria-expanded controlling the region under it. */
function Fold({
  open,
  onToggle,
  text,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  text: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 my-1 flex items-center gap-2 self-start rounded-md py-1.5 pr-2 text-sm outline-none focus-visible:ring-[3px]"
      >
        <ChevronRight aria-hidden className={cn("size-4 transition-transform", open && "rotate-90")} />
        {open ? "Hide" : "Show"} {text}
      </button>
      <div id={id} hidden={!open} className={cn(open && "animate-in-down")}>
        {children}
      </div>
    </div>
  );
}

function Rows({
  slots,
  timeZone,
  hostTimeZone,
  hour12,
  selected,
  onSelect,
  onContinue,
  showHost,
  continuesPart,
}: {
  slots: Slot[];
  timeZone: string;
  hostTimeZone: string;
  hour12: boolean;
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  onContinue: (slot: Slot) => void;
  showHost: boolean;
  /** The part of day the rows just above ended in; if these start in the same part, skip the heading. */
  continuesPart?: PartOfDay;
}) {
  const groups: { part: PartOfDay; slots: Slot[] }[] = [];
  for (const slot of slots) {
    const part = partOfDay(slot.start, timeZone);
    const last = groups.at(-1);
    if (last?.part === part) last.slots.push(slot);
    else groups.push({ part, slots: [slot] });
  }

  const range = (slot: Slot) => formatTimeRange(slot.start, slot.end, timeZone, hour12);

  return (
    <>
      {groups.map((g, gi) => {
        const selectedHere = g.slots.find((s) => s.start.getTime() === selected?.start.getTime());
        return (
          <div key={`${g.part}-${g.slots[0]!.start.toISOString()}`} className="flex flex-col not-first:mt-4">
            {!(gi === 0 && g.part === continuesPart) && (
              <p className="text-muted-foreground mb-2 flex items-center gap-2 text-[13px]">
                <span aria-hidden className={cn("size-2 rounded-full", DOT[g.part])} />
                {PART_OF_DAY_LABEL[g.part]}
              </p>
            )}
            {/* A grid, not a list (Day 16 follow-up): 16 half-hour times fit in about 6 rows.
                auto-fill: as many columns as the space allows, 2 on a phone, 3 or 4 on a wide screen. */}
            <ul
              className={cn(
                "grid gap-2",
                showHost
                  ? "grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))]"
                  : "grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]",
              )}
            >
              {g.slots.map((slot) => {
                const isSelected = slot === selectedHere;
                return (
                  <li key={slot.start.toISOString()} className="flex">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelect(slot)}
                      className={cn(
                        "focus-visible:ring-ring/50 flex min-w-0 flex-1 flex-col items-center rounded-lg border px-2 py-2 transition-colors outline-none focus-visible:ring-[3px]",
                        isSelected
                          ? "bg-primary text-primary-foreground border-transparent"
                          : "hover:border-primary/50 hover:bg-primary/5",
                      )}
                    >
                      <span className="font-display tabular text-base font-bold">
                        {formatTime(slot.start, timeZone, hour12)}
                      </span>
                      {showHost && (
                        <span
                          className={cn(
                            "tabular max-w-full truncate text-[11px]",
                            isSelected ? "text-primary-foreground/75" : "text-muted-foreground",
                          )}
                        >
                          {formatTime(slot.start, hostTimeZone, hour12)} {cityName(hostTimeZone)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* Continue sits right under the group that holds the chosen time, where the eye already is. */}
            {selectedHere && (
              <div className="bg-primary/5 animate-in-down mt-2 flex items-center justify-between gap-3 rounded-lg px-3 py-2">
                <span className="tabular min-w-0 text-sm">
                  <span className="font-medium">{range(selectedHere)}</span>
                  {showHost && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {formatTimeRange(selectedHere.start, selectedHere.end, hostTimeZone, hour12)} in{" "}
                      {cityName(hostTimeZone)}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  className="bg-highlight text-night hover:bg-highlight/90 animate-in-left shrink-0 font-semibold"
                  onClick={() => onContinue(selectedHere)}
                >
                  Continue
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
