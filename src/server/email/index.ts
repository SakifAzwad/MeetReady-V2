import "server-only";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { createOutboxSender, createResendSender, type EmailSender } from "./sender";

export const emailSender: EmailSender = env.RESEND_API_KEY
  ? createResendSender(env.RESEND_API_KEY, env.EMAIL_FROM)
  : createOutboxSender(path.join(os.tmpdir(), "meetready-emails"));
