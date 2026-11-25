import { describe, expect, it } from "vitest";
import { cancelledLabel, movedLabel } from "./booking-labels";

const base = {
  status: "confirmed" as "confirmed" | "cancelled",
  cancelledBy: null as "host" | "guest" | null,
  cancellationReason: null as string | null,
  rescheduledAt: null as Date | null,
  rescheduledBy: null as "host" | "guest" | null,
  changedByClient: null as string | null,
  changeAssistantName: null as string | null,
};
const MOVED = new Date("2026-11-19T00:00:00Z");

describe("Bookings page labels (Day 24)", () => {
  it("says who moved it, and through which assistant", () => {
    expect(movedLabel(base)).toBeNull();
    expect(movedLabel({ ...base, rescheduledAt: MOVED })).toBe("Moved by guest"); // before Day 24: guests only
    expect(movedLabel({ ...base, rescheduledAt: MOVED, rescheduledBy: "guest" })).toBe("Moved by guest");
    expect(
      movedLabel({
        ...base,
        rescheduledAt: MOVED,
        rescheduledBy: "host",
        changedByClient: "c",
        changeAssistantName: "Claude",
      }),
    ).toBe("Moved by you through Claude");
    // The assistant's client was removed since: still says an assistant did it.
    expect(movedLabel({ ...base, rescheduledAt: MOVED, rescheduledBy: "host", changedByClient: "c" })).toBe(
      "Moved by you through an AI assistant",
    );
  });

  it("on a cancelled booking, the assistant belongs to the cancel, not the earlier move", () => {
    const b = {
      ...base,
      status: "cancelled" as const,
      cancelledBy: "host" as const,
      cancellationReason: "Clash",
      rescheduledAt: MOVED,
      rescheduledBy: "host" as const,
      changedByClient: "c",
      changeAssistantName: "Claude",
    };
    expect(cancelledLabel(b)).toBe("Cancelled by you through Claude: Clash");
    expect(movedLabel(b)).toBe("Moved by you");
  });

  it("cancels by hand or by the guest", () => {
    expect(cancelledLabel(base)).toBeNull();
    expect(cancelledLabel({ ...base, status: "cancelled", cancelledBy: "host" })).toBe("Cancelled by you");
    expect(
      cancelledLabel({ ...base, status: "cancelled", cancelledBy: "guest", cancellationReason: "Ill" }),
    ).toBe("Cancelled by guest: Ill");
  });
});

describe("team meetings (Day 30): 'you' only to the host who did it", () => {
  const team = {
    ...base,
    hostId: "ada",
    team: { name: "Acme" },
    rescheduledAt: MOVED,
    rescheduledBy: "host" as const,
    changedByHostId: "grace",
    changedByHostName: "Grace Hopper",
  };

  it("names the host who moved or cancelled it to everyone else", () => {
    expect(movedLabel(team, "grace")).toBe("Moved by you");
    expect(movedLabel(team, "ada")).toBe("Moved by Grace");
    const cancelled = { ...team, status: "cancelled" as const, cancelledBy: "host" as const };
    expect(cancelledLabel(cancelled, "ada")).toBe("Cancelled by Grace");
    expect(cancelledLabel({ ...cancelled, changedByClient: "c" }, "ada")).toBe(
      "Cancelled by Grace through an AI assistant",
    );
  });

  it("a host change from before Day 30 (no host recorded) was the organizer's", () => {
    const old = { ...team, changedByHostId: null, changedByHostName: null };
    expect(movedLabel(old, "ada")).toBe("Moved by you");
    expect(movedLabel(old, "grace")).toBe("Moved by another host");
    const withHosts = { ...old, hosts: [{ id: "ada", name: "Ada Lovelace" }] };
    expect(movedLabel(withHosts, "grace")).toBe("Moved by Ada");
  });

  it("on a cancelled team meeting, the columns describe the cancel: the mover is just 'a host'", () => {
    const cancelled = { ...team, status: "cancelled" as const, cancelledBy: "guest" as const };
    expect(movedLabel(cancelled, "ada")).toBe("Moved by a host");
    expect(cancelledLabel(cancelled, "ada")).toBe("Cancelled by guest");
  });
});
