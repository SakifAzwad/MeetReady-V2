"use client";

import { CalendarCheck2, CalendarX2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { CALENDAR_SCOPES } from "@/lib/calendar";
import { disconnectCalendarAction } from "./actions";

export type CalendarCardStatus =
  | { connected: false }
  | { connected: true; lastError: "access_lost" | "unavailable" | null; lastErrorAt: string | null };

/** Why the host was sent back here (?calendar=…), from the callback route or Better Auth's error redirect. */
export type ConnectNotice = "connected" | "missing_permission" | "no_google_account" | "error" | null;

const NOTICES: Record<Exclude<ConnectNotice, null>, { text: string; alert: boolean }> = {
  connected: {
    text: "Google Calendar connected. Busy times there now block your booking page.",
    alert: false,
  },
  missing_permission: {
    text: "Google didn't give MeetReady both calendar permissions, so nothing was connected. Try again and leave both ticked.",
    alert: true,
  },
  no_google_account: { text: "Sign in with Google first, then connect your calendar.", alert: true },
  error: {
    text: "The connection didn't finish (Google said no or the request expired). Try again.",
    alert: true,
  },
};

/**
 * Starts Google's consent screen through Better Auth's "link account" flow:
 * the same Google account, with the calendar scopes added.
 *  - access_type=offline: a refresh token, so busy times work while you're away.
 *  - prompt=consent: Google only sends a refresh token from a consent screen.
 */
function connect() {
  return authClient.linkSocial({
    provider: "google",
    scopes: [...CALENDAR_SCOPES],
    callbackURL: "/dashboard/availability/calendar-connected",
    errorCallbackURL: "/dashboard/availability?calendar=error",
    additionalParams: { access_type: "offline", prompt: "consent" },
  });
}

export function CalendarConnection({
  status,
  email,
  notice,
}: {
  status: CalendarCardStatus;
  email: string;
  notice: ConnectNotice;
}) {
  const [starting, setStarting] = useState(false);
  const [disconnecting, startDisconnect] = useTransition();
  const [failed, setFailed] = useState(false);

  async function start() {
    setStarting(true);
    setFailed(false);
    const { error } = await connect(); // on success the browser is already on its way to Google
    if (error) {
      setStarting(false);
      setFailed(true);
    }
  }

  const shown = notice ? NOTICES[notice] : null;

  return (
    <Card>
      <div className="flex items-start gap-3">
        {status.connected ? (
          <CalendarCheck2 className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
        ) : (
          <CalendarX2 className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        )}
        <div className="min-w-0">
          <CardTitle>Google Calendar</CardTitle>
          <CardDescription className="mt-1.5">
            {status.connected ? (
              <>
                Connected to the primary calendar of{" "}
                <span className="text-foreground font-medium">{email}</span>. When you&apos;re busy there,
                guests can&apos;t book you.
              </>
            ) : (
              <>
                Connect it so meetings already in your calendar block your booking page. MeetReady only sees
                when you&apos;re busy, never what the events are.
              </>
            )}
          </CardDescription>
        </div>
      </div>

      {shown && (
        <p role={shown.alert ? "alert" : "status"} className="bg-muted rounded-md px-3 py-2 text-sm">
          {shown.text}
        </p>
      )}

      {status.connected && status.lastError && (
        <div role="alert" className="border-destructive/40 rounded-md border px-3 py-2 text-sm">
          <p className="font-medium">New bookings are paused.</p>
          <p className="text-muted-foreground mt-1">
            {status.lastError === "access_lost"
              ? "MeetReady can't read your Google Calendar any more: access was removed or has expired. Reconnect it, or disconnect to take bookings without it."
              : "Google Calendar didn't answer, so new times can't be checked against it. This usually clears by itself within minutes."}
          </p>
        </div>
      )}

      {failed && (
        <p role="alert" className="text-destructive text-sm">
          Couldn&apos;t start the connection. Please try again.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {!status.connected || status.lastError === "access_lost" ? (
          <Button onClick={start} disabled={starting}>
            {starting ? "Opening Google…" : status.connected ? "Reconnect" : "Connect Google Calendar"}
          </Button>
        ) : null}
        {status.connected && (
          <Button
            variant="outline"
            disabled={disconnecting}
            onClick={() => startDisconnect(async () => void (await disconnectCalendarAction()))}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        )}
      </div>
      {!status.connected && (
        <p className="text-muted-foreground text-xs">
          Google asks for two permissions: to see when you&apos;re busy, and to add your bookings to your
          calendar. Google may warn that the app isn&apos;t verified yet.
        </p>
      )}
    </Card>
  );
}
