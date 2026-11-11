"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, type Path, type Resolver } from "react-hook-form";
import { rescheduleByTokenAction } from "@/app/booking/[token]/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { formatDateKey, formatTime } from "@/lib/scheduling/calendar";
import type { Slot } from "@/lib/scheduling/generate-slots";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { guestDetailsSchema, type GuestDetailsForm } from "@/lib/validation/booking";
import { answersSchema, initialAnswers, type Answers, type Question } from "@/lib/validation/questions";
import { bookSlotAction } from "./actions";
import { QuestionFields } from "./question-fields";
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

/**
 * Where keyboard focus goes when a step appears: the first field on wide
 * screens (start typing straight away), the heading on phones (focusing an
 * input would open the keyboard and jump the page before they've read it).
 * Either way focus isn't lost: the "Continue" button it was on has gone.
 */
function useStepFocus(focusField: (() => void) | null) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusField && window.matchMedia("(min-width: 1024px)").matches) focusField();
    else headingRef.current?.focus();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return headingRef;
}

/** Everything the guest types: their details plus answers to the host's questions. */
export type GuestDraft = GuestDetailsForm & { answers: Answers };

export const EMPTY_DETAILS: GuestDraft = { guestName: "", guestEmail: "", guestNotes: "", answers: {} };

/** The host's questions, and which version of them the form was built from. */
export type BookingQuestions = { questions: Question[]; questionsVersion?: string };

export function GuestForm({
  slot,
  timeZone,
  hour12,
  username,
  slug,
  draft,
  questions: { questions, questionsVersion },
  notice,
  onBack,
  onBooked,
  onSlotGone,
  onQuestionsChanged,
}: {
  slot: Slot;
  timeZone: string;
  hour12: boolean;
  username: string;
  slug: string;
  /** What they typed last time (they went back, or the time was taken): never make them type it twice. */
  draft: GuestDraft;
  questions: BookingQuestions;
  /** Shown above the form, e.g. after the host changed the questions. */
  notice?: string | null;
  onBack: (draft: GuestDraft) => void;
  onBooked: (b: Booked) => void;
  onSlotGone: (draft: GuestDraft) => void;
  onQuestionsChanged: (questions: Required<BookingQuestions>, draft: GuestDraft) => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  // Mounted once per version of the questions (the widget keys it), so the
  // schema and defaults are built once. Same answersSchema the server runs.
  const [schema] = useState(() => guestDetailsSchema.extend({ answers: answersSchema(questions) }));
  const form = useForm<GuestDraft>({
    resolver: zodResolver(schema) as unknown as Resolver<GuestDraft>,
    defaultValues: { ...draft, answers: initialAnswers(questions, draft.answers) },
    mode: "onTouched",
  });
  const { register, formState, setError } = form;
  const headingRef = useStepFocus(() => form.setFocus("guestName"));

  const onSubmit = form.handleSubmit(async () => {
    setFormError(null);
    const result = await bookSlotAction({
      ...form.getValues(), // raw values: the server parses them with the same schema
      username,
      slug,
      startsAt: slot.start.toISOString(),
      guestTimeZone: timeZone,
      questionsVersion,
    });
    // Either way the free times have changed: refetch them.
    await queryClient.invalidateQueries({ queryKey: ["calendar", username, slug] });

    if (result.ok) {
      onBooked({ startsAt: new Date(result.booking.startsAt), endsAt: new Date(result.booking.endsAt) });
    } else if (result.error === "slot_unavailable") {
      onSlotGone(form.getValues());
    } else if (result.error === "questions_changed") {
      onQuestionsChanged(result, form.getValues());
    } else if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages?.[0]) setError(field as Path<GuestDraft>, { message: messages[0] });
      }
      for (const [questionId, message] of Object.entries(result.answerErrors ?? {})) {
        if (questionId) setError(`answers.${questionId}`, { message });
        else setFormError("Your answers don't match this form any more. Reload the page and try again.");
      }
    } else {
      setFormError("This meeting type isn't available any more.");
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-lg flex-col gap-5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        onClick={() => onBack(form.getValues())}
      >
        <ArrowLeft /> Other times
      </Button>
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
          Your details
        </h2>
        <p className="text-muted-foreground mt-1">
          <When slot={slot} timeZone={timeZone} hour12={hour12} /> ({cityName(timeZone)})
        </p>
      </div>
      {notice && (
        <p role="status" className="bg-muted rounded-md px-3 py-2 text-sm">
          {notice}
        </p>
      )}
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
      <QuestionFields questions={questions} register={register} errors={formState.errors} />
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
  const headingRef = useStepFocus(null);

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
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
        Move your meeting?
      </h2>
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
