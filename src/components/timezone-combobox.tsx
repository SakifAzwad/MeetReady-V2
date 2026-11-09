"use client";

import { Check, Globe } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { formatTime } from "@/lib/scheduling/calendar";
import {
  allZoneOptions,
  searchZones,
  zoneName,
  zoneOption,
  type ZoneOption,
} from "@/lib/scheduling/zone-search";
import { cn } from "@/lib/utils";

/*
 * A searchable timezone picker, following the WAI-ARIA combobox pattern:
 * the input has role="combobox" and points at the list with aria-controls;
 * arrow keys move a highlighted option (announced through
 * aria-activedescendant, so focus never leaves the input); Enter picks it;
 * Escape puts the old value back. A native <select> of ~420 zones made
 * people scroll; this lets them type "dhaka", "india" or "gmt+6".
 */
export function TimezoneCombobox({
  value,
  onChange,
  label,
  hideLabel = false,
  detected,
  name,
  className,
  id: idProp,
}: {
  value: string;
  onChange: (zone: string) => void;
  label: string;
  hideLabel?: boolean;
  /** The browser's own zone, offered first when the box is empty. */
  detected?: string | null;
  /** Set to submit the value with a plain <form> (a hidden input carries the zone id). */
  name?: string;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const inputId = idProp ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Built when first opened, not on every render: ~420 zones with offsets.
  const all = useMemo(() => (open ? allZoneOptions(new Date()) : []), [open]);
  const results: ZoneOption[] = useMemo(() => {
    if (!open) return [];
    if (query.trim()) return searchZones(query, all);
    const firsts = [detected, value].filter((z, i, a): z is string => !!z && a.indexOf(z) === i);
    return firsts.map((z) => zoneOption(z, new Date()));
  }, [open, query, all, detected, value]);

  // Name only (no offset): this renders on the server too, where reading the clock isn't allowed.
  const current = zoneName(value);
  const shown = open ? query : current.country ? `${current.city}, ${current.country}` : current.city;

  function choose(option: ZoneOption | undefined) {
    if (!option) return;
    onChange(option.id);
    setOpen(false);
    setQuery("");
  }

  function move(delta: number) {
    if (!results.length) return;
    const next = (active + delta + results.length) % results.length;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className={cn("relative flex flex-col gap-2", className)}>
      <label
        htmlFor={inputId}
        className={cn("flex items-center gap-2 text-sm font-medium", hideLabel && "sr-only")}
      >
        <Globe className="size-4" /> {label}
      </label>
      {name && <input type="hidden" name={name} value={value} />}
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Type a city, country or GMT+6"
        value={shown}
        onFocus={(e) => {
          setOpen(true);
          setActive(0);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            else move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
            setQuery("");
          }
        }}
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full min-w-0 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
      />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={`${label}: matches`}
        hidden={!open || results.length === 0}
        className="bg-card animate-in-down absolute top-full z-50 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-xl border p-1 shadow-[0_12px_40px_rgb(24_33_58/0.14)]"
      >
        {results.map((option, i) => (
          <li
            key={option.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            // mousedown, not click: it fires before the input's blur closes the list.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(option);
            }}
            onMouseMove={() => setActive(i)}
            className={cn(
              "flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm",
              i === active && "bg-accent",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {option.city}
                {option.id === detected && (
                  <span className="text-muted-foreground font-normal"> (detected)</span>
                )}
              </span>
              {option.country && (
                <span className="text-muted-foreground block truncate text-xs">{option.country}</span>
              )}
            </span>
            <span className="text-muted-foreground tabular shrink-0 text-right text-xs">
              <span className="block">{formatTime(new Date(), option.id)}</span>
              <span className="block">{option.offset}</span>
            </span>
            {option.id === value && <Check aria-hidden className="size-4 shrink-0" />}
          </li>
        ))}
      </ul>
      <span role="status" className="sr-only">
        {open && query.trim() ? `${results.length} ${results.length === 1 ? "result" : "results"}` : ""}
      </span>
    </div>
  );
}
