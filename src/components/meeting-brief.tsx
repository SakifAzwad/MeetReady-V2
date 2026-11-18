import { cn } from "@/lib/utils";
import type { MeetingBrief } from "@/server/ai/brief";

/**
 * The AI meeting brief on the host's Bookings page (Day 18). Labelled as
 * AI-written, every time: it's a summary of what the guest typed, and the
 * guest's own words are shown right below it to check against.
 */
export function MeetingBriefCard({
  brief,
  guestName,
  className,
}: {
  brief: MeetingBrief;
  guestName: string;
  className?: string;
}) {
  return (
    <section
      aria-label="Meeting brief"
      className={cn("bg-muted/40 rounded-lg border p-3 text-sm", className)}
    >
      <p className="font-medium">Brief</p>
      <p className="text-muted-foreground text-xs">
        Written by AI from {guestName.split(" ")[0]}&apos;s answers. Their own words are below.
      </p>
      <p className="mt-2">{brief.summary}</p>
      {brief.agenda.length > 0 && (
        <>
          <p className="text-muted-foreground mt-3 text-xs">Agenda</p>
          <ol className="list-decimal pl-5">
            {brief.agenda.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </>
      )}
      {brief.prepare.length > 0 && (
        <>
          <p className="text-muted-foreground mt-3 text-xs">To prepare</p>
          <ul className="list-disc pl-5">
            {brief.prepare.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
