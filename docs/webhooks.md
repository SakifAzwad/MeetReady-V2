# Webhooks: receiving MeetReady's events

MeetReady can POST to your server when a booking is made, moved or cancelled. Add an endpoint on **Dashboard →
account menu → Webhooks**. Every request is signed in the [Standard Webhooks](https://www.standardwebhooks.com)
format, so you can verify it with an existing library or with the few lines below.

## Events

| `type`                | When                                                           |
| --------------------- | -------------------------------------------------------------- |
| `booking.created`     | A guest booked, or you booked through an assistant             |
| `booking.rescheduled` | The guest or you moved it (`data.previousStartsAt` is the old) |
| `booking.cancelled`   | The guest or you cancelled it                                  |
| `ping`                | **Send test** on the Webhooks page                             |

```json
{
  "type": "booking.created",
  "timestamp": "2026-11-21T10:00:00.000Z",
  "data": {
    "bookingId": "6f1c…",
    "status": "confirmed",
    "startsAt": "2026-11-26T08:00:00.000Z",
    "endsAt": "2026-11-26T08:30:00.000Z",
    "timeZone": "Asia/Dhaka",
    "meetingType": { "slug": "intro", "title": "Intro call", "durationMinutes": 30 },
    "location": "Google Meet",
    "meetUrl": "https://meet.google.com/abc-defg-hij",
    "guest": { "name": "Ada Lovelace", "email": "ada@example.com", "timeZone": "Europe/London" },
    "changedBy": "guest",
    "throughAssistant": false
  }
}
```

Times are UTC; `timeZone` is the host's (for a team meeting, the organizer's). The guest's notes, answers and any
cancellation reason are never sent.

**Team meetings:** each host's endpoints get the same event, as their own delivery (Day 30). `changedBy: "host"`
means one of the hosts made the change, not necessarily the owner of the endpoint.

## Headers

| Header              | What it is                                                                      |
| ------------------- | ------------------------------------------------------------------------------- |
| `webhook-id`        | `msg_…`, the same on every retry of one message: drop duplicates by it          |
| `webhook-timestamp` | Seconds since 1970, new on every try: reject anything older than 5 minutes      |
| `webhook-signature` | `v1,<base64>`; two of them, space-separated, for 24 hours after a secret change |

The signature is HMAC-SHA256 over `` `${id}.${timestamp}.${body}` ``, keyed with the base64-decoded part of your
secret after `whsec_`. Use the raw request body, before any JSON parsing.

## Verify (Node, no dependencies)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, headers, rawBody) {
  const id = headers["webhook-id"];
  const ts = Number(headers["webhook-timestamp"]);
  if (!id || Math.abs(Date.now() / 1000 - ts) > 300) return false; // too old: a replay
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(
    `v1,${createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64")}`,
  );
  return headers["webhook-signature"].split(" ").some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

Or the official `standardwebhooks` package: `new Webhook(secret).verify(rawBody, headers)`.

## Answering

- Reply with any **2xx** within **10 seconds**. Do slow work after replying.
- **5xx, 408, 429 or no answer:** MeetReady tries again with growing gaps, 8 times over a few hours, with the same
  `webhook-id` and body. After that the delivery is marked failed; **Retry** on the Webhooks page sends it again.
- **Other 4xx:** not retried (it won't change by itself). **Redirects aren't followed:** use the final URL.

## Rules for the URL

`https://` on port 443, a public address (no `localhost`, private networks or cloud metadata addresses), no
username or password in it. The address is checked when you save it and again on every delivery, at the moment of
connecting.
