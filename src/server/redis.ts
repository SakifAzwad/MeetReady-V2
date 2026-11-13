import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

/*
 * One Upstash client per server instance, shared by rate limiting (Day 14)
 * and the calendar busy-times cache (Day 15). Null when the variables aren't
 * set (local dev, tests): each feature then uses its in-memory fallback.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client === undefined) client = env.REDIS ? new Redis({ ...env.REDIS, enableTelemetry: false }) : null;
  return client;
}

/** Production and previews may share one Redis: every key starts with the environment. */
export const redisPrefix = `meetready:${process.env.VERCEL_ENV ?? env.NODE_ENV}`;
