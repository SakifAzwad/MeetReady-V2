import type { z } from "zod";

/**
 * Zod issues -> { "questions.2.options.1": ["Same as another option"] }.
 *
 * z.flattenError() only keys by the FIRST path segment, so every error inside
 * the questions list would land on "questions" and the form couldn't put it
 * next to the right input. Dotted paths are exactly what React Hook Form's
 * setError() takes, so the server's errors show where the browser's would.
 */
export function fieldErrorsByPath(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
