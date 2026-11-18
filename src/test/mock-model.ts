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
