import "server-only";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";
import type { Database } from "./types";

/*
 * Production: Neon's serverless driver over WebSockets (not neon-http),
 * because booking needs real interactive transactions (check
 * max-bookings-per-day, then insert, atomically). neon-http only does
 * one-shot queries.
 *
 * A Postgres on localhost (Docker, a CI service container, a local test
 * server) doesn't speak Neon's WebSocket protocol, so it gets the standard
 * `pg` driver. Same Drizzle API either way; nothing else in the app changes.
 */
const isLocal = ["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname);

export const db: Database = isLocal
  ? drizzleNodePg({
      client: new PgPool({ connectionString: env.DATABASE_URL }),
      schema,
      casing: "snake_case",
    })
  : drizzleNeon({
      client: new NeonPool({ connectionString: env.DATABASE_URL }),
      schema,
      casing: "snake_case",
    });
