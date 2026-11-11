"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  addTransitionType,
  startTransition,
  useMemo,
  useState,
  useSyncExternalStore,
  ViewTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import {
  compareMonths,
  formatDateKey,
  formatMonth,
  formatTime,
  monthRangeInZone,
  type YearMonth,
} from "@/lib/scheduling/calendar";
import type { Slot } from "@/lib/scheduling/generate-slots";
import { groupSlotsByDate } from "@/lib/scheduling/group-slots";
import type { Interval } from "@/lib/scheduling/intervals";
import { dateKeyInZone, type DateKey } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";
import { DaylightBand } from "./daylight-band";
import { FactsPanel, type EventInfo } from "./facts-panel";
import { MonthCalendar } from "./month-calendar";
import { useHour12 } from "@/components/daylight/preferences";
import {
  Confirmation,
  EMPTY_DETAILS,
  GuestForm,
  RescheduleConfirm,
  type Booked,
  type BookingQuestions,
  type GuestDraft,
} from "./steps";
import { TimeList } from "./time-list";

export type { EventInfo } from "./facts-panel";

type Reschedule = {
  token: string;
  currentStartsAt: string;
  currentEndsAt: string;
  /** "Keep the current time": leave reschedule mode. */
  onExit?: () => void;
  /** After a successful move, e.g. to refresh the server-rendered details. */
  onMoved?: () => void;
};

type Props = {
  event: EventInfo;
  /** The host's booking questions (not needed when rescheduling: answers are kept). */
  questions?: BookingQuestions;
  /** Reschedule mode (guest manage page): pick a new time for an existing booking. */
  reschedule?: Reschedule;
  /** "embedded" drops the facts panel, for pages that show their own. */
  layout?: "full" | "embedded";
};

const noSubscription = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * TanStack Query is used only here: the one place the browser fetches data
 * itself (slots and the host's working windows for whichever month and
 * timezone the guest is looking at). Created per widget, not app-wide.
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
  // The guest's timezone exists only in the browser: null during server render
  // and hydration (a skeleton shows), then the real value. No hydration mismatch.
  const detected = useSyncExternalStore(noSubscription, browserTimeZone, () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  const timeZone = chosen ?? detected;

  if (!timeZone) return <Shell layout={props.layout} aside={null} stage="pick" main={<Skeleton />} />;
  return <Scheduler {...props} timeZone={timeZone} onTimeZoneChange={setChosen} />;
}

/** Facts panel on the left (full layout), the working area on the right. */
type Stage = "pick" | "details" | "done";
type Direction = "step-forward" | "step-back";
const STEP_MOTION = { "step-forward": "step-forward", "step-back": "step-back", default: "none" };

/**
 * Moves between steps (pick a time → your details → booked) as a transition
 * tagged with a direction, so the content slides forward or back. Plain
 * setState wouldn't animate: <ViewTransition> only runs for transitions.
 */
function go(direction: Direction, update: () => void) {
  startTransition(() => {
    addTransitionType(direction);
    update();
  });
}

function Shell({
  layout = "full",
  aside,
  main,
  stage,
}: {
  layout?: Props["layout"];
  aside: React.ReactNode;
  main: React.ReactNode;
  stage: Stage;
}) {
  // Keyed by stage: a new key is a new element, so the old step exits and the new one enters.
  main = (
    <ViewTransition key={stage} enter={STEP_MOTION} exit={STEP_MOTION} default="none">
      <div>{main}</div>
    </ViewTransition>
  );
  if (layout === "embedded") return <div className="p-6 md:p-8">{main}</div>;
  return (
    <div className="bg-card grid w-full max-w-6xl overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgb(24_33_58/0.05),0_12px_40px_rgb(24_33_58/0.07)] md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      {aside ?? <div className="hidden border-r md:block" />}
      <div className="min-w-0 p-6 md:p-8">{main}</div>
    </div>
  );
}

type CalendarData = { slots: Slot[]; windows: Interval[] };

async function fetchCalendar(
  event: EventInfo,
  from: Date,
  to: Date,
  rescheduleToken?: string,
): Promise<CalendarData> {
  const params = new URLSearchParams({
    username: event.username,
    slug: event.slug,
    from: from.toISOString(),
    to: to.toISOString(),
  });
  if (rescheduleToken) params.set("reschedule", rescheduleToken);
  const res = await fetch(`/api/slots?${params}`);
  if (!res.ok) throw new Error(`Slots request failed: ${res.status}`);
  const body = (await res.json()) as {
    slots: { start: string; end: string }[];
    windows: { start: string; end: string }[];
  };
  const toInterval = (i: { start: string; end: string }) => ({
    start: new Date(i.start),
    end: new Date(i.end),
  });
  return { slots: body.slots.map(toInterval), windows: body.windows.map(toInterval) };
}

