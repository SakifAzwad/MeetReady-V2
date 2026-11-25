/*
 * The Bookings page's labels for who changed a booking (Day 24), as plain
 * functions so the rules are tested without rendering the page.
 *
 * `changedByClient` names the assistant behind the LATEST cancel or move only.
 * So on a cancelled booking it describes the cancel, and the "moved" label
 * doesn't borrow it; on a confirmed booking the latest change can only be a
 * move (a booking can't be un-cancelled).
 *
 * Day 30: a team meeting has several hosts, and any of them may change it.
 * `changedByHostId` says which one made the latest change, so the label says
 * "you" only to that person and names them to everyone else ("Moved by
 * Grace"). Null on a host change from before Day 30 means the organizer.
 */

type ChangeFields = {
  status: "confirmed" | "cancelled";
  cancelledBy: "host" | "guest" | null;
  cancellationReason: string | null;
  rescheduledAt: Date | null;
  rescheduledBy: "host" | "guest" | null;
  changedByClient: string | null;
  changeAssistantName: string | null;
  /** Day 30. Left out (old callers, tests): the viewer is the only host, so "you". */
  hostId?: string;
  team?: unknown;
  changedByHostId?: string | null;
  changedByHostName?: string | null;
  /** A team meeting's hosts, to name the organizer of a change from before Day 30. */
  hosts?: { id: string; name: string }[];
};

const assistant = (b: ChangeFields) => b.changeAssistantName ?? "an AI assistant";

/** The host behind the latest change, as the viewer reads it: "you", or their first name. */
function latestHost(b: ChangeFields, viewerId: string | undefined): string {
  const id = b.changedByHostId ?? b.hostId;
  if (!viewerId || !id || id === viewerId) return "you";
  const name = b.changedByHostName ?? b.hosts?.find((h) => h.id === id)?.name;
  return name?.split(" ")[0] || "another host";
}

/** "Moved by you through Claude", "Moved by you", "Moved by Grace", "Moved by guest", or null when never moved. */
export function movedLabel(b: ChangeFields, viewerId?: string): string | null {
  if (!b.rescheduledAt) return null;
  // Before Day 24 only guests could move a meeting, so a move with no `rescheduledBy` was theirs.
  if (b.rescheduledBy !== "host") return "Moved by guest";
  // On a cancelled booking the "latest change" columns describe the cancel, not the move: for a team
  // meeting we no longer know which host moved it.
  if (b.status !== "confirmed") return b.team ? "Moved by a host" : "Moved by you";
  const who = latestHost(b, viewerId);
  return b.changedByClient ? `Moved by ${who} through ${assistant(b)}` : `Moved by ${who}`;
}

/** "Cancelled by you through Claude: reason", "Cancelled by Grace", "Cancelled by guest", or null. */
export function cancelledLabel(b: ChangeFields, viewerId?: string): string | null {
  if (b.status !== "cancelled") return null;
  const host = latestHost(b, viewerId);
  const who =
    b.cancelledBy === "host" ? (b.changedByClient ? `${host} through ${assistant(b)}` : host) : "guest";
  return `Cancelled by ${who}${b.cancellationReason ? `: ${b.cancellationReason}` : ""}`;
}
