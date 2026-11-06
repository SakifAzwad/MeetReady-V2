"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatWallTime } from "@/lib/format";
import { dateOverrideSchema, type TimeRange } from "@/lib/validation/availability";
import { deleteDateOverrideAction, saveDateOverrideAction } from "./actions";
import { TimeSelect } from "./time-select";

type Override = { date: string; startTime: string | null; endTime: string | null };

/** "2026-12-16" -> "Wed, 16 Dec 2026". Formatted as a calendar date (UTC), never shifted by a timezone. */
function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function DateOverrides({ overrides, today }: { overrides: Override[]; today: string }) {
  // Several rows per date (one per range) -> one entry per date.
  const byDate = new Map<string, Override[]>();
  for (const o of overrides) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);

  return (
    <Card className="self-start">
      <div>
        <CardTitle>Date overrides</CardTitle>
        <CardDescription className="mt-1.5">
          Holidays or one-off hours. Replaces the weekly hours for that date.
        </CardDescription>
      </div>
      <AddOverrideForm today={today} />
      {byDate.size > 0 ? (
        <ul className="flex flex-col divide-y">
          {[...byDate].map(([date, rows]) => (
            <OverrideRow key={date} date={date} rows={rows} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No upcoming overrides.</p>
      )}
    </Card>
  );
}

function OverrideRow({ date, rows }: { date: string; rows: Override[] }) {
  const [pending, startTransition] = useTransition();
  const dayOff = rows.every((r) => r.startTime === null);
  return (
    <li className="flex items-center justify-between gap-2 py-3">
      <div>
        <p className="text-sm font-medium">{formatDate(date)}</p>
        <p className="text-muted-foreground text-sm">
          {dayOff
            ? "Unavailable"
            : rows.map((r) => `${formatWallTime(r.startTime!)}–${formatWallTime(r.endTime!)}`).join(", ")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove override for ${formatDate(date)}`}
        disabled={pending}
        onClick={() => startTransition(async () => void (await deleteDateOverrideAction(date)))}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function AddOverrideForm({ today }: { today: string }) {
  const [date, setDate] = useState("");
  const [available, setAvailable] = useState(false);
  const [ranges, setRanges] = useState<TimeRange[]>([{ startTime: "09:00", endTime: "17:00" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = { date, available, ranges: available ? ranges : [] };
    // Same schema as the server: catch mistakes before the round trip.
    const parsed = dateOverrideSchema.safeParse(values);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form");
    setError(null);
    startTransition(async () => {
      const result = await saveDateOverrideAction(values);
      if (result.ok) {
        setDate("");
        setAvailable(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg border p-4">
      <Field id="override-date" label="Date">
        {(aria) => (
          <Input {...aria} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">On that day</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="override-kind"
            checked={!available}
            onChange={() => setAvailable(false)}
          />
          Unavailable all day
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="override-kind" checked={available} onChange={() => setAvailable(true)} />
          Different hours
        </label>
      </fieldset>

      {available && (
        <div className="flex flex-col gap-2">
          {ranges.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <TimeSelect
                kind="start"
                aria-label={`Override range ${i + 1} start`}
                value={r.startTime}
                onChange={(e) =>
                  setRanges(ranges.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))
                }
              />
              <span aria-hidden>–</span>
              <TimeSelect
                kind="end"
                aria-label={`Override range ${i + 1} end`}
                value={r.endTime}
                onChange={(e) =>
                  setRanges(ranges.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove override range ${i + 1}`}
                onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setRanges([...ranges, { startTime: "18:00", endTime: "19:00" }])}
          >
            <Plus /> Add hours
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending || !date} className="self-start">
        {pending ? "Saving…" : "Add override"}
      </Button>
    </form>
  );
}
