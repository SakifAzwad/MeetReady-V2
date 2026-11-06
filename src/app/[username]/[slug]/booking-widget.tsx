"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useForm, type Path } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import {
  addMonths,
  compareMonths,
  formatDateKey,
  formatMonth,
  formatTime,
  monthGrid,
  monthRangeInZone,
  type YearMonth,
} from "@/lib/scheduling/calendar";
import { groupSlotsByDate } from "@/lib/scheduling/group-slots";
import type { Slot } from "@/lib/scheduling/generate-slots";
import { dateKeyInZone, type DateKey } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";
import { guestDetailsSchema, type GuestDetailsForm } from "@/lib/validation/booking";
import { bookSlotAction } from "./actions";

type Props = {
  username: string;
  slug: string;
  hostName: string;
  hostTimeZone: string;
  locationLabel: string;
};

const noSubscription = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * TanStack Query is used only here: this is the one place the browser fetches
 * data itself (slots for whichever month/timezone the guest is looking at).
 * Created per widget instead of app-wide, because nothing else needs it.
 */
export function BookingWidget(props: Props) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Booking {...props} />
    </QueryClientProvider>
  );
}

function Booking(props: Props) {
  // The guest's timezone exists only in the browser. During server render and
  // hydration this is null (a skeleton renders), then the real value: no
  // hydration mismatch.
  const detected = useSyncExternalStore(noSubscription, browserTimeZone, () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  const timeZone = chosen ?? detected;

  if (!timeZone) return <WidgetSkeleton />;
  return <Scheduler {...props} timeZone={timeZone} onTimeZoneChange={setChosen} />;
}

type Booked = { startsAt: Date; endsAt: Date };

function Scheduler({
  username,
  slug,
  hostName,
  hostTimeZone,
  locationLabel,
  timeZone,
  onTimeZoneChange,
}: Props & {
  timeZone: string;
  onTimeZoneChange: (tz: string) => void;
}) {
  const [now] = useState(() => new Date());
  const today = dateKeyInZone(now, timeZone);
  const thisMonth: YearMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };

  const [month, setMonth] = useState<YearMonth | null>(null);
  const visible = month ?? thisMonth;
  const [selectedDate, setSelectedDate] = useState<DateKey | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The month as the GUEST sees it, turned into UTC instants for the API.
  const { from, to } = monthRangeInZone(visible, timeZone);
  const slotsQuery = useQuery({
    queryKey: ["slots", username, slug, from.toISOString(), to.toISOString()],
    queryFn: () => fetchSlots(username, slug, from, to),
  });

  const byDate = useMemo(
    () => groupSlotsByDate(slotsQuery.data ?? [], timeZone),
    [slotsQuery.data, timeZone],
  );
  const firstAvailable = [...byDate.keys()].sort()[0] ?? null;
  // Default to the first day with free times, so the guest sees options straight away.
  const activeDate = selectedDate && byDate.has(selectedDate) ? selectedDate : firstAvailable;

  if (booked) {
    return (
      <Confirmation
        booked={booked}
        timeZone={timeZone}
        hostName={hostName}
        hostTimeZone={hostTimeZone}
        locationLabel={locationLabel}
      />
    );
  }

  if (selectedSlot) {
    return (
      <GuestForm
        slot={selectedSlot}
        timeZone={timeZone}
        username={username}
        slug={slug}
        onBack={() => setSelectedSlot(null)}
        onBooked={setBooked}
        onSlotGone={() => {
          setSelectedSlot(null);
          setNotice("Sorry, someone just booked that time. Please pick another.");
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold">Select a date and time</h2>
      {notice && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 text-sm"
        >
          {notice}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
        <MonthCalendar
          month={visible}
          today={today}
          canGoBack={compareMonths(visible, thisMonth) > 0}
          onMonthChange={(m) => {
            setMonth(m);
            setSelectedDate(null);
          }}
          availableDates={byDate}
          activeDate={activeDate}
          onSelect={(d) => {
            setSelectedDate(d);
            setNotice(null);
          }}
          loading={slotsQuery.isPending}
        />

        <div className="flex flex-col gap-3">
          {slotsQuery.isError ? (
            <div className="text-sm">
              <p className="text-destructive">Couldn&apos;t load times.</p>
              <Button variant="link" className="px-0" onClick={() => slotsQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : slotsQuery.isPending ? (
            <div className="bg-muted h-40 animate-pulse rounded-md" />
          ) : activeDate ? (
            <>
              <h3 className="text-sm font-medium">{formatDateKey(activeDate, "short")}</h3>
              <ul
                className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1"
                aria-label={`Times on ${formatDateKey(activeDate)}`}
              >
                {byDate.get(activeDate)!.map((slot) => (
                  <li key={slot.start.toISOString()}>
                    <Button
                      variant="outline"
                      className="border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground w-full"
                      onClick={() => setSelectedSlot(slot)}
                    >
                      {formatTime(slot.start, timeZone)}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No free times in {formatMonth(visible)}. Try the next month.
            </p>
          )}
        </div>
      </div>

      <TimeZonePicker value={timeZone} onChange={onTimeZoneChange} />
    </div>
  );
}

async function fetchSlots(username: string, slug: string, from: Date, to: Date): Promise<Slot[]> {
  const params = new URLSearchParams({ username, slug, from: from.toISOString(), to: to.toISOString() });
  const res = await fetch(`/api/slots?${params}`);
  if (!res.ok) throw new Error(`Slots request failed: ${res.status}`);
  const body = (await res.json()) as { slots: { start: string; end: string }[] };
  return body.slots.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthCalendar({
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-medium" aria-live="polite">
          {formatMonth(month)}
        </p>
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
      <table className={cn("w-full table-fixed text-center text-sm", loading && "animate-pulse")}>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="text-muted-foreground pb-2 text-xs font-medium">
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
                      aria-label={`${formatDateKey(day)}, ${count === 0 ? "no times" : `${count} time${count === 1 ? "" : "s"} available`}`}
                      onClick={() => onSelect(day)}
                      className={cn(
                        "focus-visible:ring-ring/50 mx-auto flex aspect-square w-full max-w-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]",
                        count === 0 && "text-muted-foreground/60 cursor-default",
                        count > 0 &&
                          !isActive &&
                          "bg-primary/10 text-primary hover:bg-primary/20 font-semibold",
                        isActive && "bg-primary text-primary-foreground font-semibold",
                        day === today && !isActive && "underline underline-offset-4",
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

function TimeZonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const zones = useMemo(
    () => [...new Set(["UTC", value, ...Intl.supportedValuesOf("timeZone")])].sort(),
    [value],
  );
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <label htmlFor="guest-timezone" className="flex items-center gap-2 text-sm font-medium">
        <Globe className="size-4" /> Times shown in
      </label>
      <NativeSelect id="guest-timezone" value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replaceAll("_", " ")}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function GuestForm({
  slot,
  timeZone,
  username,
  slug,
  onBack,
  onBooked,
  onSlotGone,
}: {
  slot: Slot;
  timeZone: string;
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
    await queryClient.invalidateQueries({ queryKey: ["slots", username, slug] });

    if (result.ok) {
      onBooked({ startsAt: new Date(result.booking.startsAt), endsAt: new Date(result.booking.endsAt) });
    } else if (result.error === "slot_unavailable") {
      onSlotGone();
    } else if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages?.[0]) setError(field as Path<GuestDetailsForm>, { message: messages[0] });
      }
    } else {
      setFormError("This event type isn't available any more.");
    }
  });

  const day = dateKeyInZone(slot.start, timeZone);
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 p-6">
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeft /> Back
      </Button>
      <div>
        <h2 className="text-lg font-semibold">Your details</h2>
        <p className="text-muted-foreground text-sm">
          {formatDateKey(day)}, {formatTime(slot.start, timeZone)} – {formatTime(slot.end, timeZone)} (
          {timeZone.replaceAll("_", " ")})
        </p>
      </div>
      <Field id="guestName" label="Name" error={formState.errors.guestName?.message}>
        {(aria) => <Input {...aria} autoComplete="name" {...register("guestName")} />}
      </Field>
      <Field id="guestEmail" label="Email" error={formState.errors.guestEmail?.message}>
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
      <Button type="submit" disabled={formState.isSubmitting} className="self-start">
        {formState.isSubmitting ? "Booking…" : "Confirm booking"}
      </Button>
    </form>
  );
}

function Confirmation({
  booked,
  timeZone,
  hostName,
  hostTimeZone,
  locationLabel,
}: {
  booked: Booked;
  timeZone: string;
  hostName: string;
  hostTimeZone: string;
  locationLabel: string;
}) {
  const day = dateKeyInZone(booked.startsAt, timeZone);
  const sameZone = timeZone === hostTimeZone;
  return (
    <div role="status" className="flex flex-col items-center gap-4 p-10 text-center">
      <CalendarCheck className="text-primary size-10" />
      <h2 className="text-xl font-semibold">You&apos;re booked with {hostName}</h2>
      <p>
        {formatDateKey(day)}
        <br />
        {formatTime(booked.startsAt, timeZone)} – {formatTime(booked.endsAt, timeZone)} (
        {timeZone.replaceAll("_", " ")})
      </p>
      {!sameZone && (
        <p className="text-muted-foreground text-sm">
          That&apos;s {formatTime(booked.startsAt, hostTimeZone)} for {hostName.split(" ")[0]} (
          {hostTimeZone.replaceAll("_", " ")}).
        </p>
      )}
      <p className="text-muted-foreground text-sm">Location: {locationLabel}</p>
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true">
      <div className="bg-muted h-6 w-56 animate-pulse rounded" />
      <div className="bg-muted h-72 animate-pulse rounded-lg" />
    </div>
  );
}
