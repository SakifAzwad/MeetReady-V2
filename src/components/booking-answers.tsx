import { cn } from "@/lib/utils";
import { formatAnswer, type BookingAnswer } from "@/lib/validation/questions";

/**
 * A booking's answers as a definition list: the question, then the answer.
 * Reads the stored snapshot, so it shows the labels the guest actually saw,
 * even if the host has renamed or deleted the questions since.
 */
export function BookingAnswers({
  answers,
  className,
}: {
  answers: Pick<BookingAnswer, "questionId" | "label" | "value">[];
  className?: string;
}) {
  if (answers.length === 0) return null;
  return (
    <dl className={cn("flex flex-col gap-2 text-sm", className)}>
      {answers.map((a) => (
        <div key={a.questionId} className="min-w-0">
          <dt className="text-muted-foreground text-xs">{a.label}</dt>
          <dd className="break-words whitespace-pre-line">{formatAnswer(a)}</dd>
        </div>
      ))}
    </dl>
  );
}
