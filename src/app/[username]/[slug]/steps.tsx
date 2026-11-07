"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck } from "lucide-react";
import { useState } from "react";
import { useForm, type Path } from "react-hook-form";
import { rescheduleByTokenAction } from "@/app/booking/[token]/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { formatDateKey, formatTime } from "@/lib/scheduling/calendar";
import type { Slot } from "@/lib/scheduling/generate-slots";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { guestDetailsSchema, type GuestDetailsForm } from "@/lib/validation/booking";
import { bookSlotAction } from "./actions";
import { cityName } from "@/lib/scheduling/daylight";

export type Booked = { startsAt: Date; endsAt: Date };

/** "Monday, 9 November 2026, 4:30–5:00 AM" style line used by every step. */
function When({ slot, timeZone, hour12 }: { slot: Booked | Slot; timeZone: string; hour12: boolean }) {
  const start = "startsAt" in slot ? slot.startsAt : slot.start;
  const end = "endsAt" in slot ? slot.endsAt : slot.end;
  return (
    <>
      {formatDateKey(dateKeyInZone(start, timeZone))}, {formatTime(start, timeZone, hour12)} –{" "}
      {formatTime(end, timeZone, hour12)}
    </>
  );
}

export function GuestForm({
  slot,
  timeZone,
  hour12,
  username,
  slug,
  onBack,
  onBooked,
  onSlotGone,
}: {
  slot: Slot;
  timeZone: string;
  hour12: boolean;
  username: string;
  slug: string;
  onBack: () => void;
  onBooked: (b: Booked) => void;
  onSlotGone: () => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<GuestDetailsForm>({
    resolver: zodResolver(guestDetailsSchema),
    defaultValues: { guestName: "", guestEmail: "", guestNotes: "" },
    mode: "onTouched",
  });
  const { register, formState, setError } = form;

  const onSubmit = form.handleSubmit(async () => {
    setFormError(null);
    const result = await bookSlotAction({
      ...form.getValues(), // raw values: the server parses them with the same schema
      username,
      slug,
      startsAt: slot.start.toISOString(),
      guestTimeZone: timeZone,
    });
    // Either way the free times have changed: refetch them.
    await queryClient.invalidateQueries({ queryKey: ["calendar", username, slug] });

    if (result.ok) {
      onBooked({ startsAt: new Date(result.booking.startsAt), endsAt: new Date(result.booking.endsAt) });
    } else if (result.error === "slot_unavailable") {
      onSlotGone();
    } else if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages?.[0]) setError(field as Path<GuestDetailsForm>, { message: messages[0] });
      }
    } else {
      setFormError("This meeting type isn't available any more.");
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-lg flex-col gap-5">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
        <ArrowLeft /> Other times
      </Button>
      <div>
        <h2 className="text-2xl font-semibold">Your details</h2>
        <p className="text-muted-foreground mt-1">
          <When slot={slot} timeZone={timeZone} hour12={hour12} /> ({cityName(timeZone)})
        </p>
      </div>
      <Field id="guestName" label="Name" error={formState.errors.guestName?.message}>
        {(aria) => <Input {...aria} autoComplete="name" {...register("guestName")} />}
      </Field>
      <Field
        id="guestEmail"
        label="Email"
        hint="Your confirmation and calendar invite go here."
        error={formState.errors.guestEmail?.message}
      >
        {(aria) => <Input {...aria} type="email" autoComplete="email" {...register("guestEmail")} />}
      </Field>
      <Field
        id="guestNotes"
        label="Anything to share before the meeting?"
        hint="Optional"
        error={formState.errors.guestNotes?.message}
      >
        {(aria) => <Textarea {...aria} rows={3} {...register("guestNotes")} />}
      </Field>
      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      )}
      <Button type="submit" size="lg" disabled={formState.isSubmitting} className="self-start">
        {formState.isSubmitting ? "Booking…" : "Confirm booking"}
      </Button>
    </form>
  );
}

export function RescheduleConfirm({
  slot,
  timeZone,
  hour12,
  token,
  currentStartsAt,
  currentEndsAt,
  onBack,
  onMoved,
  onSlotGone,
  onNotChangeable,
}: {
  slot: Slot;
  timeZone: string;
  hour12: boolean;
  token: string;
  currentStartsAt: string;
  currentEndsAt: string;
  onBack: () => void;
  onMoved: (b: Booked) => void;
  onSlotGone: () => void;
  onNotChangeable: () => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const current = { startsAt: new Date(currentStartsAt), endsAt: new Date(currentEndsAt) };

  async function confirm() {
    setPending(true);
    const result = await rescheduleByTokenAction({ token, startsAt: slot.start.toISOString() });
    await queryClient.invalidateQueries({ queryKey: ["calendar"] });
    setPending(false);
    if (result.ok) onMoved({ startsAt: slot.start, endsAt: slot.end });
    else if (result.error === "slot_unavailable") onSlotGone();
    else onNotChangeable();
  }

  return (
    <div className="flex max-w-lg flex-col gap-5">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
        <ArrowLeft /> Other times
      </Button>
      <h2 className="text-2xl font-semibold">Move your meeting?</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">From</dt>
        <dd className="text-muted-foreground line-through">
          <When slot={current} timeZone={timeZone} hour12={hour12} />
        </dd>
        <dt className="text-muted-foreground">To</dt>
        <dd className="font-semibold">
          <When slot={slot} timeZone={timeZone} hour12={hour12} />
        </dd>
      </dl>
      <Button size="lg" onClick={confirm} disabled={pending} className="self-start">
        {pending ? "Moving…" : "Confirm new time"}
      </Button>
    </div>
  );
}

export function Confirmation({
  heading,
  booked,
  timeZone,
  hour12,
  hostName,
  hostTimeZone,
  locationLabel,
}: {
  heading: string;
  booked: Booked;
  timeZone: string;
  hour12: boolean;
  hostName: string;
  hostTimeZone: string;
  locationLabel: string;
}) {
  const sameZone = formatTime(booked.startsAt, timeZone) === formatTime(booked.startsAt, hostTimeZone);
  return (
    <div role="status" className="flex flex-col items-start gap-4 py-6">
      <CalendarCheck className="text-primary size-10" />
      <h2 className="text-3xl font-bold">{heading}</h2>
      <p className="text-lg">
        <When slot={booked} timeZone={timeZone} hour12={hour12} />
        <span className="text-muted-foreground"> ({cityName(timeZone)})</span>
      </p>
      {!sameZone && (
        <p className="text-muted-foreground">
          That&apos;s {formatTime(booked.startsAt, hostTimeZone, hour12)} for {hostName.split(" ")[0]} in{" "}
          {cityName(hostTimeZone)}.
        </p>
      )}
      <p className="text-muted-foreground">
        {locationLabel}. A confirmation with a calendar invite is on its way to your email.
      </p>
    </div>
  );
}
