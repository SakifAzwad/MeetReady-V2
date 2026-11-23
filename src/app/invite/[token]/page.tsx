import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { inviteTokenSchema } from "@/lib/validation/team";
import { requireUser } from "@/server/auth/session";
import { previewInvite, roleIn, type InviteState } from "@/server/teams";
import { JoinButton } from "./join-button";

/*
 * Day 28: /invite/{token}, the link a team owner copies and sends. proxy.ts
 * sends a signed-out visitor to log in first and back here after; someone
 * with no username yet goes through onboarding and comes back too.
 *
 * Opening it changes nothing (see joinTeamAction): it says which team, who
 * invited, and what joining means, then the person presses Join.
 *  - no-referrer: the token is in the URL; a click from here must not send it
 *    to another site.
 *  - noindex: never in search results.
 */
export const metadata: Metadata = {
  title: "Join a team",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="flex flex-1 flex-col px-6 py-8 sm:px-12">
      <Link href="/" aria-label="MeetReady home" className="self-start rounded-md">
        <Logo />
      </Link>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-16">
        <Suspense fallback={<div className="bg-muted h-48 animate-pulse rounded-xl" />}>
          <Invite params={params} />
        </Suspense>
      </div>
    </main>
  );
}

const ENDED: Record<Exclude<InviteState, "open">, string> = {
  used: "Someone has already joined with this link. Invite links work once: ask whoever sent it for a new one.",
  revoked: "This invite link was cancelled. Ask whoever sent it for a new one.",
  expired: "This invite link has expired: links last 7 days. Ask whoever sent it for a new one.",
};

async function Invite({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  const user = await requireUser();
  const valid = inviteTokenSchema.safeParse(token).success;
  // A new account picks its username first, then comes back here. (Only a valid token goes into the URL.)
  if (!user.username) redirect(valid ? `/onboarding?next=/invite/${token}` : "/onboarding");

  const invite = valid ? await previewInvite(db, token, new Date()) : null;
  if (!invite) {
    return (
      <Ended
        heading="This invite link doesn't work"
        text="Check you copied the whole link, or ask for a new one."
      />
    );
  }
  if (await roleIn(db, user.id, invite.teamId)) {
    return (
      <>
        <h1 className="text-3xl font-bold">You&apos;re already in {invite.teamName}</h1>
        <Button asChild className="self-start">
          <Link href={`/dashboard/teams/${invite.teamId}`}>Open the team</Link>
        </Button>
      </>
    );
  }
  if (invite.state !== "open")
    return <Ended heading="This invite link has ended" text={ENDED[invite.state]} />;

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Team invite</p>
        <h1 className="text-3xl font-bold">
          {invite.invitedBy
            ? `${invite.invitedBy} invited you to join ${invite.teamName}`
            : `Join ${invite.teamName}`}
        </h1>
      </div>
      <p className="text-muted-foreground leading-relaxed">
        You&apos;ll join as {user.name} ({user.email}). Everyone in the team will see your name, email address
        and picture, and you&apos;ll see theirs. You can leave the team at any time.
      </p>
      <JoinButton token={token} teamName={invite.teamName} />
    </>
  );
}

function Ended({ heading, text }: { heading: string; text: string }) {
  return (
    <>
      <h1 className="text-3xl font-bold">{heading}</h1>
      <p className="text-muted-foreground leading-relaxed">{text}</p>
      <Button asChild variant="outline" className="self-start">
        <Link href="/dashboard">Go to your dashboard</Link>
      </Button>
    </>
  );
}
