"use client";

import { get, type FieldErrors, type FieldValues, type Path, type UseFormRegister } from "react-hook-form";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { QUESTION_LIMITS, type Question } from "@/lib/validation/questions";

/*
 * The host's questions on the guest's booking form. Answers live under
 * `answers.{questionId}` in the form, the same shape the server action takes.
 *
 * Native inputs throughout: radios and checkboxes get keyboard handling,
 * screen reader support and the phone's own controls for free. Groups are a
 * <fieldset> with a <legend>, so a screen reader announces the question
 * before each option ("Your role, group, Founder, radio button, 3 of 3").
 */

type Props<T extends FieldValues> = {
  questions: Question[];
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
};

export function QuestionFields<T extends FieldValues>({ questions, register, errors }: Props<T>) {
  return questions.map((q) => {
    const name = `answers.${q.id}` as Path<T>;
    const id = `answer-${q.id}`;
    const error = (get(errors, name) as { message?: string } | undefined)?.message;
    const hint = q.required ? undefined : "Optional";

    switch (q.type) {
      case "text":
        return (
          <Field key={q.id} id={id} label={q.label} hint={hint} error={error}>
            {(aria) =>
              q.multiline ? (
                <Textarea {...aria} rows={3} maxLength={QUESTION_LIMITS.answer} {...register(name)} />
              ) : (
                <Input {...aria} maxLength={QUESTION_LIMITS.answer} {...register(name)} />
              )
            }
          </Field>
        );

      case "choice":
      case "multi_choice":
        return (
          <Group key={q.id} id={id} legend={q.label} hint={hint} error={error}>
            {q.options.map((option) => (
              <label key={option} className="flex items-center gap-2.5 text-sm">
                <input
                  type={q.type === "choice" ? "radio" : "checkbox"}
                  value={option}
                  aria-invalid={error ? true : undefined}
                  className="size-4 shrink-0"
                  {...register(name)}
                />
                {option}
              </label>
            ))}
          </Group>
        );

      case "checkbox":
        return (
          <div key={q.id} className="flex flex-col gap-2">
            <label className="flex items-start gap-2.5 text-sm font-medium">
              <input
                type="checkbox"
                id={id}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
                className="mt-0.5 size-4 shrink-0"
                {...register(name)}
              />
              {q.label}
            </label>
            {hint && !error && (
              <p id={`${id}-hint`} className="text-muted-foreground ml-6.5 text-xs">
                {hint}
              </p>
            )}
            {error && (
              <p id={`${id}-error`} className="text-destructive ml-6.5 text-xs">
                {error}
              </p>
            )}
          </div>
        );
    }
  });
}

/** Like <Field>, but for a group of radios or checkboxes. */
function Group({
  id,
  legend,
  hint,
  error,
  children,
}: {
  id: string;
  legend: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={describedBy}>
      <legend className="mb-2 text-sm leading-none font-medium">{legend}</legend>
      <div className="flex flex-col gap-2">{children}</div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </fieldset>
  );
}