function Scheduler({
  event,
  questions,
  reschedule,
  layout,
  timeZone,
  onTimeZoneChange,
}: Props & { timeZone: string; onTimeZoneChange: (tz: string) => void }) {
  const [hour12, setHour12] = useHour12();
  const [now] = useState(() => new Date());
  const today = dateKeyInZone(now, timeZone);
  const thisMonth: YearMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };

  const [month, setMonth] = useState<YearMonth | null>(null);
  const visible = month ?? thisMonth;
  const [selectedDate, setSelectedDate] = useState<DateKey | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<"pick" | "details">("pick");
  const [booked, setBooked] = useState<Booked | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<GuestDraft>(EMPTY_DETAILS);
  // Starts as the server rendered them; replaced if the host changes them mid-booking.
  const [bookingQuestions, setBookingQuestions] = useState<BookingQuestions>(
    () => questions ?? { questions: [] },
  );
  const [formNotice, setFormNotice] = useState<string | null>(null);
  // True right after coming back from the details step, so the list puts focus on the chosen time.
  const [returned, setReturned] = useState(false);

  // The month as the GUEST sees it, turned into UTC instants for the API.
  const { from, to } = monthRangeInZone(visible, timeZone);
  const calendar = useQuery({
    queryKey: [
      "calendar",
      event.username,
      event.slug,
      from.toISOString(),
      to.toISOString(),
      reschedule?.token ?? null,
    ],
    queryFn: () => fetchCalendar(event, from, to, reschedule?.token),
  });

  const byDate = useMemo(
    () => groupSlotsByDate(calendar.data?.slots ?? [], timeZone),
    [calendar.data, timeZone],
  );
  // Default to the first day with free times, so the guest sees options straight away.
  const firstAvailable = [...byDate.keys()].sort()[0] ?? null;
  const activeDate = selectedDate && byDate.has(selectedDate) ? selectedDate : firstAvailable;

  const aside =
    layout === "embedded" ? null : <FactsPanel event={event} timeZone={timeZone} hour12={hour12} />;
  const slotGone = (typed?: GuestDraft) =>
    go("step-back", () => {
      if (typed) setDraft(typed);
      setFormNotice(null);
      setStep("pick");
      setSelectedSlot(null);
      setReturned(true);
      setNotice(
        typed
          ? "Someone just booked that time. Pick another one: your details are kept."
          : "Someone just booked that time. Pick another one.",
      );
    });
  const backToTimes = (typed?: GuestDraft) =>
    go("step-back", () => {
      if (typed) setDraft(typed);
      setFormNotice(null);
      setStep("pick");
      setReturned(true);
    });

  if (booked) {
    return (
      <Shell
        layout={layout}
        aside={aside}
        stage="done"
        main={
          <Confirmation
            heading={
              reschedule ? "Your meeting has moved" : `You're booked with ${event.hostName.split(" ")[0]}`
            }
            booked={booked}
            timeZone={timeZone}
            hour12={hour12}
            hostName={event.hostName}
            hostTimeZone={event.hostTimeZone}
            locationLabel={event.locationLabel}
          />
        }
      />
    );
  }

  const daySlots = activeDate ? (byDate.get(activeDate) ?? []) : [];
  // The slot being booked, or null while picking. On phones the details step
  // still replaces everything else (there's no room for both side by side).
  const inDetails = step === "details" ? selectedSlot : null;
  const phoneHidden = inDetails ? "max-lg:hidden" : undefined;
  return (
    <Shell
      layout={layout}
      aside={aside}
      stage="pick"
      main={
        <div className="flex flex-col gap-6">
          {reschedule && (
            <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 text-sm">
              <p>
                Moving your meeting from{" "}
                {formatDateKey(dateKeyInZone(new Date(reschedule.currentStartsAt), timeZone))},{" "}
                {formatTime(new Date(reschedule.currentStartsAt), timeZone, hour12)}.
              </p>
              {reschedule.onExit && (
                <Button variant="link" size="sm" className="h-auto px-0" onClick={reschedule.onExit}>
                  Keep the current time
                </Button>
              )}
            </div>
          )}

          <div className={phoneHidden}>
            {activeDate && calendar.data ? (
              <DaylightBand
                windows={calendar.data.windows}
                day={activeDate}
                timeZone={timeZone}
                hostTimeZone={event.hostTimeZone}
                hostName={event.hostName}
                hour12={hour12}
              />
            ) : (
              <div aria-hidden className="bg-muted h-[7.5rem] animate-pulse rounded-xl" />
            )}
          </div>

          {notice && (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/5 rounded-lg border px-3 py-2 text-sm"
            >
              {notice}
            </p>
          )}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
            <div className={phoneHidden}>
              <MonthCalendar
                month={visible}
                today={today}
                canGoBack={compareMonths(visible, thisMonth) > 0}
                onMonthChange={(m) => {
                  setMonth(m);
                  setSelectedDate(null);
                  setSelectedSlot(null);
                  setStep("pick");
                }}
                availableDates={byDate}
                activeDate={activeDate}
                onSelect={(d) => {
                  const pickDay = () => {
                    setSelectedDate(d);
                    setSelectedSlot(null);
                    setNotice(null);
                    setStep("pick");
                  };
                  // Picking another day while filling in details slides back to that day's times.
                  if (step === "details") go("step-back", pickDay);
                  else pickDay();
                }}
                loading={calendar.isPending}
              />
            </div>

            {/*
             * The details form takes the place of the times, in the same column:
             * the band, the calendar and the event facts stay in view. Keyed by
             * step so it slides in (and back out) as a transition.
             */}
            <ViewTransition
              key={inDetails ? "details" : "pick"}
              enter={STEP_MOTION}
              exit={STEP_MOTION}
              default="none"
            >
              {inDetails ? (
                <div className="min-w-0">
                  {reschedule ? (
                    <RescheduleConfirm
                      slot={inDetails}
                      timeZone={timeZone}
                      hour12={hour12}
                      token={reschedule.token}
                      currentStartsAt={reschedule.currentStartsAt}
                      currentEndsAt={reschedule.currentEndsAt}
                      onBack={backToTimes}
                      onMoved={(b) => {
                        go("step-forward", () => setBooked(b));
                        reschedule.onMoved?.();
                      }}
                      onSlotGone={slotGone}
                      onNotChangeable={() => {
                        setStep("pick");
                        setNotice(
                          "This booking can't be changed any more (cancelled or already started). Reload the page.",
                        );
                      }}
                    />
                  ) : (
                    <GuestForm
                      // A new version of the questions mounts a fresh form (schema and defaults rebuilt).
                      key={bookingQuestions.questionsVersion ?? "questions"}
                      slot={inDetails}
                      timeZone={timeZone}
                      hour12={hour12}
                      username={event.username}
                      slug={event.slug}
                      onBack={backToTimes}
                      draft={draft}
                      questions={bookingQuestions}
                      notice={formNotice}
                      onBooked={(b) => go("step-forward", () => setBooked(b))}
                      onSlotGone={slotGone}
                      onQuestionsChanged={(current, typed) => {
                        setDraft(typed);
                        setBookingQuestions(current);
                        setFormNotice(
                          `${event.hostName.split(" ")[0]} just changed these questions. Check your answers and confirm again: what still fits is kept.`,
                        );
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">
                      {activeDate ? formatDateKey(activeDate) : formatMonth(visible)}
                    </h3>
                    <HourToggle hour12={hour12} onChange={setHour12} />
                  </div>
                  {calendar.isError ? (
                    <div className="text-sm">
                      <p className="text-destructive">Couldn&apos;t load times.</p>
                      <Button variant="link" className="px-0" onClick={() => calendar.refetch()}>
                        Try again
                      </Button>
                    </div>
                  ) : calendar.isPending ? (
                    <div className="bg-muted h-60 animate-pulse rounded-lg" />
                  ) : activeDate ? (
                    <TimeList
                      label={`Times on ${formatDateKey(activeDate)}`}
                      slots={daySlots}
                      timeZone={timeZone}
                      hostTimeZone={event.hostTimeZone}
                      hour12={hour12}
                      selected={selectedSlot}
                      onSelect={(slot) => {
                        setSelectedSlot(slot);
                        setReturned(false);
                      }}
                      focusOnMount={returned}
                      onContinue={(slot) =>
                        go("step-forward", () => {
                          setSelectedSlot(slot);
                          setStep("details");
                        })
                      }
                    />
                  ) : (
                    <p className="text-muted-foreground">
                      No free times in {formatMonth(visible)}. Try the next month.
                    </p>
                  )}
                </div>
              )}
            </ViewTransition>
          </div>

          {/*
           * Named so it glides to its new position when the column above changes
           * height (times <-> form). Without a name it's part of the page
           * snapshot, which cross-fades: for a moment the old copy sits on top
           * of the incoming list.
           */}
          <div className={phoneHidden} style={{ viewTransitionName: "booking-display-options" }}>
            <DisplayOptions timeZone={timeZone} onTimeZoneChange={onTimeZoneChange} />
          </div>
        </div>
      }
    />
  );
}

function DisplayOptions({
  timeZone,
  onTimeZoneChange,
}: {
  timeZone: string;
  onTimeZoneChange: (tz: string) => void;
}) {
  const detected = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
  return (
    <div className="flex flex-wrap items-end gap-4 border-t pt-5">
      <TimezoneCombobox
        label="Times shown in"
        value={timeZone}
        onChange={onTimeZoneChange}
        detected={detected}
        id="guest-timezone"
        className="max-w-xs flex-1"
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="bg-muted h-[7.5rem] animate-pulse rounded-xl" />
      <div className="bg-muted h-72 animate-pulse rounded-lg" />
    </div>
  );
}

/**
 * Beside the date, where the times are read: a 24-hour reader looks for it
 * there, not in the page footer. The default already follows the browser.
 */
function HourToggle({ hour12, onChange }: { hour12: boolean; onChange: (v: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Clock format" className="flex shrink-0 rounded-lg border p-0.5">
      {[true, false].map((value) => (
        <button
          key={String(value)}
          type="button"
          role="radio"
          aria-checked={hour12 === value}
          onClick={() => onChange(value)}
          className={cn(
            "focus-visible:ring-ring/50 rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-[3px]",
            hour12 === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value ? "12h" : "24h"}
        </button>
      ))}
    </div>
  );
}
