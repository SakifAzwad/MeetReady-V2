import { MockLanguageModelV4 } from "ai/test";

/*
 * A fake AI model for unit tests (Day 18): no network, no key, no cost, and
 * the same answer every time. It answers with `reply` (an object is sent as
 * JSON text, like a real model's structured output), or throws it if it's an
 * Error. The calls it received are in `model.doGenerateCalls`, so tests can
 * check exactly what would have been sent to the provider.
 */
export function mockModel(reply: unknown, usage = { input: 320, output: 140 }) {
  return new MockLanguageModelV4({
    modelId: "mock-model",
    doGenerate: async () => {
      if (reply instanceof Error) throw reply;
      return {
        content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: usage.input, noCache: usage.input, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

/** The text of everything the model was sent in its first call: instructions and prompt. */
export function sentText(model: MockLanguageModelV4): string {
  return JSON.stringify(model.doGenerateCalls[0]?.prompt ?? []);
}

export type MockStep =
  { tool: string; input: unknown } | { tools: { tool: string; input: unknown }[] } | { text: string } | Error;

/**
 * A fake model that plays a script, one entry per call: call a tool, call
 * several, answer with text, or fail. Used for the booking assistant (Day 19),
 * where one request is several model calls with tool results in between.
 * Past the end of the script it keeps answering "Done.".
 */
export function mockModelSteps(steps: MockStep[], usage = { input: 200, output: 40 }) {
  let call = 0;
  const usageOf = () => ({
    inputTokens: { total: usage.input, noCache: usage.input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
  });
  return new MockLanguageModelV4({
    modelId: "mock-model",
    doGenerate: async () => {
      const step = steps[call++] ?? { text: "Done." };
      if (step instanceof Error) throw step;
      if ("text" in step) {
        return {
          content: [{ type: "text", text: step.text }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: usageOf(),
          warnings: [],
        };
      }
      const calls = "tools" in step ? step.tools : [step];
      return {
        content: calls.map((c, i) => ({
          type: "tool-call" as const,
          toolCallId: `call-${call}-${i}`,
          toolName: c.tool,
          input: JSON.stringify(c.input),
        })),
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: usageOf(),
        warnings: [],
      };
    },
  });
}

/** What the model was told a tool returned, in the call after it (for asserting on tool results). */
export function toolResultsSeen(model: MockLanguageModelV4, callIndex: number): unknown[] {
  const prompt = model.doGenerateCalls[callIndex]?.prompt ?? [];
  return prompt
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content)
    .map((part) => ("output" in part ? part.output : part));
}
