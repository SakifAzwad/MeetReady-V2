import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  answersSchema,
  blankQuestion,
  formatAnswer,
  initialAnswers,
  questionsSchema,
  toAnswerSnapshot,
  type Question,
} from "./questions";

const COMPANY: Question = {
  id: randomUUID(),
  type: "text",
  label: "Company",
  required: true,
  multiline: false,
};
const AGENDA: Question = {
  id: randomUUID(),
  type: "text",
  label: "Agenda",
  required: false,
  multiline: true,
};
const ROLE: Question = {
  id: randomUUID(),
  type: "choice",
  label: "Your role",
  required: true,
  options: ["Engineer", "Designer", "Founder"],
};
const TOPICS: Question = {
  id: randomUUID(),
  type: "multi_choice",
  label: "Topics",
  required: false,
  options: ["Pricing", "Hiring", "Roadmap"],
};
const TERMS: Question = {
  id: randomUUID(),
  type: "checkbox",
  label: "I agree to be recorded",
  required: true,
};
const SLIDES: Question = { id: randomUUID(), type: "checkbox", label: "Send me the slides", required: false };
const ALL = [COMPANY, AGENDA, ROLE, TOPICS, TERMS, SLIDES];

/** Field path -> first message, the way the form shows them. */
function errors(result: { success: boolean; error?: z.ZodError }) {
  return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
}

describe("questionsSchema (host side)", () => {
  it("accepts every question type and trims text", () => {
    const parsed = questionsSchema.parse([
      { ...COMPANY, label: "  Company  " },
      { ...ROLE, options: [" Engineer ", "Designer"] },
      TOPICS,
      TERMS,
    ]);
    expect(parsed[0]!.label).toBe("Company");
    expect(parsed[1]).toMatchObject({ options: ["Engineer", "Designer"] });
  });

  it("needs a label and at least 2 non-empty options", () => {
    const result = questionsSchema.safeParse([
      { ...COMPANY, label: " " },
      { ...ROLE, options: ["Only one"] },
      { ...TOPICS, options: ["Pricing", "  "] },
    ]);
    expect(errors(result)).toEqual({
      "0.label": "Write the question",
      "1.options": "Add at least 2 options",
      "2.options.1": "Fill in this option or remove it",
    });
  });

  it("rejects duplicate options, labels and ids (case- and space-insensitive)", () => {
    const result = questionsSchema.safeParse([
      { ...ROLE, options: ["Engineer", "engineer "] },
      { ...COMPANY, label: "your role" },
      { ...TERMS, id: ROLE.id },
    ]);
    expect(errors(result)).toEqual({
      "0.options.1": "Same as another option",
      "1.label": "You already asked this",
      "2.id": "Duplicate question id",
    });
  });

  it("allows at most 10 questions", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...COMPANY, id: randomUUID(), label: `Q${i}` }));
    expect(questionsSchema.safeParse(many.slice(0, 10)).success).toBe(true);
    expect(errors(questionsSchema.safeParse(many))).toEqual({ "": "At most 10 questions" });
  });

  it("only accepts UUID ids and known types", () => {
    expect(questionsSchema.safeParse([{ ...COMPANY, id: "1" }]).success).toBe(false);
    expect(questionsSchema.safeParse([{ ...COMPANY, type: "file" }]).success).toBe(false);
  });

  it("blankQuestion keeps the label, required and options when switching type", () => {
    const id = randomUUID();
    expect(blankQuestion("multi_choice", { id, label: "Role", required: true, options: ["A", "B"] })).toEqual(
      { id, type: "multi_choice", label: "Role", required: true, options: ["A", "B"] },
    );
    expect(blankQuestion("choice", { id })).toMatchObject({ options: ["", ""] });
    expect(blankQuestion("text", { id, label: "Role" })).toEqual({
      id,
      type: "text",
      label: "Role",
      required: false,
      multiline: false,
    });
  });
});

