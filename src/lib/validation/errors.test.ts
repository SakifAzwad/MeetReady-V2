import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldErrorsByPath } from "./errors";

describe("fieldErrorsByPath", () => {
  it("keys errors by their full dotted path, like React Hook Form field names", () => {
    const schema = z.object({
      title: z.string().min(1, "Give it a title"),
      questions: z.array(z.object({ options: z.array(z.string().min(1, "Empty option")) })),
    });
    const result = schema.safeParse({ title: "", questions: [{ options: ["a"] }, { options: ["b", ""] }] });
    expect(fieldErrorsByPath(result.error!)).toEqual({
      title: ["Give it a title"],
      "questions.1.options.1": ["Empty option"],
    });
  });
});
