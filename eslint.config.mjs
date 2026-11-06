import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // v1 shipped with console.log everywhere. Use Sentry / a logger instead.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  // Must be last: turns off ESLint rules that fight with Prettier's formatting.
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/meta/**"]),
]);

export default eslintConfig;
