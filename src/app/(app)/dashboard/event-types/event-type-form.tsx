"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm, useWatch, type Path } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  EVENT_COLORS,
  LOCATION_LABELS,
  LOCATION_TYPES,
  eventTypeSchema,
  slugify,
  type EventTypeFormValues,
  type EventTypeInput,
} from "@/lib/validation/event-type";
import { createEventTypeAction, updateEventTypeAction, type EventTypeActionResult } from "./actions";
import { QuestionsEditor } from "./questions-editor";

const DURATION_PRESETS = [15, 30, 45, 60];
const NOTICE_OPTIONS = [0, 30, 60, 120, 240, 720, 1440, 2880];
const BUFFER_OPTIONS = [0, 5, 10, 15, 30, 60];
const INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 60];
const WINDOW_OPTIONS = [7, 14, 30, 60, 90, 180];

const LOCATION_PLACEHOLDER: Record<string, string> = {
  zoom: "https://us05web.zoom.us/j/…",
  phone: "+880 1712 345678",
  in_person: "Street, city",
};

/** `appHost`: e.g. "meetreadyv2.vercel.app", for the "Guests book at …" hint. */
type Props =
  | { mode: "create"; username: string; appHost: string; defaultValues: EventTypeFormValues }
  | { mode: "edit"; username: string; appHost: string; defaultValues: EventTypeFormValues; id: string };

