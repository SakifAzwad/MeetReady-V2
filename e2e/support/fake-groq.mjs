/*
 * A fake Groq for the E2E tests (Day 20), so CI never calls a real model. The
 * app talks to it through GROQ_BASE_URL (set in playwright.config.ts). It
 * speaks the part of Groq's OpenAI-style API the AI SDK uses:
 * POST /openai/v1/chat/completions, no streaming. Plain Node, no dependencies.
 *
 * It plays a script, like mockModelSteps in the unit tests, but over HTTP:
 *   POST /__fake/groq/script  { marker, search, reply, fail, delayMs }
 *     marker: a unique string the test puts in the guest's message. Tests run in
 *             parallel, so scripts are found by marker (like the fake Google's tokens).
 *     search: the findTimes arguments the "model" sends first ({from, to, earliest,
 *             latest, timeZone}), or null for no search.
 *     reply:  the text it answers with once the tool's result comes back.
 *     fail:   answer every request with a 500, like an outage.
 *     delayMs: wait this long before each answer, like a slow model (Day 20: Clear while waiting).
 *   GET  /__fake/groq/calls?marker=…   how many requests carried that marker
 *
 * The tool itself is NOT faked: the app runs findTimes over its real slot
 * function and real database. Only the model's words are scripted.
 *
 * Requests with a JSON schema (the meeting brief, Day 18) get a fixed, valid
 * brief, so every booking with notes in any test goes through the real brief
 * job too. An assistant request with no script gets a 500: a test that forgot
 * its script fails loudly instead of passing on a default.
 */
import http from "node:http";

const port = Number(process.env.FAKE_GROQ_PORT ?? 3102);
const scripts = new Map(); // marker -> { search, reply, fail }
const calls = new Map(); // marker -> number of requests

// e2e/brief.spec.ts looks for this summary on the Bookings page.
const FAKE_BRIEF = {
  summary: "The guest wants a short intro call to talk about working together.",
  agenda: ["Introductions", "What the guest needs", "Next steps"],
  prepare: [],
};

const body = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const send = (res, status, json) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
};

/** A chat completion as Groq returns it: one choice, with usage so ai_calls gets token counts. */
const completion = (message, finishReason) => ({
  id: `chatcmpl-fake-${Date.now()}`,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: "fake-groq",
  choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
});

const outage = { error: { message: "Fake outage", type: "internal_server_error" } };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/__fake/health") return send(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/__fake/groq/script") {
      const { marker, search = null, reply = "", fail = false, delayMs = 0 } = JSON.parse(await body(req));
      scripts.set(marker, { search, reply, fail, delayMs });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__fake/groq/calls") {
      return send(res, 200, { calls: calls.get(url.searchParams.get("marker")) ?? 0 });
    }

    if (req.method === "POST" && url.pathname === "/openai/v1/chat/completions") {
      if (!(req.headers.authorization ?? "").startsWith("Bearer ")) {
        return send(res, 401, { error: { message: "No API key", type: "invalid_api_key" } });
      }
      const raw = await body(req);
      const request = JSON.parse(raw);

      // The meeting brief: structured output, no tools.
      if (request.response_format?.type === "json_schema") {
        return send(res, 200, completion({ content: JSON.stringify(FAKE_BRIEF) }, "stop"));
      }

      // The booking assistant: find this test's script by its marker anywhere in the request.
      const marker = [...scripts.keys()].find((m) => raw.includes(m));
      if (!marker)
        return send(res, 500, { error: { message: "No script for this request", type: "server_error" } });
      calls.set(marker, (calls.get(marker) ?? 0) + 1);
      const script = scripts.get(marker);
      if (script.delayMs) await new Promise((resolve) => setTimeout(resolve, script.delayMs));
      if (script.fail) return send(res, 500, outage);

      // First the search; once the tool's answer is in the conversation, the reply.
      const searched = request.messages.some((m) => m.role === "tool");
      if (script.search && !searched) {
        return send(
          res,
          200,
          completion(
            {
              content: null,
              tool_calls: [
                {
                  id: `call_${calls.get(marker)}`,
                  type: "function",
                  function: { name: "findTimes", arguments: JSON.stringify(script.search) },
                },
              ],
            },
            "tool_calls",
          ),
        );
      }
      return send(res, 200, completion({ content: script.reply }, "stop"));
    }

    send(res, 404, { error: { message: "not found", type: "not_found_error" } });
  })
  .listen(port);
