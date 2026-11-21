import { Agent, fetch } from "undici";
import { publicOnlyLookup } from "./address";

/*
 * Sending one webhook request (Day 26). Plain HTTP with three limits that
 * matter for a server that POSTs to URLs strangers type:
 *  - Every connection goes through publicOnlyLookup (address.ts): no private
 *    networks, checked at connect time (DNS rebinding can't sneak past).
 *  - Redirects are NOT followed: a 302 to http://169.254.169.254/ would
 *    otherwise walk around the first check. A 3xx counts as a failure.
 *  - 10 seconds, and only the first 1 KB of the answer is read and kept.
 */

export const TIMEOUT_MS = 10_000;
const KEEP_BYTES = 1024;

export type HttpResult = { status: number; body: string; ms: number };

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean, lookup?: ReturnType<typeof publicOnlyLookup>): Agent {
  if (lookup) return new Agent({ connect: { lookup } }); // tests pass their own resolver
  let agent = agents.get(allowPrivate);
  if (!agent) {
    agent = new Agent(allowPrivate ? {} : { connect: { lookup: publicOnlyLookup() } });
    agents.set(allowPrivate, agent);
  }
  return agent;
}

async function readSome(body: import("node:stream/web").ReadableStream | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < KEEP_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value as Uint8Array;
      chunks.push(chunk);
      size += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, KEEP_BYTES).toString("utf8");
}

export async function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: { allowPrivate?: boolean; lookup?: ReturnType<typeof publicOnlyLookup>; timeoutMs?: number } = {},
): Promise<HttpResult> {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "MeetReady-Webhooks/1.0", ...headers },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    dispatcher: agentFor(Boolean(options.allowPrivate), options.lookup),
  });
  const text = await readSome(response.body);
  return { status: response.status, body: text, ms: Math.round(performance.now() - started) };
}
