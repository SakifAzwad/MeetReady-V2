"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import { Switch } from "@/components/ui/switch";
import { cityName } from "@/lib/scheduling/daylight";
import { weeklyScheduleSchema, type WeeklySchedule } from "@/lib/validation/availability";
import { saveWeeklyScheduleAction } from "./actions";
import { TimeSelect } from "./time-select";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Display Monday first, but keep dayOfWeek 0 = Sunday (matches JS, Postgres and generateSlots).
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const noSubscription = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function WeeklyScheduleForm({ defaultValues }: { defaultValues: WeeklySchedule }) {
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; message: string } | null>(null);
  const form = useForm<WeeklySchedule>({ resolver: zodResolver(weeklyScheduleSchema), defaultValues });
  const { control, register, formState } = form;

  const detectedZone = useSyncExternalStore(noSubscription, browserTimeZone, () => null);
  const timeZone = useWatch({ control, name: "timeZone" });

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(null);
    const result = await saveWeeklyScheduleAction(values);
    if (result.ok) {
      form.reset(values); // new baseline: "unsaved changes" goes away
      setStatus({ kind: "saved" });
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <div>
          <CardTitle>Weekly hours</CardTitle>
          <CardDescription className="mt-1.5">
            Repeats every week. Times are in the timezone below.
          </CardDescription>
        </div>

        <div className="flex flex-col gap-1.5">
          <Controller
            control={control}
            name="timeZone"
            render={({ field }) => (
              <TimezoneCombobox
                id="timeZone"
                label="Timezone"
                value={field.value}
                onChange={field.onChange}
                detected={detectedZone}
              />
            )}
          />
          <p className="text-muted-foreground text-xs">
            {detectedZone && detectedZone !== timeZone
              ? `Your device is set to ${cityName(detectedZone)}.`
              : "Changing it keeps the same clock times (9:00 stays 9:00) in the new zone."}
          </p>
          {formState.errors.timeZone?.message && (
            <p role="alert" className="text-destructive text-sm">
              {formState.errors.timeZone.message}
            </p>
          )}
        </div>

        <ul className="flex flex-col divide-y">
          {DISPLAY_ORDER.map((day) => (
            <DayRow
              key={day}
              day={day}
              control={control}
              register={register}
              errors={formState.errors.days?.[day]}
            />
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={formState.isSubmitting || !formState.isDirty}>
            {formState.isSubmitting ? "Saving…" : "Save hours"}
          </Button>
          <p role="status" aria-live="polite" className="text-sm">
            {status?.kind === "saved" && !formState.isDirty && (
              <span className="text-muted-foreground">Saved</span>
            )}
            {status?.kind === "error" && <span className="text-destructive">{status.message}</span>}
            {formState.isDirty && status?.kind !== "error" && (
              <span className="text-muted-foreground">Unsaved changes</span>
            )}
          </p>
        </div>
      </Card>
    </form>
  );
}

function DayRow({
  day,
  control,
  register,
  errors,
}: {
  day: number;
  control: Control<WeeklySchedule>;
  register: UseFormRegister<WeeklySchedule>;
  errors?: FieldErrors<WeeklySchedule["days"][number]>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: `days.${day}.ranges` });
  const enabled = useWatch({ control, name: `days.${day}.enabled` });
  const name = DAY_NAMES[day]!;
  // Errors on the list itself (e.g. "Add hours or turn the day off").
  const listError = errors?.ranges?.root?.message ?? errors?.ranges?.message;

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
      <div className="flex w-36 items-center gap-3 pt-1.5">
        <Controller
          control={control}
          name={`days.${day}.enabled`}
          render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={`${name} available`} />
          )}
        />
        <span className="text-sm font-medium">{name}</span>
      </div>

      {enabled ? (
        <div className="flex flex-1 flex-col gap-2">
          {fields.map((f, index) => {
            const rangeErrors = errors?.ranges?.[index];
            const message = rangeErrors?.startTime?.message ?? rangeErrors?.endTime?.message;
            return (
              <div key={f.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <TimeSelect
                    kind="start"
                    aria-label={`${name} range ${index + 1} start`}
                    aria-invalid={message ? true : undefined}
                    defaultValue={f.startTime}
                    {...register(`days.${day}.ranges.${index}.startTime`)}
                  />
                  <span aria-hidden className="text-muted-foreground">
                    –
                  </span>
                  <TimeSelect
                    kind="end"
                    aria-label={`${name} range ${index + 1} end`}
                    aria-invalid={message ? true : undefined}
                    defaultValue={f.endTime}
                    {...register(`days.${day}.ranges.${index}.endTime`)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${name} range ${index + 1}`}
                    onClick={() => remove(index)}
                  >
                    <X />
                  </Button>
                </div>
                {message && <p className="text-destructive text-xs">{message}</p>}
              </div>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => append(nextRange(fields))}
          >
            <Plus /> Add hours
          </Button>
          {listError && <p className="text-destructive text-xs">{listError}</p>}
        </div>
      ) : (
        <p className="text-muted-foreground pt-1.5 text-sm">Unavailable</p>
      )}
    </li>
  );
}

/** A sensible next range: an hour after the last one ends, or 9–5 if there are none. */
function nextRange(existing: { endTime: string }[]): { startTime: string; endTime: string } {
  const last = existing.at(-1);
  if (!last) return { startTime: "09:00", endTime: "17:00" };
  const [h] = last.endTime.split(":").map(Number) as [number];
  const start = Math.min(h + 1, 22);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { startTime: `${pad(start)}:00`, endTime: `${pad(Math.min(start + 1, 24))}:00` };
}
