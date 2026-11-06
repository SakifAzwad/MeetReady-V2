import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { env } from "@/lib/env";
import * as schema from "./schema";
import type { Database } from "./types";

/*
 * Neon's serverless driver over WebSockets (not neon-http) because booking
 * needs real interactive transactions: check max-bookings-per-day, then insert,
 * atomically. neon-http only does one-shot queries/batches.
 */
const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db: Database = drizzle({ client: pool, schema, casing: "snake_case" });
