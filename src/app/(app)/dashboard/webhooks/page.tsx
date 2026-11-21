import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTransition } from "@/components/motion";
import { Badge, Card } from "@/components/ui/card";
import { db } from "@/db";
import { formatDateKey, formatTime } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { REPO_URL } from "@/lib/site";
import { requireOnboardedUser } from "@/server/auth/session";
import { listEndpoints, MAX_ENDPOINTS, recentDeliveries } from "@/server/webhooks/endpoints";
import { AddEndpointForm, EndpointActions, RetryButton } from "./controls";

export const metadata: Metadata = { title: "Webhooks" };

/*
 * Day 26: a host's webhook endpoints and what was sent to them. Linked from
 * the account menu (a developer setting, not a daily page).
 */
export default function WebhooksPage() {
  return (
    <PageTransition>
      <main className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Webhooks</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            MeetReady sends a signed POST to your URL when a booking is made, moved or cancelled, for tools
            like Zapier, Slack or a CRM. Each request carries a <code>webhook-signature</code> header in the
            Standard Webhooks format.{" "}
            <a
              href={`${REPO_URL}/blob/main/docs/webhooks.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              How to check it
            </a>
          </p>
        </div>
        <Suspense fallback={<div className="bg-muted h-64 animate-pulse rounded-xl" />}>
          <WebhooksBody />
        </Suspense>
      </main>
    </PageTransition>
  );
}

const EVENT_LABELS: Record<string, string> = {
  "booking.created": "Booked",
  "booking.rescheduled": "Moved",
  "booking.cancelled": "Cancelled",
  ping: "Test",
};
const STATUS_LABELS = { pending: "Sending", delivered: "Delivered", failed: "Failed" } as const;

async function WebhooksBody() {
  const user = await requireOnboardedUser();
  const [endpoints, deliveries] = await Promise.all([
    listEndpoints(db, user.id),
    recentDeliveries(db, user.id), // both scoped to this host
  ]);
  const tz = user.timeZone;
  const when = (d: Date) => `${formatDateKey(dateKeyInZone(d, tz), "short")}, ${formatTime(d, tz)}`;
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-4 p-5" role="region" aria-label="Add an endpoint">
        <h2 className="font-semibold">Add an endpoint</h2>
        <AddEndpointForm full={endpoints.length >= MAX_ENDPOINTS} />
      </Card>

      <section aria-labelledby="endpoints-heading" className="flex flex-col gap-3">
        <h2 id="endpoints-heading" className="text-xl font-semibold">
          Endpoints
        </h2>
        {endpoints.length === 0 ? (
          <p className="text-muted-foreground text-sm">No endpoints yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {endpoints.map((e) => {
              const last = deliveries.find((d) => d.endpointId === e.id);
              return (
                <li key={e.id}>
                  <Card className="gap-3 p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="min-w-0 font-medium break-all">{e.url}</p>
                      {last && (
                        <Badge className={last.status === "failed" ? "border-destructive/40" : undefined}>
                          {last.status === "failed"
                            ? "Last delivery failed"
                            : `Last: ${STATUS_LABELS[last.status]}`}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Sends: {e.events.map((x) => EVENT_LABELS[x]).join(", ")}. Added {when(e.createdAt)}.
                      {e.rotatingUntil &&
                        e.rotatingUntil > now &&
                        ` The old secret also signs until ${when(e.rotatingUntil)}.`}
                    </p>
                    <EndpointActions id={e.id} url={e.url} />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="deliveries-heading" className="flex flex-col gap-3">
        <h2 id="deliveries-heading" className="text-xl font-semibold">
          Recent deliveries
        </h2>
        <p className="text-muted-foreground -mt-2 text-sm">
          The last 20, kept for 30 days. Failed ones are tried again over a few hours; after that, Retry.
        </p>
        {deliveries.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing sent yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deliveries.map((d) => (
              <li key={d.id}>
                <Card className="gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{EVENT_LABELS[d.event] ?? d.event}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        to {new URL(d.url).host}, {when(d.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge className={d.status === "failed" ? "border-destructive/40" : undefined}>
                        {STATUS_LABELS[d.status]}
                        {d.lastStatusCode ? ` (${d.lastStatusCode})` : ""}
                      </Badge>
                      {d.status === "failed" && <RetryButton id={d.id} />}
                    </span>
                  </div>
                  {(d.lastError || d.attempts > 1) && (
                    <p className="text-muted-foreground text-xs">
                      {d.attempts} {d.attempts === 1 ? "try" : "tries"}
                      {d.lastError && `. ${d.lastError}`}
                    </p>
                  )}
                  <details className="text-xs">
                    <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer">
                      What was sent
                    </summary>
                    <pre className="bg-muted mt-2 overflow-x-auto rounded p-3">
                      {JSON.stringify(d.payload, null, 2)}
                    </pre>
                    <p className="text-muted-foreground mt-1">webhook-id: {d.id}</p>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