describe("answersSchema (guest side)", () => {
  const schema = answersSchema(ALL);
  const valid = {
    [COMPANY.id]: "  Acme  ",
    [AGENDA.id]: "",
    [ROLE.id]: "Founder",
    [TOPICS.id]: ["Roadmap", "Pricing", "Roadmap"],
    [TERMS.id]: true,
    [SLIDES.id]: false,
  };

  it("accepts valid answers, trims text, de-duplicates and orders picks like the host's options", () => {
    const parsed = schema.parse(valid);
    expect(parsed[COMPANY.id]).toBe("Acme");
    expect(parsed[TOPICS.id]).toEqual(["Pricing", "Roadmap"]);
  });

  it("requires required questions, whatever their type", () => {
    const result = schema.safeParse({ [AGENDA.id]: "" });
    expect(errors(result)).toEqual({
      [COMPANY.id]: "Please answer this",
      [ROLE.id]: "Pick one",
      [TERMS.id]: "Tick this to continue",
    });
    expect(errors(answersSchema([{ ...TOPICS, required: true }]).safeParse({}))).toEqual({
      [TOPICS.id]: "Pick at least one",
    });
    // Empty and unticked count as unanswered too, not just missing.
    expect(errors(schema.safeParse({ ...valid, [COMPANY.id]: "   ", [TERMS.id]: false }))).toEqual({
      [COMPANY.id]: "Please answer this",
      [TERMS.id]: "Tick this to continue",
    });
  });

  it("lets optional questions be skipped (missing, empty, or a radio left as null)", () => {
    const optional = answersSchema([AGENDA, TOPICS, SLIDES, { ...ROLE, required: false }]);
    expect(optional.safeParse({}).success).toBe(true);
    expect(optional.safeParse({ [AGENDA.id]: "", [TOPICS.id]: [], [ROLE.id]: null }).success).toBe(true);
  });

  it("rejects options that weren't offered (a guest can send anything)", () => {
    expect(errors(schema.safeParse({ ...valid, [ROLE.id]: "CEO" }))).toEqual({
      [ROLE.id]: "Pick one of the options",
    });
    expect(errors(schema.safeParse({ ...valid, [TOPICS.id]: ["Pricing", "Free lunch"] }))).toEqual({
      [TOPICS.id]: "Pick from the options",
    });
  });

  it("rejects wrong types, overlong text and answers to unknown questions", () => {
    expect(schema.safeParse({ ...valid, [TERMS.id]: "yes" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, [ROLE.id]: ["Founder"] }).success).toBe(false);
    expect(errors(schema.safeParse({ ...valid, [AGENDA.id]: "x".repeat(1001) }))).toEqual({
      [AGENDA.id]: "At most 1000 characters",
    });
    const unknown = schema.safeParse({ ...valid, [randomUUID()]: "sneaky" });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("an event type without questions accepts only no answers", () => {
    expect(answersSchema([]).safeParse({}).success).toBe(true);
    expect(answersSchema([]).safeParse({ x: "y" }).success).toBe(false);
  });
});

describe("initialAnswers", () => {
  it("gives every question an empty answer of the right type", () => {
    expect(initialAnswers(ALL)).toEqual({
      [COMPANY.id]: "",
      [AGENDA.id]: "",
      [ROLE.id]: "",
      [TOPICS.id]: [],
      [TERMS.id]: false,
      [SLIDES.id]: false,
    });
  });

  it("keeps what the guest typed when it still fits the (possibly changed) questions", () => {
    const changedRole = { ...ROLE, options: ["Engineer", "Other"] };
    const draft = {
      [COMPANY.id]: "Acme",
      [ROLE.id]: "Founder", // option removed by the host
      [TOPICS.id]: ["Hiring", "Gone"],
      [TERMS.id]: true,
      deleted: "an answer to a question that no longer exists",
    };
    expect(initialAnswers([COMPANY, changedRole, TOPICS, TERMS], draft)).toEqual({
      [COMPANY.id]: "Acme",
      [ROLE.id]: "",
      [TOPICS.id]: ["Hiring"],
      [TERMS.id]: true,
    });
  });
});

describe("toAnswerSnapshot", () => {
  it("copies label and type, in question order, leaving out unanswered optional questions", () => {
    const answers = answersSchema(ALL).parse({
      [TOPICS.id]: [],
      [TERMS.id]: true,
      [ROLE.id]: "Engineer",
      [COMPANY.id]: "Acme",
      [AGENDA.id]: "",
      [SLIDES.id]: false,
    });
    expect(toAnswerSnapshot(ALL, answers)).toEqual([
      { questionId: COMPANY.id, label: "Company", type: "text", value: "Acme" },
      { questionId: ROLE.id, label: "Your role", type: "choice", value: "Engineer" },
      { questionId: TERMS.id, label: "I agree to be recorded", type: "checkbox", value: true },
      // An unticked optional checkbox is a real "No", so it's kept.
      { questionId: SLIDES.id, label: "Send me the slides", type: "checkbox", value: false },
    ]);
  });

  it("formats answers for people", () => {
    expect(formatAnswer({ value: true })).toBe("Yes");
    expect(formatAnswer({ value: false })).toBe("No");
    expect(formatAnswer({ value: ["Pricing", "Roadmap"] })).toBe("Pricing, Roadmap");
    expect(formatAnswer({ value: "Acme" })).toBe("Acme");
  });
});
