import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { db } from "@/db";
import { OAUTH_SCOPES, SCOPE_DESCRIPTIONS } from "@/lib/mcp";
import { getSession } from "@/server/auth/session";
import { getConsentClient } from "@/server/mcp/clients";
import { ConsentButtons } from "./consent-buttons";

export const metadata: Metadata = { title: "Connect an assistant", robots: { index: false } };

/*
 * Day 21: an AI assistant (Claude, ChatGPT) asks to use the host's MeetReady.
 * Better Auth sends the host here after sign-in, with a SIGNED copy of the
 * assistant's request in the URL (client_id, scope, redirect_uri, sig, …).
 * This page only displays it; the buttons send it back to Better Auth, which
 * checks the signature before anything is granted. Editing the URL here
 * (another scope, another client) breaks the signature.
 *
 * What the host must be able to judge: who is asking (a CIMD client's domain
 * is verified, its name is not), what it may do (scopes in plain words), and
 * which MeetReady account it gets.
 */
export default function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-10 sm:py-16">
      <Link href="/" aria-label="MeetReady home" className="mb-10 rounded-md">
        <Logo />
      </Link>
      <div className="bg-card w-full max-w-md rounded-2xl border p-6 shadow-[0_1px_2px_rgb(24_33_58/0.05),0_12px_40px_rgb(24_33_58/0.07)] sm:p-8">
        <Suspense fallback={<div className="bg-muted h-72 animate-pulse rounded-lg" />}>
          <ConsentRequest searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function ConsentRequest({ searchParams }: Pick<PageProps<"/oauth/consent">, "searchParams">) {
  const params = await searchParams;
  const clientId = typeof params.client_id === "string" ? params.client_id : null;
  const requested = typeof params.scope === "string" ? params.scope.split(" ").filter(Boolean) : [];
  const [session, client] = await Promise.all([
    getSession(),
    clientId ? getConsentClient(db, clientId) : Promise.resolve(null),
  ]);

  if (!session || !client || typeof params.sig !== "string") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">This request isn&apos;t valid any more</h1>
        <p className="text-muted-foreground">
          It may have expired (requests last 10 minutes) or been opened in another browser. Start again from
          your assistant: for example, reconnect MeetReady in Claude&apos;s connector settings.
        </p>
      </div>
    );
  }

  // Only scopes we know, in our order. The server rejects anything else anyway.
  const scopes = OAUTH_SCOPES.filter((s) => requested.includes(s));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{client.name} wants to use your MeetReady account</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {client.verifiedHost ? (
            <>
              Requested by <strong className="text-foreground">{client.verifiedHost}</strong>.
            </>
          ) : (
            <>
              This app registered itself, so its name isn&apos;t verified. Only allow it if you started this.
            </>
          )}{" "}
          Signed in as {session.user.email}.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-medium">It will be able to</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {scopes.map((scope) => (
            <li key={scope} className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
              {SCOPE_DESCRIPTIONS[scope]}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          What it reads goes to that assistant&apos;s provider, under their terms. You can disconnect it at
          any time on your dashboard.
        </p>
      </div>

      {!session.user.username && (
        <p className="bg-muted rounded-md px-3 py-2 text-sm">
          You haven&apos;t picked your booking link yet, so there&apos;s nothing for it to see.{" "}
          <Link href="/onboarding" className="underline underline-offset-4">
            Set it up first
          </Link>
          , then connect again.
        </p>
      )}

      <ConsentButtons clientName={client.name} />
    </div>
  );
}
