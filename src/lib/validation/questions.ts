import { z } from "zod";

/*
 * Custom booking questions (Day 10).
 *
 * Two halves, both pure and shared by browser and server:
 *
 *  1. The QUESTIONS a host defines on an event type (`questionsSchema`). Stored
 *     as one jsonb array on event_types: they're always read and saved together
 *     with their event type, so a separate table would only add sort-order
 *     columns and insert/update/delete diffing on every save.
 *
 *  2. The ANSWERS a guest gives (`answersSchema(questions)`). There's no fixed
 *     shape: the schema is BUILT from the host's questions. The booking form
 *     uses it for instant feedback, and createBooking() runs it again against
 *     the questions as they are at that moment, inside the transaction.
 *
 * Answers are stored as a SNAPSHOT (`toAnswerSnapshot`): each answer copies its
 * question's label and type. If the host renames or deletes a question later,
 * a past booking still reads "Company: Acme" instead of pointing at nothing.
 */

export const QUESTION_TYPES = ["text", "choice", "multi_choice", "checkbox"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: "Text",
  choice: "Pick one",
  multi_choice: "Pick several",
  checkbox: "Checkbox",
};

/** Limits keep what an anonymous guest can store small (and the forms sane). */
export const QUESTION_LIMITS = {
  questions: 10,
  label: 200,
  options: 10,
  option: 100,
  answer: 1000,
} as const;

// ─── Questions (host side) ──────────────────────────────────────────────────────

const label = z
  .string()
  .trim()
  .min(1, "Write the question")
  .max(QUESTION_LIMITS.label, `At most ${QUESTION_LIMITS.label} characters`);

const options = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Fill in this option or remove it")
      .max(QUESTION_LIMITS.option, `At most ${QUESTION_LIMITS.option} characters`),
  )
  .min(2, "Add at least 2 options")
  .max(QUESTION_LIMITS.options, `At most ${QUESTION_LIMITS.options} options`);

const base = {
  /**
   * Made in the browser (crypto.randomUUID) when the host adds a question, so
   * it's stable before the first save. Answers are keyed by it. The server
   * only checks it's a UUID and unique within this event type: an id can't
   * reach anything outside its own event type's JSON.
   */
  id: z.uuid(),
  label,
  required: z.boolean(),
};

/**
 * A discriminated union: what a question has depends on its type, and
 * TypeScript narrows on `type` (only choice questions have `options`).
 */
export const questionSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("text"), multiline: z.boolean() }),
  z.object({ ...base, type: z.literal("choice"), options }),
  z.object({ ...base, type: z.literal("multi_choice"), options }),
  z.object({ ...base, type: z.literal("checkbox") }),
]);

export type Question = z.output<typeof questionSchema>;
export type QuestionFormValues = z.input<typeof questionSchema>;

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The list on an event type: at most 10, unique ids, unique labels, unique options. */
export const questionsSchema = z
  .array(questionSchema)
  .max(QUESTION_LIMITS.questions, `At most ${QUESTION_LIMITS.questions} questions`)
  .superRefine((questions, ctx) => {
    questions.forEach((q, i) => {
      if (questions.findIndex((other) => other.id === q.id) !== i)
        ctx.addIssue({ code: "custom", path: [i, "id"], message: "Duplicate question id" });
      // Two questions both called "Company" would be ambiguous in the host's email.
      if (questions.findIndex((other) => sameText(other.label, q.label)) !== i)
        ctx.addIssue({ code: "custom", path: [i, "label"], message: "You already asked this" });
      // The answer IS the option text, so two equal options can't be told apart.
      if (q.type === "choice" || q.type === "multi_choice") {
        q.options.forEach((option, j) => {
          if (q.options.findIndex((other) => sameText(other, option)) !== j)
            ctx.addIssue({ code: "custom", path: [i, "options", j], message: "Same as another option" });
        });
      }
    });
  });

/** A new, empty question of a type, keeping what still fits when the host switches type. */
export function blankQuestion(
  type: QuestionType,
  keep: { id: string; label?: string; required?: boolean; options?: string[] },
): QuestionFormValues {
  const common = { id: keep.id, label: keep.label ?? "", required: keep.required ?? false };
  switch (type) {
    case "text":
      return { ...common, type, multiline: false };
    case "choice":
    case "multi_choice":
      return { ...common, type, options: keep.options?.length ? keep.options : ["", ""] };
    case "checkbox":
      return { ...common, type };
  }
}

