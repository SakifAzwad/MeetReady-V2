import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

/*
 * Evals (Day 18): the AI features against a REAL model, with fixed inputs
 * including prompt-injection attempts. Not part of `npm test` or CI: they need
 * an API key, use the provider's quota, and a model's answers vary a little
 * between runs. Run before changing a prompt or a model:
 *
 *   npm run eval
 *
 * Reads GROQ_API_KEY (and AI_MODEL) from .env.local.
 */
config({ path: ".env.local", quiet: true });

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.eval.ts"],
    testTimeout: 60_000,
    // One at a time: the free plan allows a few requests a minute.
    fileParallelism: false,
    env: { TZ: "Pacific/Chatham" },
  },
});
