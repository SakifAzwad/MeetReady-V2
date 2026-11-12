import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/*
 * Security headers on every response. Cheap, and they close whole classes of
 * attack without touching app code:
 *  - frame-ancestors / X-Frame-Options: no other site can load MeetReady in a
 *    frame (clickjacking: a hidden "Confirm booking" under someone's click).
 *    The embeddable widget (Phase 2) will allow framing for that one route.
 *  - nosniff: the browser trusts our Content-Type instead of guessing.
 *  - Referrer-Policy: other sites see only our origin, never a full path.
 *    (The manage page goes further: no referrer at all, set in its metadata.)
 *  - Permissions-Policy: the app never uses the camera, mic or location.
 * HTTPS (HSTS) is enforced by Vercel on its domains.
 *
 * Not yet: a script Content-Security-Policy. It needs per-request nonces,
 * which conflict with serving prerendered static shells; it's in the backlog.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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
