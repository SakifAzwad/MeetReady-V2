import type { Redis } from "@upstash/redis";
import type { Interval } from "@/lib/scheduling/intervals";

/*
 * A short cache of a host's busy times, so the booking page doesn't call
 * Google on every load (and every month flipped).
 *
 * Two ages matter (see busy.ts):
 *  - FRESH (1 minute): served without asking Google. A new event in the
 *    host's calendar shows on the booking page within a minute.
 *  - STALE (up to 1 hour): served only when Google is failing, so the page can
 *    still show times. Booking itself never uses the cache: it asks Google live.
 *
 * Only start/end times are stored, never anything about the events. The cache
 * is an optimisation: if it fails, it's skipped, never an error for the guest.
 */

export const FRESH_MS = 60_000;
export const STALE_MS = 60 * 60_000;

export type CachedBusy = { fetchedAt: number; busy: Interval[] };

export type BusyCache = {
  get(key: string): Promise<CachedBusy | null>;
  set(key: string, value: CachedBusy): Promise<void>;
  /** Drops every entry for one host (on connect and disconnect). */
  clearHost(hostId: string): Promise<void>;
};

export const cacheKey = (hostId: string, range: Interval) =>
  `${hostId}:${range.start.toISOString()}:${range.end.toISOString()}`;

/** Local dev and tests: a Map that forgets entries after STALE_MS. */
export function createMemoryBusyCache(now: () => number = Date.now): BusyCache {
  const entries = new Map<string, CachedBusy>();
  return {
    async get(key) {
      const hit = entries.get(key);
      if (hit && now() - hit.fetchedAt > STALE_MS) {
        entries.delete(key);
        return null;
      }
      return hit ?? null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
    async clearHost(hostId) {
      for (const key of entries.keys()) if (key.startsWith(`${hostId}:`)) entries.delete(key);
    },
  };
}

type Stored = { fetchedAt: number; busy: { start: string; end: string }[] };

/**
 * Production: Upstash Redis, shared by every instance. Each host's entries
 * live in one Redis hash, so a disconnect can drop them all with one DEL;
 * the hash expires an hour after its last write.
 */
export function createRedisBusyCache(redis: Redis, prefix: string): BusyCache {
  const hashKey = (hostId: string) => `${prefix}:busy:${hostId}`;
  const split = (key: string) => {
    const i = key.indexOf(":");
    return { hostId: key.slice(0, i), field: key.slice(i + 1) };
  };
  return {
    async get(key) {
      const { hostId, field } = split(key);
      const stored = await redis.hget<Stored>(hashKey(hostId), field);
      if (!stored) return null;
      return {
        fetchedAt: stored.fetchedAt,
        busy: stored.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
      };
    },
    async set(key, value) {
      const { hostId, field } = split(key);
      const stored: Stored = {
        fetchedAt: value.fetchedAt,
        busy: value.busy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
      };
      const pipeline = redis.pipeline();
      pipeline.hset(hashKey(hostId), { [field]: stored });
      pipeline.pexpire(hashKey(hostId), STALE_MS);
      await pipeline.exec();
    },
    async clearHost(hostId) {
      await redis.del(hashKey(hostId));
    },
  };
}
