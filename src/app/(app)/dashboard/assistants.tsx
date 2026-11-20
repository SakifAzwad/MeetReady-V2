import { Card } from "@/components/ui/card";
import { formatDateKey } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { MCP_SCOPES } from "@/lib/mcp";
import type { ConnectedAssistant } from "@/server/mcp/clients";
import { CopyLinkButton } from "./copy-link-button";
import { DisconnectButton } from "./disconnect-button";

/**
 * Day 21: connect Claude or ChatGPT to MeetReady (the MCP server), and see or
 * disconnect what's connected. The address is all an assistant needs: it finds
 * the sign-in and consent steps itself from there.
 */
export function AssistantsSection({
  mcpUrl,
  assistants,
  timeZone,
}: {
  mcpUrl: string;
  assistants: ConnectedAssistant[];
  timeZone: string;
}) {
  return (
    <section aria-labelledby="assistants-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="assistants-heading" className="text-xl font-semibold">
          AI assistants
        </h2>
        <p className="text-muted-foreground text-sm">
          Let Claude or ChatGPT see your meeting types, free times and bookings. In Claude, open Connectors
          (under Customize or Settings), choose Add custom connector and paste this address. You&apos;ll sign
          in and approve it here.
        </p>
      </div>
      <Card className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">MCP server address</p>
          <p className="font-display truncate text-lg font-semibold">{mcpUrl}</p>
        </div>
        <div className="shrink-0">
          <CopyLinkButton url={mcpUrl} label="Copy address" />
        </div>
      </Card>

      {assistants.length === 0 ? (
        <p className="text-muted-foreground text-sm">No assistant connected yet.</p>
      ) : (
        <ul aria-label="Connected assistants" className="bg-card divide-y rounded-xl border">
          {assistants.map((a) => (
            <li
              key={a.clientId}
              className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {a.name}
                  {a.verifiedHost && a.verifiedHost !== a.name && (
                    <span className="text-muted-foreground font-normal"> ({a.verifiedHost})</span>
                  )}
                </p>
                <p className="text-muted-foreground text-sm">
                  {a.scopes.includes(MCP_SCOPES.write) ? "Can read, book and change bookings" : "Can read"}.
                  Connected {formatDateKey(dateKeyInZone(a.connectedAt, timeZone), "short")}.
                </p>
              </div>
              <DisconnectButton clientId={a.clientId} name={a.name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
