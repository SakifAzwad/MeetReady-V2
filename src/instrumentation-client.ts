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
 * Browser-side error monitoring. Runs before the app hydrates. Same privacy
 * rules as the server (src/lib/monitoring.ts). Reports go to /monitoring on
 * our own domain (the tunnel, set in next.config.ts), so ad blockers that
 * block sentry.io don't hide our users' errors.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: monitoringEnvironment(process.env.NEXT_PUBLIC_VERCEL_ENV),
    dataCollection: DATA_COLLECTION,
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
  });
}

/** Lets Sentry tie errors to the page navigation they happened after. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
