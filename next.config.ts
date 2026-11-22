import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { SECURITY_HEADER_RULES } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Framing is denied everywhere except the embeddable booking page (Day 27): see the file.
  async headers() {
    return SECURITY_HEADER_RULES;
  },
};

/*
 * Sentry (Day 13). The build uploads source maps so error reports show our
 * real code, then deletes them from the public output. Without
 * SENTRY_AUTH_TOKEN (local builds, CI) nothing is uploaded and the build
 * still works.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Browser reports go to our own /monitoring (see src/app/sentry-tunnel/route.ts),
  // which ad blockers don't block. A fixed path, so proxy.ts can skip it.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Quiet locally; full logs in CI and on Vercel.
  silent: !process.env.CI,
  // Don't send usage data about our builds to Sentry.
  telemetry: false,
});
