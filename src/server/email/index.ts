import "server-only";
import os from "node:os";
import path from "node:path";
import { db } from "@/db";
import { env } from "@/lib/env";
import { createOutboxSender, createResendSender, type EmailSender } from "./sender";

const sender: EmailSender = env.RESEND_API_KEY
  ? createResendSender(env.RESEND_API_KEY, env.EMAIL_FROM)
  : createOutboxSender(path.join(os.tmpdir(), "meetready-emails"));

/** What the notification functions need, for "right now". */
export function emailContext() {
  return { db, sender, appUrl: env.BETTER_AUTH_URL, now: new Date() };
}
