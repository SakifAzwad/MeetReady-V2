import { Card } from "@/components/ui/card";
import { bucketLabel, bucketName, heatLevel, meetings, niceTicks } from "@/lib/insights-format";
import { dayBounds } from "@/lib/scheduling/daylight";
import { skyGradient } from "@/lib/scheduling/sky";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { cn } from "@/lib/utils";
import type { Insights } from "@/server/insights";
import { ChartTooltips } from "./chart-tooltips";

/*
 * The Insights charts (Day 25), hand-built in HTML and CSS: a few columns, a
 * grid and some bars don't need a chart library. Rules followed (dataviz skill):
 *  - Colour in this design means time of day, so data marks are three steps of
 *    one navy (--chart-1..3, validated as an ordinal ramp in both themes), and
 *    identity never rests on colour alone: a legend, a fixed order, tooltips,
 *    and a table under every chart.
 *  - Bars at most 24px wide, 4px rounded at the data end and square at the
 *    baseline, 2px gaps between stacked parts, hairline gridlines.
 *  - The one place colour IS time of day: the daylight strip over the hours of
 *    the popular-times grid, the same sky as the dashboard's bands.
 */

/** The three outcomes, bottom to top of a column, darkest first. */
const OUTCOMES = [
  { key: "held", label: "Held", swatch: "bg-chart-1" },
  { key: "noShows", label: "No-show", swatch: "bg-chart-2" },
  { key: "cancelled", label: "Cancelled", swatch: "bg-chart-3" },
] as const;

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    // A named region, so screen readers can jump between charts by title.
    <Card role="region" aria-label={title} className="gap-4 p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {note && <p className="text-muted-foreground text-sm">{note}</p>}
      </div>
      {children}
    </Card>
  );
}

