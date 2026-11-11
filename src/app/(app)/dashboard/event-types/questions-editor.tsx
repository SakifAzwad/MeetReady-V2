"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  Controller,
  get,
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
  type Path,
  type UseFormRegister,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EventTypeFormValues, EventTypeInput } from "@/lib/validation/event-type";
import {
  QUESTION_LIMITS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  blankQuestion,
  type QuestionFormValues,
  type QuestionType,
} from "@/lib/validation/questions";

type FormControl = Control<EventTypeFormValues, unknown, EventTypeInput>;
type Errors = FieldErrors<EventTypeFormValues>;

/*
 * The host's list of booking questions, inside the event type form.
 *
 * - useFieldArray manages the list (add, remove, move, replace one item).
 *   Each row reads its own values with useWatch, so typing in one question
 *   doesn't re-render the others.
 * - Reordering is "Move up / Move down" buttons, not drag and drop: they work
 *   with a keyboard and a screen reader for free, and are easy to test.
 * - After an action that moves or removes DOM nodes, focus is put back on
 *   purpose (the same button, or "Add question"), and a polite live region
 *   says what happened ("Moved Company to position 1 of 3").
 */

/** Some paths only exist on some question types (options on choices). RHF can't type those for a union. */
const path = (p: string) => p as Path<EventTypeFormValues>;

/** Focus an element by id after React has committed the change. */
const focusLater = (...ids: string[]) =>
  requestAnimationFrame(() => {
    for (const id of ids) {
      const el = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null;
      if (el && !el.disabled) return el.focus();
    }
  });