// ─── Answers (guest side) ───────────────────────────────────────────────────────

/** What one answer holds, by question type. */
export type AnswerValue = string | string[] | boolean;
/** Answers keyed by question id: what the form holds and the action receives. */
export type Answers = Record<string, AnswerValue>;

const REQUIRED = "Please answer this";

function answerSchema(q: Question) {
  switch (q.type) {
    case "text": {
      const text = z
        .string({ error: REQUIRED })
        .trim()
        .max(QUESTION_LIMITS.answer, `At most ${QUESTION_LIMITS.answer} characters`);
      return q.required ? text.min(1, REQUIRED) : text.optional();
    }
    case "choice": {
      // Radio groups with nothing picked come through as "" or null: both mean "no answer".
      const picked = z
        .union([z.string(), z.null()], { error: "Pick one of the options" })
        .optional()
        .transform((v) => v ?? "")
        .refine((v) => v === "" || q.options.includes(v), "Pick one of the options");
      return q.required ? picked.refine((v) => v !== "", "Pick one") : picked;
    }
    case "multi_choice": {
      const picked = z
        .array(z.string(), { error: "Pick from the options" })
        .optional()
        .transform((v) => [...new Set(v ?? [])])
        .refine((v) => v.every((o) => q.options.includes(o)), "Pick from the options")
        // Stored in the host's order, not the order they were clicked.
        .transform((v) => q.options.filter((o) => v.includes(o)));
      return q.required ? picked.refine((v) => v.length > 0, "Pick at least one") : picked;
    }
    case "checkbox":
      // Not `.optional().refine()` for the required case: Zod skips an optional
      // key that's missing altogether, refinement included, so "not sent"
      // would slip past "must be ticked".
      return q.required
        ? z.boolean({ error: "Tick this to continue" }).refine((v) => v === true, "Tick this to continue")
        : z.boolean({ error: "Tick or untick this" }).optional();
  }
}

/**
 * The answers schema for one event type, built from its questions.
 *
 * `strictObject`: an answer to a question that doesn't exist is an error, not
 * silently dropped. That's also how the server notices a form built from an
 * older version of the questions.
 */
export function answersSchema(questions: Question[]) {
  return z.strictObject(Object.fromEntries(questions.map((q) => [q.id, answerSchema(q)])));
}

/** Form defaults: an empty answer per question, keeping what the guest already typed if it still fits. */
export function initialAnswers(questions: Question[], draft: Answers = {}): Answers {
  return Object.fromEntries(
    questions.map((q) => {
      const typed = draft[q.id];
      switch (q.type) {
        case "text":
          return [q.id, typeof typed === "string" ? typed : ""];
        case "choice":
          return [q.id, typeof typed === "string" && q.options.includes(typed) ? typed : ""];
        case "multi_choice":
          return [q.id, Array.isArray(typed) ? typed.filter((o) => q.options.includes(o)) : []];
        case "checkbox":
          return [q.id, typed === true];
      }
    }),
  );
}

// ─── Stored snapshot ────────────────────────────────────────────────────────────

/** One answer as stored on a booking: self-contained, readable without the question. */
export type BookingAnswer = {
  questionId: string;
  label: string;
  type: QuestionType;
  value: AnswerValue;
};

/**
 * Validated answers -> what's stored on the booking, in the host's question
 * order. Unanswered optional text and choice questions are left out (nothing
 * to show). A checkbox is always kept: an unticked "Send me the slides" is a
 * real "No".
 */
export function toAnswerSnapshot(questions: Question[], answers: Record<string, unknown>): BookingAnswer[] {
  const out: BookingAnswer[] = [];
  for (const q of questions) {
    const value = answers[q.id];
    if (q.type === "checkbox") {
      out.push({ questionId: q.id, label: q.label, type: q.type, value: value === true });
    } else if (typeof value === "string" ? value !== "" : Array.isArray(value) && value.length > 0) {
      out.push({ questionId: q.id, label: q.label, type: q.type, value: value as AnswerValue });
    }
  }
  return out;
}

/** "Yes", "Design, Engineering", or the text itself. */
export function formatAnswer(answer: Pick<BookingAnswer, "value">): string {
  const { value } = answer;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}