export function EventTypeForm(props: Props) {
  const { username, defaultValues } = props;
  const [formError, setFormError] = useState<string | null>(null);
  // Fill the slug from the title until the user edits the slug themselves.
  const [slugTouched, setSlugTouched] = useState(props.mode === "edit");

  const form = useForm<EventTypeFormValues, unknown, EventTypeInput>({
    resolver: zodResolver(eventTypeSchema), // same schema the server action uses
    defaultValues,
    mode: "onTouched", // don't shout errors before the user has finished a field
  });
  const { control, setValue, formState, setError } = form;
  // register() fills inputs only after hydration; also passing defaultValue
  // puts the saved values in the server HTML, so the edit form isn't blank
  // (and selects don't show their first option) while JavaScript loads.
  const register: typeof form.register = (name, options) => ({
    ...form.register(name, options),
    defaultValue: defaultValues[name as keyof EventTypeFormValues] as string | undefined,
  });
  const { errors, isSubmitting } = formState;

  // useWatch (not watch()): subscribes to just these fields, and works with
  // the React Compiler's automatic memoization.
  const slug = useWatch({ control, name: "slug" });
  const locationType = useWatch({ control, name: "locationType" });

  const onSubmit = form.handleSubmit(async () => {
    setFormError(null);
    // Send the raw form values: the server parses them with the same schema.
    // (handleSubmit's argument is the already-transformed output, which the
    // schema wouldn't accept a second time.)
    const values = form.getValues();
    const result: EventTypeActionResult =
      props.mode === "create"
        ? await createEventTypeAction(values)
        : await updateEventTypeAction(props.id, values);

    // On success the action redirects, so we only get here on failure.
    for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (messages?.[0]) setError(field as Path<EventTypeFormValues>, { message: messages[0] });
    }
    if (result.formError) setFormError(result.formError);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardTitle>Details</CardTitle>
        <Field id="title" label="Title" error={errors.title?.message}>
          {(aria) => (
            <Input
              {...aria}
              placeholder="Intro call"
              {...register("title", {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  if (!slugTouched)
                    setValue("slug", slugify(e.target.value), { shouldValidate: formState.isSubmitted });
                },
              })}
            />
          )}
        </Field>

        <Field
          id="slug"
          label="Link"
          hint={`Guests book at ${props.appHost}/${username}/${slug || "…"}`}
          error={errors.slug?.message}
        >
          {(aria) => (
            <div className="border-input focus-within:ring-ring/50 flex items-center rounded-md border focus-within:ring-[3px]">
              <span className="text-muted-foreground pl-3 text-sm select-none">/{username}/</span>
              <input
                {...aria}
                className="h-9 w-full bg-transparent pr-3 text-sm outline-none"
                autoCapitalize="none"
                spellCheck={false}
                {...register("slug", { onChange: () => setSlugTouched(true) })}
              />
            </div>
          )}
        </Field>

        <Field
          id="description"
          label="Description"
          hint="Shown on the booking page. Optional."
          error={errors.description?.message}
        >
          {(aria) => <Textarea {...aria} rows={3} {...register("description")} />}
        </Field>

        <Field id="durationMinutes" label="Duration (minutes)" error={errors.durationMinutes?.message}>
          {(aria) => (
            <Controller
              control={control}
              name="durationMinutes"
              render={({ field }) => (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    {...aria}
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={720}
                    step={5}
                    className="w-28"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={Number.isNaN(field.value) ? "" : field.value}
                    // Empty input -> NaN -> "Duration must be a number" from the schema.
                    onChange={(e) =>
                      field.onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))
                    }
                  />
                  {DURATION_PRESETS.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={field.value === m ? "secondary" : "ghost"}
                      onClick={() => field.onChange(m)}
                    >
                      {formatMinutes(m)}
                    </Button>
                  ))}
                </div>
              )}
            />
          )}
        </Field>

        <Field id="color" label="Colour">
          {() => (
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div role="radiogroup" aria-label="Colour" className="flex gap-2">
                  {EVENT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={field.value === c}
                      aria-label={c}
                      onClick={() => field.onChange(c)}
                      className={cn(
                        "focus-visible:ring-ring/50 size-7 rounded-full outline-none focus-visible:ring-[3px]",
                        field.value === c && "ring-foreground ring-offset-background ring-2 ring-offset-2",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              )}
            />
          )}
        </Field>
      </Card>

      <Card>
        <CardTitle>Location</CardTitle>
        <Field id="locationType" label="Where">
          {(aria) => (
            <NativeSelect {...aria} {...register("locationType")}>
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LOCATION_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {locationType === "google_meet" ? (
          <p className="text-muted-foreground text-sm">
            A Google Meet link is created for each booking once Google Calendar is connected.
          </p>
        ) : (
          <Field
            id="locationValue"
            label={
              locationType === "zoom" ? "Zoom link" : locationType === "phone" ? "Phone number" : "Address"
            }
            error={errors.locationValue?.message}
          >
            {(aria) => (
              <Input
                {...aria}
                placeholder={LOCATION_PLACEHOLDER[locationType]}
                {...register("locationValue")}
              />
            )}
          </Field>
        )}
      </Card>

      <Card>
        <CardTitle>Booking rules</CardTitle>
        <div className="grid gap-6 sm:grid-cols-2">
          <NumberSelect
            control={control}
            name="minimumNoticeMinutes"
            label="Minimum notice"
            hint="How soon before a meeting guests can book"
            options={NOTICE_OPTIONS}
            format={formatMinutes}
            error={errors.minimumNoticeMinutes?.message}
          />
          <NumberSelect
            control={control}
            name="bookingWindowDays"
            label="Booking window"
            hint="How far ahead guests can book"
            options={WINDOW_OPTIONS}
            format={(d) => `${d} days`}
            nullLabel="No limit"
            error={errors.bookingWindowDays?.message}
          />
          <NumberSelect
            control={control}
            name="bufferBeforeMinutes"
            label="Buffer before"
            hint="Free time kept before each meeting"
            options={BUFFER_OPTIONS}
            format={formatMinutes}
            error={errors.bufferBeforeMinutes?.message}
          />
          <NumberSelect
            control={control}
            name="bufferAfterMinutes"
            label="Buffer after"
            hint="Free time kept after each meeting"
            options={BUFFER_OPTIONS}
            format={formatMinutes}
            error={errors.bufferAfterMinutes?.message}
          />
          <NumberSelect
            control={control}
            name="slotIntervalMinutes"
            label="Start times every"
            hint="Gap between offered start times"
            options={INTERVAL_OPTIONS}
            format={formatMinutes}
            nullLabel="Same as duration"
            error={errors.slotIntervalMinutes?.message}
          />
          <NumberSelect
            control={control}
            name="maxBookingsPerDay"
            label="Max per day"
            hint="Of this event type"
            options={[1, 2, 3, 4, 5, 6, 8, 10]}
            format={(n) => String(n)}
            nullLabel="No limit"
            error={errors.maxBookingsPerDay?.message}
          />
        </div>
      </Card>

      <QuestionsEditor control={control} register={register} errors={errors} />

      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : props.mode === "create" ? "Create event type" : "Save changes"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/dashboard/event-types">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

type NumberField =
  | "minimumNoticeMinutes"
  | "bookingWindowDays"
  | "bufferBeforeMinutes"
  | "bufferAfterMinutes"
  | "slotIntervalMinutes"
  | "maxBookingsPerDay";

/**
 * A <select> of numbers. `nullLabel` adds a "no value" option stored as null
 * (not 0 or "", which would mean something different to the schema and DB).
 * If the saved value isn't one of the presets, it's still shown and kept.
 */
function NumberSelect({
  control,
  name,
  label,
  hint,
  options,
  format,
  nullLabel,
  error,
}: {
  control: ReturnType<typeof useForm<EventTypeFormValues, unknown, EventTypeInput>>["control"];
  name: NumberField;
  label: string;
  hint: string;
  options: number[];
  format: (n: number) => string;
  nullLabel?: string;
  error?: string;
}) {
  return (
    <Field id={name} label={label} hint={hint} error={error}>
      {(aria) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => {
            const all =
              field.value !== null && !options.includes(field.value)
                ? [...options, field.value].sort((a, b) => a - b)
                : options;
            return (
              <NativeSelect
                {...aria}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={field.value === null ? "" : String(field.value)}
                onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
              >
                {nullLabel && <option value="">{nullLabel}</option>}
                {all.map((n) => (
                  <option key={n} value={n}>
                    {format(n)}
                  </option>
                ))}
              </NativeSelect>
            );
          }}
        />
      )}
    </Field>
  );
}