export function QuestionsEditor({
  control,
  register,
  errors,
}: {
  control: FormControl;
  register: UseFormRegister<EventTypeFormValues>;
  errors: Errors;
}) {
  const { fields, append, remove, move, update } = useFieldArray({ control, name: "questions" });
  const questions = useWatch({ control, name: "questions" });
  const [announcement, setAnnouncement] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  const full = fields.length >= QUESTION_LIMITS.questions;

  const labelOf = (i: number) => questions[i]?.label.trim() || `question ${i + 1}`;

  function add() {
    // The id is made here, in the browser, so the question has a stable
    // identity before its first save. The server checks it's a UUID.
    append(blankQuestion("text", { id: crypto.randomUUID() }), {
      focusName: `questions.${fields.length}.label`,
    });
  }

  function moveTo(from: number, to: number) {
    const q = questions[from];
    if (!q) return;
    move(from, to);
    setAnnouncement(`Moved ${labelOf(from)} to position ${to + 1} of ${fields.length}.`);
    // Keep focus on the button that was pressed; at the edge it's disabled, so use the other one.
    const [same, other] = to < from ? ["up", "down"] : ["down", "up"];
    focusLater(`q-${q.id}-${same}`, `q-${q.id}-${other}`);
  }

  function removeAt(i: number) {
    setAnnouncement(`Removed ${labelOf(i)}.`);
    remove(i);
    addRef.current?.focus();
  }

  function changeType(i: number, type: QuestionType) {
    const q = questions[i];
    if (!q) return;
    // Keep what still fits: label, required, and options between the two choice types.
    update(i, blankQuestion(type, { ...q, options: "options" in q ? q.options : undefined }));
    // update() remounts the row, so the select loses focus: give it back.
    focusLater(`q-${q.id}-type`);
  }

  return (
    <Card>
      <div className="flex flex-col gap-1.5">
        <CardTitle>Booking questions</CardTitle>
        <CardDescription>
          Guests always give their name and email, and can add notes. Ask up to {QUESTION_LIMITS.questions}{" "}
          more questions.
        </CardDescription>
      </div>

      {fields.length > 0 && (
        <ol className="flex flex-col gap-4">
          {fields.map((field, i) => (
            <QuestionRow
              key={field.id}
              index={i}
              count={fields.length}
              control={control}
              register={register}
              errors={errors}
              onMove={moveTo}
              onRemove={removeAt}
              onTypeChange={changeType}
            />
          ))}
        </ol>
      )}

      <Button
        ref={addRef}
        type="button"
        variant="outline"
        className="self-start"
        onClick={add}
        disabled={full}
      >
        <Plus /> Add question
      </Button>
      {full && <p className="text-muted-foreground text-xs">That&apos;s the most one event type can have.</p>}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
}

function QuestionRow({
  index,
  count,
  control,
  register,
  errors,
  onMove,
  onRemove,
  onTypeChange,
}: {
  index: number;
  count: number;
  control: FormControl;
  register: UseFormRegister<EventTypeFormValues>;
  errors: Errors;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onTypeChange: (index: number, type: QuestionType) => void;
}) {
  const q = useWatch({ control, name: `questions.${index}` }) as QuestionFormValues | undefined;
  if (!q) return null;
  const id = `q-${q.id}`;
  const name = q.label.trim() || `question ${index + 1}`;
  const error = (field: string) =>
    (get(errors, `questions.${index}.${field}`) as { message?: string } | undefined)?.message;

  return (
    <li className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground font-sans text-sm font-medium">Question {index + 1}</h3>
        <div className="flex gap-1">
          <Button
            id={`${id}-up`}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${name} up`}
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowUp />
          </Button>
          <Button
            id={`${id}-down`}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${name} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${name}`}
            onClick={() => onRemove(index)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
        <Field id={`${id}-label`} label="Question" error={error("label")}>
          {(aria) => (
            <Input
              {...aria}
              placeholder="What's your company called?"
              maxLength={QUESTION_LIMITS.label}
              {...register(`questions.${index}.label`)}
            />
          )}
        </Field>
        <Field id={`${id}-type`} label="Answer type">
          {(aria) => (
            <NativeSelect
              {...aria}
              value={q.type}
              onChange={(e) => onTypeChange(index, e.target.value as QuestionType)}
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>

      {(q.type === "choice" || q.type === "multi_choice") && (
        <Controller
          control={control}
          name={path(`questions.${index}.options`)}
          render={({ field }) => (
            <OptionsEditor
              id={id}
              options={field.value as string[]}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={error("options")}
              optionError={(j) => error(`options.${j}`)}
            />
          )}
        />
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <ToggleField control={control} id={`${id}-required`} name={path(`questions.${index}.required`)}>
          Required
        </ToggleField>
        {q.type === "text" && (
          <ToggleField control={control} id={`${id}-multiline`} name={path(`questions.${index}.multiline`)}>
            Long answer
          </ToggleField>
        )}
      </div>
    </li>
  );
}

function ToggleField({
  control,
  id,
  name,
  children,
}: {
  control: FormControl;
  id: string;
  name: Path<EventTypeFormValues>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Switch id={id} checked={field.value === true} onCheckedChange={field.onChange} />
        )}
      />
      <Label htmlFor={id}>{children}</Label>
    </div>
  );
}

/**
 * The options of a choice question: one input each. Enter in the last one
 * adds another (instead of submitting the whole event type form); Enter in
 * any other moves to the next.
 */
function OptionsEditor({
  id,
  options,
  onChange,
  onBlur,
  error,
  optionError,
}: {
  id: string;
  options: string[];
  onChange: (options: string[]) => void;
  onBlur: () => void;
  error?: string;
  optionError: (index: number) => string | undefined;
}) {
  const inputId = (j: number) => `${id}-option-${j}`;
  const canAdd = options.length < QUESTION_LIMITS.options;
  const canRemove = options.length > 2;

  function add() {
    if (!canAdd) return;
    onChange([...options, ""]);
    focusLater(inputId(options.length));
  }

  function removeAt(j: number) {
    onChange(options.filter((_, k) => k !== j));
    focusLater(inputId(Math.max(0, j - 1)));
  }

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${id}-options-error` : undefined}>
      <legend className="mb-2 text-sm font-medium">Options</legend>
      {options.map((option, j) => {
        const message = optionError(j);
        return (
          <div key={j} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                id={inputId(j)}
                aria-label={`Option ${j + 1}`}
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? `${inputId(j)}-error` : undefined}
                maxLength={QUESTION_LIMITS.option}
                value={option}
                onBlur={onBlur}
                onChange={(e) => onChange(options.map((o, k) => (k === j ? e.target.value : o)))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (j === options.length - 1) add();
                  else focusLater(inputId(j + 1));
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove option ${j + 1}`}
                disabled={!canRemove}
                onClick={() => removeAt(j)}
              >
                <X />
              </Button>
            </div>
            {message && (
              <p id={`${inputId(j)}-error`} className="text-destructive text-xs">
                {message}
              </p>
            )}
          </div>
        );
      })}
      {error && (
        <p id={`${id}-options-error`} className="text-destructive text-xs">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        onClick={add}
        disabled={!canAdd}
      >
        <Plus /> Add option
      </Button>
    </fieldset>
  );
}
