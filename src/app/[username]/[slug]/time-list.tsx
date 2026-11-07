"use client";

import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/scheduling/calendar";
import { cityName, PART_OF_DAY_LABEL, partOfDay, type PartOfDay } from "@/lib/scheduling/daylight";
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
 * Two clocks per row (from direction A): the guest's time big, the host's
 * beside it. Click a row to select it; the selected row shows "Continue".
 * Grouped by part of the GUEST's day, in time order.
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
}: {
  slots: Slot[];
  timeZone: string;
  hostTimeZone: string;
  hour12: boolean;
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  onContinue: (slot: Slot) => void;
  label: string;
}) {
  const showHost = slots[0]
    ? formatTime(slots[0].start, hostTimeZone) !== formatTime(slots[0].start, timeZone)
    : false;
  const groups: { part: PartOfDay; slots: Slot[] }[] = [];
  for (const slot of slots) {
    const part = partOfDay(slot.start, timeZone);
    const last = groups.at(-1);
    if (last?.part === part) last.slots.push(slot);
    else groups.push({ part, slots: [slot] });
  }

  return (
    <div role="group" aria-label={label} className="flex flex-col">
      {groups.map((g) => (
        <div key={`${g.part}-${g.slots[0]!.start.toISOString()}`} className="flex flex-col">
          <p className="text-muted-foreground mt-3 mb-1 flex items-center gap-2 text-[13px] first:mt-0">
            <span aria-hidden className={cn("size-2 rounded-full", DOT[g.part])} />
            {PART_OF_DAY_LABEL[g.part]}
          </p>
          <ul className="flex flex-col">
            {g.slots.map((slot) => {
              const isSelected = selected?.start.getTime() === slot.start.getTime();
              const yours = formatTime(slot.start, timeZone, hour12);
              return (
                <li
                  key={slot.start.toISOString()}
                  className={cn(
                    "border-border/70 flex items-center gap-3 border-b pr-2 transition-colors",
                    isSelected && "bg-primary text-primary-foreground rounded-lg border-transparent",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(slot)}
                    className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-[3px]"
                  >
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[g.part])} />
                    <span className="font-display tabular w-24 shrink-0 text-xl font-bold">{yours}</span>
                    {showHost && (
                      <span
                        className={cn(
                          "tabular truncate text-[13px]",
                          isSelected ? "text-primary-foreground/75" : "text-muted-foreground",
                        )}
                      >
                        {formatTime(slot.start, hostTimeZone, hour12)} in {cityName(hostTimeZone)}
                      </span>
                    )}
                  </button>
                  {isSelected && (
                    <Button
                      size="sm"
                      className="bg-highlight text-night hover:bg-highlight/90 font-semibold"
                      onClick={() => onContinue(slot)}
                    >
                      Continue
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
