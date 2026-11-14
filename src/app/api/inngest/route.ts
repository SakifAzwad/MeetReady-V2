import { serve } from "inngest/next";
import { functions, inngest } from "@/server/jobs";

/*
 * Where Inngest calls in to run our background jobs (Day 17). Inngest sends a
 * signed request for each step; the SDK checks the signature with
 * INNGEST_SIGNING_KEY and refuses anything unsigned, so this public URL can't
 * be used to trigger jobs. No rate limit here: the only legitimate caller is
 * Inngest, and an IP limit would throttle Inngest itself.
 *
 * GET = status page for Inngest, PUT = "sync" (Inngest reads our function list
 * after each deploy), POST = run a step.
 */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
