import * as Sentry from "@sentry/nextjs";
import {
  DATA_COLLECTION,
  DENY_URLS,
  IGNORE_ERRORS,
  monitoringEnvironment,
  scrubDeep,
  scrubEvent,
} from "@/lib/monitoring";

/*
 * Server-side error monitoring (Next.js runs register() once when a server
 * instance starts). Errors in server rendering, server actions, route
 * handlers and proxy reach Sentry through onRequestError below.
 *
 * Off when NEXT_PUBLIC_SENTRY_DSN isn't set: local development and the E2E
 * tests send nothing.
 */
export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: monitoringEnvironment(process.env.VERCEL_ENV),
    // Errors only: no performance tracing yet (it spends the free quota, and
    // with little traffic there's nothing to measure). No session replay, ever.
    // What the SDK may collect by itself: see DATA_COLLECTION (all off).
    dataCollection: DATA_COLLECTION,
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
  });
}

/** Next.js calls this for every uncaught error while handling a request. */
export const onRequestError = Sentry.captureRequestError;
