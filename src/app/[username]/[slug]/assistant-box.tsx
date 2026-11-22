"use client";

import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateKey, formatTime, placeInCalendar } from "@/lib/scheduling/calendar";
import { cityName } from "@/lib/scheduling/daylight";
import type { Slot } from "@/lib/scheduling/generate-slots";
import { tooManyAttempts } from "@/lib/rate-limit-text";
import { cn } from "@/lib/utils";
import { askAssistantAction } from "./actions";

type Answer = Awaited<ReturnType<typeof askAssistantAction>>;

/** What the box shows once an answer is back: the times are real Dates, in the zone they were found in. */
type Shown =
  { kind: "reply"; reply: string; slots: Slot[]; timeZone: string } | { kind: "error"; message: string };

const COULD_NOT_ANSWER = "The assistant can't answer right now. You can still pick a time below.";

/** Every answer the server can give, turned into what the guest reads. The times grid works in every case. */
function show(answer: Answer): Shown {
  if (answer.ok) {
    return {
      kind: "reply",
      reply: answer.reply,
      slots: answer.slots.map((s) => ({ start: new Date(s.start), end: new Date(s.end) })),
      timeZone: answer.timeZone,
    };
  }
  switch (answer.error) {
    case "rate_limited":
      return {
        kind: "error",
        message: `${tooManyAttempts(answer.retryAfterSeconds)} You can still pick a time below.`,
      };
    case "invalid":
      return { kind: "error", message: answer.message };
    default:
      return { kind: "error", message: COULD_NOT_ANSWER };
  }
}

/**
 * The booking assistant (Day 20): the guest describes when suits them, the
 * server's assistant (Day 19) finds up to three real free times, and picking
 * one selects it in the times grid below. It never books: the guest still
 * presses Continue and confirms through the normal form.
 *
 * Stateless, like the server: one message, one answer. Editing the message
 * and sending again replaces the answer. Clear (or Escape) empties the box,
 * answer included: one control for both "ask something else" and "I'll pick
 * from the calendar myself". The grid's selection is the grid's: kept.
 */
export function AssistantBox({
  username,
  slug,
  hostName,
  timeZone,
  hour12,
  selected,
  onPick,
}: {
  username: string;
  slug: string;
  hostName: string;
  /** The widget's timezone, sent as the guest's own (they can name another in the message). */
  timeZone: string;
  hour12: boolean;
  selected: Slot | null;
  /** Select this time in the widget, shown in the timezone it was found in. */
  onPick: (slot: Slot, timeZone: string) => void;
}) {
  const inputId = useId();
  const noteId = useId();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Counts requests: an answer that arrives after Clear (or after a newer question) is dropped.
  const requests = useRef(0);
  const firstName = hostName.split(" ")[0];
  const canClear = message !== "" || shown !== null || pending;

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || message.trim().length < 2) return;
    const request = ++requests.current;
    setPending(true);
    let next: Shown;
    try {
      next = show(await askAssistantAction({ username, slug, message, timeZone }));
    } catch {
      // The request itself failed (offline, a deploy in between): same message as a model failure.
      next = { kind: "error", message: COULD_NOT_ANSWER };
    }
    if (request !== requests.current) return; // cleared while waiting
    setShown(next);
    setPending(false);
  };

  const clear = () => {
    requests.current++;
    setMessage("");
    setShown(null);
    setPending(false);
    inputRef.current?.focus();
  };

  return (
    <section aria-label="Find a time by describing it" className="bg-primary/[0.03] rounded-xl border p-4">
      <form onSubmit={ask} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Tell us when suits you
        </label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              ref={inputRef}
              id={inputId}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && canClear) {
                  e.preventDefault();
                  clear();
                }
              }}
              maxLength={300}
              autoComplete="off"
              placeholder="e.g. Tuesday afternoon, I'm in London"
              aria-describedby={noteId}
              className={cn("bg-background h-10", canClear && "pr-10")}
            />
            {/* Our own button, not type="search": that one looks different per browser, and Firefox has none. */}
            {canClear && (
              <button
                type="button"
                aria-label="Clear"
                onClick={clear}
                className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md outline-none focus-visible:ring-[3px]"
              >
                <X aria-hidden className="size-4" />
              </button>
            )}
          </div>
          <Button type="submit" className="h-10 shrink-0" disabled={pending || message.trim().length < 2}>
            {pending ? "Looking…" : "Find times"}
          </Button>
        </div>
        <p id={noteId} className="text-muted-foreground text-xs">
          Sent to an AI model (Groq) to find times. Don&apos;t include personal details.{" "}
          {/* A new tab (Day 27): leaving would lose what's typed, and inside another site's frame
              (the embed) the privacy page refuses to load at all. */}
          <a
            href="/privacy#booking-assistant"
            target="_blank"
            rel="noopener"
            className="hover:text-foreground underline underline-offset-4"
          >
            Privacy<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </form>

      {/* Announced when it changes; focus stays where the guest is. */}
      <div aria-live="polite" className="empty:hidden">
        {pending ? (
          <p className="text-muted-foreground mt-3 text-sm">Looking for times…</p>
        ) : shown?.kind === "error" ? (
          <p className="text-destructive mt-3 text-sm">{shown.message}</p>
        ) : shown?.kind === "reply" ? (
          <div className="mt-3 flex flex-col gap-3 border-t pt-3">
            <div>
              {/* Plain text, never HTML: the model's words are untrusted (and cleaned on the server). */}
              <p className="text-sm">{shown.reply}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Reply written by AI.{" "}
                {shown.slots.length > 0 && `The times are ${firstName}'s real free times.`}
              </p>
            </div>
            {shown.slots.length > 0 && (
              <Suggestions
                slots={shown.slots}
                timeZone={shown.timeZone}
                widgetTimeZone={timeZone}
                hour12={hour12}
                selected={selected}
                onPick={onPick}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Suggestions({
  slots,
  timeZone,
  widgetTimeZone,
  hour12,
  selected,
  onPick,
}: {
  slots: Slot[];
  timeZone: string;
  widgetTimeZone: string;
  hour12: boolean;
  selected: Slot | null;
  onPick: (slot: Slot, timeZone: string) => void;
}) {
  const label = "Suggested times";
  return (
    <div className="flex flex-col gap-2">
      {/* The guest named another place: say whose clock these are, since picking one switches the page to it. */}
      {timeZone !== widgetTimeZone && (
        <p className="text-muted-foreground text-xs">In {cityName(timeZone)} time</p>
      )}
      {/* Always three across (there are at most three): on a phone, 2 + 1 read as a ranking. */}
      <ul aria-label={label} className="grid max-w-md grid-cols-3 gap-2">
        {slots.map((slot) => {
          const isSelected = selected?.start.getTime() === slot.start.getTime();
          return (
            <li key={slot.start.toISOString()} className="flex">
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onPick(slot, timeZone)}
                className={cn(
                  "focus-visible:ring-ring/50 flex min-w-0 flex-1 flex-col items-center rounded-lg border px-1 py-2 whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
                  isSelected
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "hover:border-primary/50 hover:bg-primary/5 bg-background",
                )}
              >
                <span
                  className={cn(
                    "text-xs",
                    isSelected ? "text-primary-foreground/75" : "text-muted-foreground",
                  )}
                >
                  {formatDateKey(placeInCalendar(slot.start, timeZone).date, "short")}
                </span>
                <span className="font-display tabular text-sm font-bold sm:text-base">
                  {formatTime(slot.start, timeZone, hour12)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
