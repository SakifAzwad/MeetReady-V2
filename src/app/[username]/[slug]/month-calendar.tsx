"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, formatDateKey, formatMonth, monthGrid, type YearMonth } from "@/lib/scheduling/calendar";
import type { Slot } from "@/lib/scheduling/generate-slots";
import type { DateKey } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A real <table> (screen readers announce row/column), each day a button
 * labelled "Monday, 9 November 2026, 16 times available". Days with times are
 * "day" coloured, the selected one "night": the band's colours again.
 */
export function MonthCalendar({
  month,
  today,
  canGoBack,
  onMonthChange,
  availableDates,
  activeDate,
  onSelect,
  loading,
}: {
  month: YearMonth;
  today: DateKey;
  canGoBack: boolean;
  onMonthChange: (m: YearMonth) => void;
  availableDates: Map<DateKey, Slot[]>;
  activeDate: DateKey | null;
  onSelect: (d: DateKey) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold" aria-live="polite">
          {formatMonth(month)}
        </h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            disabled={!canGoBack}
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <table className={cn("w-full table-fixed text-center", loading && "animate-pulse")}>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="text-muted-foreground pb-1 text-xs font-medium">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => {
                if (!day) return <td key={i} />;
                const count = availableDates.get(day)?.length ?? 0;
                const isActive = day === activeDate;
                return (
                  <td key={day} className="p-0.5">
                    <button
                      type="button"
                      disabled={count === 0}
                      aria-pressed={isActive}
                      aria-current={day === today ? "date" : undefined}
                      aria-label={`${formatDateKey(day)}, ${count === 0 ? "no times" : `${count} time${count === 1 ? "" : "s"} available`}`}
                      onClick={() => onSelect(day)}
                      className={cn(
                        "tabular focus-visible:ring-ring/50 mx-auto flex size-10 items-center justify-center rounded-full text-sm outline-none focus-visible:ring-[3px]",
                        count === 0 && "text-muted-foreground/50 cursor-default",
                        count > 0 &&
                          !isActive &&
                          "bg-day text-foreground hover:ring-primary/30 font-bold hover:ring-2",
                        isActive && "bg-primary text-primary-foreground font-bold",
                        day === today && !isActive && "ring-foreground/40 ring-1",
                      )}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
