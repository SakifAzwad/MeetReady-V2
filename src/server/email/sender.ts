import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";

/*
 * Sending is behind a tiny interface so the notification code doesn't care
 * HOW mail goes out:
 *  - production: Resend
 *  - local dev without an API key: an "outbox" folder of .html/.ics files you
 *    can open, so the whole flow works with no account or setup
 *  - tests: an in-memory list to assert on
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  ics?: { filename: string; content: string; method: "REQUEST" | "CANCEL" };
};

export type SendOptions = {
  /**
   * Day 17: background jobs can run a step twice (it sent, then crashed before
   * Inngest heard back). With the same key, Resend sends once and answers the
   * repeat with the first result. Keys are built from what the email is about
   * (booking, change, recipient), never random: a random key per try would
   * dedupe nothing.
   */
  idempotencyKey?: string;
};

/**
 * Resend refused this email for good: a bad or forbidden recipient (with no
 * domain yet, Resend's test sender only delivers to the account's own
 * address), a bad API key, an invalid field. Sending it again can't work, so
 * the background jobs don't retry it: they report it once (Sentry) and move
 * on. Any other failure stays a plain Error, which the jobs retry.
 */
export class PermanentEmailError extends Error {
  override name = "PermanentEmailError";
}

/** Resend errors that can pass: too many requests, a race on the same key, their own outage. */
const RETRYABLE = new Set([
  "rate_limit_exceeded",
  "concurrent_idempotent_requests",
  "internal_server_error",
  "application_error",
]);

/** Day 30 fix: which kind of error a Resend error name is (unknown or missing name: retry, the safe side). */
export function resendError(name: string | undefined, message: string): Error {
  const text = `Resend: ${name ?? "unknown"}: ${message}`;
  return name && !RETRYABLE.has(name) ? new PermanentEmailError(text) : new Error(text);
}

export interface EmailSender {
  send(message: EmailMessage, options?: SendOptions): Promise<void>;
}

export function createResendSender(apiKey: string, from: string): EmailSender {
  const resend = new Resend(apiKey);
  return {
    async send(m, options) {
      const { error } = await resend.emails.send(
        {
          from,
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          attachments: m.ics
            ? [
                {
                  filename: m.ics.filename,
                  content: Buffer.from(m.ics.content, "utf8"),
                  // The method parameter is what makes Gmail/Outlook show it as
                  // an invitation (with "Add to calendar") instead of a plain file.
                  contentType: `text/calendar; method=${m.ics.method}; charset=UTF-8`,
                },
              ]
            : undefined,
        },
        options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
      );
      // Same key, different content: this email was already sent once (a retry rebuilt
      // it with a new timestamp). That's success, not a reason to retry forever.
      if (error?.name === "invalid_idempotent_request") return;
      // The Resend SDK returns errors instead of throwing; make them throw so callers notice,
      // as the kind that tells the jobs whether trying again could help.
      if (error) throw resendError(error.name, error.message);
    },
  };
}

export function createOutboxSender(dir: string): EmailSender {
  return {
    async send(m) {
      await mkdir(dir, { recursive: true });
      const base = path.join(dir, `${Date.now()}-${m.to.replace(/[^a-z0-9]+/gi, "_")}`);
      // The .ics first, the .html last: whoever reads the folder (you, or the
      // E2E tests) looks for .html files, so an email is never seen half-written.
      if (m.ics) await writeFile(`${base}.ics`, m.ics.content);
      await writeFile(`${base}.html`, m.html);
      console.warn(`[email] No RESEND_API_KEY: saved "${m.subject}" to ${m.to} as ${base}.html`);
    },
  };
}

/** For tests. Dedupes by idempotency key like Resend does, so tests can prove a retry sends once. */
export function createMemorySender(): EmailSender & { sent: EmailMessage[]; keys: string[] } {
  const sent: EmailMessage[] = [];
  const keys: string[] = [];
  return {
    sent,
    keys,
    async send(m, options) {
      if (options?.idempotencyKey) {
        if (keys.includes(options.idempotencyKey)) return;
        keys.push(options.idempotencyKey);
      }
      sent.push(m);
    },
  };
}
