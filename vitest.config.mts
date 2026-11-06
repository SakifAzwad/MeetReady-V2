import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests must not depend on the machine's timezone. If someone's laptop is
    // in Asia/Dhaka and CI is in UTC, both must get the same results.
    env: { TZ: "Pacific/Chatham" },
  },
});
