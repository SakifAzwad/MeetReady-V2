import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { aiCalls, bookingBriefs } from "@/db/schema";
import type { Database } from "@/db/types";
import { getBookingDetails } from "../manage-booking";
import { hasBriefContent, writeBrief, type MeetingBrief } from "./brief";

/*
 * Writing and reading the stored brief (Day 18). The decisions about WHETHER
 * to call the model live here, in order of cost: the cheapest "no" first.
 */

export type BriefDeps = {
  db: Database;
  /** Null when no API key is set: AI is off and nothing is called. */
  model: LanguageModel | null;
  modelId: string;
  /** Our own budget (per host, and for the whole app). False = over it. */
  allow: (hostId: string) => Promise<boolean>;
  report: (error: unknown, bookingId: string) => void;
  /** Milliseconds, for timing the call. Tests pass a fake. */
  clock?: () => number;
};

export type BriefOutcome =
  "written" | "exists" | "no_content" | "ai_off" | "limited" | "failed" | "not_needed";

export const BRIEF_FEATURE = "meeting_brief";

/**
 * Makes sure a confirmed booking has its brief, if it should. Safe to run
 * twice (a retried job step): an existing brief is kept, not rewritten. Never
 * throws: the host's email waits for this, and must go out whatever happens.
 */
export async function prepareBrief(deps: BriefDeps, bookingId: string): Promise<BriefOutcome> {
  try {
    const b = await getBookingDetails(deps.db, bookingId);
    if (!b || b.status !== "confirmed") return "not_needed";
    if (await getBrief(deps.db, b.id)) return "exists";
    if (!hasBriefContent(b.guestNotes, b.answers)) return "no_content";
    if (!deps.model) return "ai_off";
    if (!(await deps.allow(b.hostId))) return "limited";

    const clock = deps.clock ?? Date.now;
    const started = clock();
    const call = await writeBrief(deps.model, b);
    await deps.db.insert(aiCalls).values({
      feature: BRIEF_FEATURE,
      model: deps.modelId,
      hostId: b.hostId,
      bookingId: b.id,
      outcome: call.ok ? "ok" : call.outcome,
      inputTokens: call.inputTokens ?? null,
      outputTokens: call.outputTokens ?? null,
      durationMs: Math.round(clock() - started),
    });
    if (!call.ok) {
      // A failed validation's message quotes the model's answer, which is built from the guest's
      // text: report only the kind of failure. A provider error (timeout, 429, 5xx) is safe to pass on.
      const name = call.error instanceof Error ? call.error.name : "Error";
      deps.report(
        call.outcome === "invalid_output"
          ? new Error(`Meeting brief failed our checks (${name})`)
          : call.error,
        b.id,
      );
      return "failed";
    }
    await deps.db
      .insert(bookingBriefs)
      .values({ bookingId: b.id, ...call.brief, model: deps.modelId })
      .onConflictDoNothing();
    return "written";
  } catch (error) {
    deps.report(error, bookingId);
    return "failed";
  }
}

export async function getBrief(db: Database, bookingId: string): Promise<MeetingBrief | null> {
  const [row] = await db
    .select({ summary: bookingBriefs.summary, agenda: bookingBriefs.agenda, prepare: bookingBriefs.prepare })
    .from(bookingBriefs)
    .where(eq(bookingBriefs.bookingId, bookingId));
  return row ?? null;
}
