/*
 * The browser's error reports arrive at /monitoring (next.config.ts rewrites
 * it here) and this handler forwards them to Sentry.
 *
 * Why a handler and not a plain rewrite to sentry.io: a rewrite forwards the
 * browser's request headers too, cookies included. This handler sends only
 * the event itself, and only to OUR project (the server's DSN), so the route
 * can't be used to relay junk to anyone else's Sentry.
 */
export { POST } from "@sentry/nextjs/tunnel";
