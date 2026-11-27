import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pickHost, type HostLoad } from "./round-robin";

const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T10:00:00Z`);
const load = (id: string, position: number, recent: number, last: Date | null = null): HostLoad => ({
  id,
  position,
  recent,
  lastAssignedAt: last,
});

describe("pickHost (Day 31)", () => {
  it("nobody free: nobody", () => {
    expect(pickHost([])).toBeNull();
  });

  it("the fewest recent bookings wins, whatever the list order", () => {
    expect(pickHost([load("ada", 0, 3), load("grace", 1, 1), load("linus", 2, 2)])).toBe("grace");
  });

  it("a tie goes to whoever was assigned longest ago, and never-assigned comes first", () => {
    expect(pickHost([load("ada", 0, 1, at(20)), load("grace", 1, 1, at(10))])).toBe("grace");
    expect(pickHost([load("ada", 0, 0, at(1)), load("grace", 1, 0, null)])).toBe("grace");
  });

  it("then the host list's order, then the id: never random", () => {
    expect(pickHost([load("grace", 1, 0), load("ada", 0, 0)])).toBe("ada");
    expect(pickHost([load("b", 0, 0), load("a", 0, 0)])).toBe("a");
  });

  const candidate = fc.record({
    id: fc.string({ minLength: 1, maxLength: 4 }),
    position: fc.integer({ min: 0, max: 19 }),
    recent: fc.integer({ min: 0, max: 50 }),
    lastAssignedAt: fc.option(
      fc.integer({ min: 0, max: 60 }).map((d) => new Date(Date.UTC(2026, 9, 1 + d))),
      { nil: null },
    ),
  });
  const candidates = fc.uniqueArray(candidate, { selector: (c) => c.id, minLength: 1, maxLength: 20 });

  it("property: always one of the candidates, with the fewest recent bookings", () => {
    fc.assert(
      fc.property(candidates, (cs) => {
        const id = pickHost(cs);
        const chosen = cs.find((c) => c.id === id);
        expect(chosen).toBeDefined();
        expect(chosen!.recent).toBe(Math.min(...cs.map((c) => c.recent)));
      }),
    );
  });

  it("property: the order of the input never changes the answer", () => {
    fc.assert(
      fc.property(candidates, fc.integer(), (cs, seed) => {
        const shuffled = [...cs].sort(
          (a, b) => ((a.id.charCodeAt(0) * seed) % 7) - ((b.id.charCodeAt(0) * seed) % 7),
        );
        expect(pickHost(shuffled)).toBe(pickHost(cs));
      }),
    );
  });
});
