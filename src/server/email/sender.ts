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

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createResendSender(apiKey: string, from: string): EmailSender {
  const resend = new Resend(apiKey);
  return {
    async send(m) {
      const { error } = await resend.emails.send({
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
      });
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
      await writeFile(`${base}.html`, m.html);
      if (m.ics) await writeFile(`${base}.ics`, m.ics.content);
      console.warn(`[email] No RESEND_API_KEY: saved "${m.subject}" to ${m.to} as ${base}.html`);
    },
  };
}

export function createMemorySender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
    },
  };
}