function Legend({ items }: { items: readonly { label: string; swatch: string }[] }) {
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-[2px]", i.swatch)} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Every chart's values as a table, one click away: nothing is only in a tooltip or a colour. */
function TableView({ children }: { children: React.ReactNode }) {
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer">
        Show as a table
      </summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

const th = "text-muted-foreground border-b px-2 py-1.5 text-left font-normal";
const td = "tabular border-b px-2 py-1.5";

// ─── Meetings per week / month: stacked columns ──────────────────────────────────

export function MeetingsChart({ data }: { data: Insights }) {
  const totals = data.series.map((s) => s.held + s.noShows + s.cancelled);
  const ticks = niceTicks(Math.max(...totals));
  const top = ticks.at(-1)!;
  const many = data.series.length > 8;

  return (
    <ChartCard
      title={`Meetings per ${data.unit}`}
      note="Held, missed and cancelled, by the day each was for."
    >
      <Legend items={OUTCOMES} />
      <ChartTooltips>
        <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
          {/* The y axis: clean ticks, hairline gridlines behind the columns. */}
          <div aria-hidden className="relative h-48">
            {ticks.map((t) => (
              <span
                key={t}
                className="text-muted-foreground tabular absolute right-0 translate-y-1/2 text-xs"
                style={{ bottom: `${(t / top) * 100}%` }}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="relative h-48">
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className="border-border absolute inset-x-0 border-t"
                style={{ bottom: `${(t / top) * 100}%` }}
              />
            ))}
            <ul className="absolute inset-0 flex items-end justify-around gap-1">
              {data.series.map((s, i) => {
                const name = bucketName(s.bucket, data.unit);
                const tip = `${name}: ${s.held} held, ${s.noShows} no-show, ${s.cancelled} cancelled`;
                return (
                  <li key={s.bucket} className="flex h-full min-w-0 flex-1 justify-center">
                    {totals[i]! > 0 && (
                      // The column is the hit target: wider than the bar, the full height of the plot.
                      <div
                        tabIndex={0}
                        data-tip={tip}
                        aria-label={tip}
                        className="group flex h-full w-full max-w-10 cursor-default items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        <div
                          className="flex w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] transition-[filter] group-hover:brightness-110"
                          style={{ height: `${(totals[i]! / top) * 100}%` }}
                        >
                          {OUTCOMES.map((o) =>
                            s[o.key] > 0 ? (
                              <div key={o.key} className={o.swatch} style={{ flex: `${s[o.key]} 1 0` }} />
                            ) : null,
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <span />
          <ol aria-hidden className="text-muted-foreground mt-1.5 flex justify-around gap-1 text-xs">
            {data.series.map((s, i) => (
              <li
                key={s.bucket}
                // 13 weeks don't fit on a phone: every other label there.
                className={cn(
                  "min-w-0 flex-1 text-center whitespace-nowrap",
                  many && i % 2 === 1 && "max-sm:invisible",
                )}
              >
                {bucketLabel(s.bucket, data.unit)}
              </li>
            ))}
          </ol>
        </div>
      </ChartTooltips>
      <TableView>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>{data.unit === "week" ? "Week" : "Month"}</th>
              {OUTCOMES.map((o) => (
                <th key={o.key} className={cn(th, "text-right")}>
                  {o.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.series.map((s) => (
              <tr key={s.bucket}>
                <td className={td}>{bucketName(s.bucket, data.unit)}</td>
                {OUTCOMES.map((o) => (
                  <td key={o.key} className={cn(td, "text-right")}>
                    {s[o.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </ChartCard>
  );
}

// ─── Popular times: weekday × hour ──────────────────────────────────────────────

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const HEAT = ["bg-muted", "bg-chart-3", "bg-chart-2", "bg-chart-1"] as const;

function hourName(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return `${hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

export function PopularTimes({ data, now }: { data: Insights; now: Date }) {
  const cells = new Map(data.times.map((t) => [`${t.weekday}-${t.hour}`, t.meetings]));
  const busiest = Math.max(...data.times.map((t) => t.meetings));
  // Today's sky in the host's timezone: colour here means time of day, as everywhere in MeetReady.
  const sky = skyGradient(data.timeZone, dayBounds(dateKeyInZone(now, data.timeZone), data.timeZone));

  return (
    <ChartCard title="Popular times" note="When your meetings were, by weekday and the hour they started.">
      <Legend
        items={[
          { label: "A few", swatch: HEAT[1] },
          { label: "More", swatch: HEAT[2] },
          { label: "Busiest", swatch: HEAT[3] },
        ]}
      />
      <ChartTooltips>
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[34rem] grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px]">
            <span />
            <div aria-hidden className="col-span-24 mb-1 h-2 rounded-full" style={{ background: sky }} />
            <span />
            {["Midnight", "6 AM", "Noon", "6 PM"].map((h) => (
              <span key={h} aria-hidden className="text-muted-foreground col-span-6 mb-1 text-xs">
                {h}
              </span>
            ))}
            {WEEKDAYS.map((day, d) => (
              <Row key={day} label={day}>
                {Array.from({ length: 24 }, (_, hour) => {
                  const n = cells.get(`${d + 1}-${hour}`) ?? 0;
                  const tip = `${WEEKDAY_NAMES[d]}, from ${hourName(hour)}: ${meetings(n)}`;
                  return n > 0 ? (
                    <span
                      key={hour}
                      tabIndex={0}
                      data-tip={tip}
                      aria-label={tip}
                      className={cn(
                        "h-6 rounded-[3px] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                        HEAT[heatLevel(n, busiest)],
                      )}
                    />
                  ) : (
                    <span key={hour} aria-hidden className={cn("h-6 rounded-[3px]", HEAT[0])} />
                  );
                })}
              </Row>
            ))}
          </div>
        </div>
      </ChartTooltips>
      <TableView>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={cn(th, "text-right")}>Meetings</th>
            </tr>
          </thead>
          <tbody>
            {[...data.times]
              .sort((a, b) => b.meetings - a.meetings)
              .map((t) => (
                <tr key={`${t.weekday}-${t.hour}`}>
                  <td className={td}>
                    {WEEKDAY_NAMES[t.weekday - 1]}, from {hourName(t.hour)}
                  </td>
                  <td className={cn(td, "text-right")}>{t.meetings}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableView>
    </ChartCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground self-center text-xs">{label}</span>
      {children}
    </>
  );
}

// ─── Meeting types: one bar per type, busiest first ─────────────────────────────

export function MeetingTypes({ data }: { data: Insights }) {
  const most = Math.max(...data.eventTypes.map((t) => t.meetings));
  return (
    <ChartCard title="By meeting type" note="Busiest first.">
      <ul className="flex flex-col gap-4">
        {data.eventTypes.map((t) => (
          <li key={t.title} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{t.title}</span>
              <span className="tabular shrink-0">{meetings(t.meetings)}</span>
            </div>
            <div aria-hidden className="bg-muted h-2 rounded-full">
              <div
                className="bg-chart-1 h-full rounded-full"
                style={{ width: `${(t.meetings / most) * 100}%` }}
              />
            </div>
            {(t.cancelled > 0 || t.noShows > 0) && (
              <p className="text-muted-foreground text-xs">
                {[t.cancelled > 0 && `${t.cancelled} cancelled`, t.noShows > 0 && `${t.noShows} no-show`]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
