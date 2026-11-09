"use client";

import { CalendarSearch, Check, Copy } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { useHour12 } from "@/components/daylight/preferences";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { cityName } from "@/lib/scheduling/daylight";
import { formatAvailabilityText } from "@/lib/scheduling/suggest";
import { suggestTimesAction } from "./actions";

/*
 * "Share times by text": many meetings are still arranged in email threads.
 * Pick the meeting type and the other person's timezone, get three free
 * times written out in their time (with yours beside them) plus your link,
 * edit if you like, copy, paste. The times come from the server (same
 * calendar as the booking page); the wording is built here so it follows
 * the 12h/24h choice.
 */
export function ShareTimes({
  eventTypes,
  hostTimeZone,
  origin,
}: {
  eventTypes: { id: string; title: string }[];
  hostTimeZone: string;
  origin: string;
}) {
  const ids = useId();
  const [hour12] = useHour12();
  const [eventTypeId, setEventTypeId] = useState(eventTypes[0]?.id ?? "");
  const [zone, setZone] = useState(hostTimeZone);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  if (eventTypes.length === 0) {
    return (
      <Card className="py-6">
        <p className="text-muted-foreground text-sm">Turn on a meeting type to share times by text.</p>
      </Card>
    );
  }

  function suggest() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const r = await suggestTimesAction({ eventTypeId, timeZone: zone });
      if (!r.ok) {
        setError(r.error);
        setText(null);
        return;
      }
      if (r.slots.length === 0) {
        setText(null);
        setError("No free times in the next two weeks. Check your hours or booking rules.");
        return;
      }
      setText(
        formatAvailabilityText({
          slots: r.slots.map((s) => ({ start: new Date(s.start), end: new Date(s.end) })),
          durationMinutes: r.eventType.durationMinutes,
          recipientZone: zone,
          recipientCity: cityName(zone),
          hostZone: r.hostTimeZone,
          hostCity: cityName(r.hostTimeZone),
          link: new URL(r.bookingPath, origin).toString(),
          hour12,
        }),
      );
    });
  }

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Blocked clipboard: the text is selectable in the box.
    }
  }

  return (
    <Card className="gap-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-type`} className="text-sm font-medium">
            Meeting type
          </label>
          <NativeSelect
            id={`${ids}-type`}
            value={eventTypeId}
            onChange={(e) => setEventTypeId(e.target.value)}
          >
            {eventTypes.map((et) => (
              <option key={et.id} value={et.id}>
                {et.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <TimezoneCombobox label="Their timezone" value={zone} onChange={setZone} />
        <Button onClick={suggest} disabled={pending}>
          <CalendarSearch />
          {pending ? "Finding times…" : "Suggest 3 times"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {text && (
        <div className="animate-in-up flex flex-col gap-3">
          <label htmlFor={`${ids}-text`} className="sr-only">
            Message to paste
          </label>
          <Textarea
            id={`${ids}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={text.split("\n").length + 1}
            className="bg-background text-[15px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={copy} aria-live="polite">
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy message"}
            </Button>
            <p className="text-muted-foreground text-sm">
              These times are free now but not held. If one gets taken, your link is at the bottom.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
