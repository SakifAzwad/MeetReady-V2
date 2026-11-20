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
