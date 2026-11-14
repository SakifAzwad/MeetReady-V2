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
      // The Resend SDK returns errors instead of throwing; make them throw so callers notice.
      if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
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
