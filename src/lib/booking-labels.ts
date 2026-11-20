/*
 * The Bookings page's labels for who changed a booking (Day 24), as plain
 * functions so the rules are tested without rendering the page.
 *
 * `changedByClient` names the assistant behind the LATEST cancel or move only.
 * So on a cancelled booking it describes the cancel, and the "moved" label
 * doesn't borrow it; on a confirmed booking the latest change can only be a
 * move (a booking can't be un-cancelled).
 */

type ChangeFields = {
  status: "confirmed" | "cancelled";
  cancelledBy: "host" | "guest" | null;
  cancellationReason: string | null;
  rescheduledAt: Date | null;
  rescheduledBy: "host" | "guest" | null;
  changedByClient: string | null;
  changeAssistantName: string | null;
};

const assistant = (b: ChangeFields) => b.changeAssistantName ?? "an AI assistant";

/** "Moved by you through Claude", "Moved by you", "Moved by guest", or null when never moved. */
export function movedLabel(b: ChangeFields): string | null {
  if (!b.rescheduledAt) return null;
  // Before Day 24 only guests could move a meeting, so a move with no `rescheduledBy` was theirs.
  if (b.rescheduledBy !== "host") return "Moved by guest";
  return b.status === "confirmed" && b.changedByClient
    ? `Moved by you through ${assistant(b)}`
    : "Moved by you";
}

/** "Cancelled by you through Claude: reason", "Cancelled by guest", or null when not cancelled. */
export function cancelledLabel(b: ChangeFields): string | null {
  if (b.status !== "cancelled") return null;
  const who =
    b.cancelledBy === "host" ? (b.changedByClient ? `you through ${assistant(b)}` : "you") : "guest";
  return `Cancelled by ${who}${b.cancellationReason ? `: ${b.cancellationReason}` : ""}`;
}
