import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import * as schema from "@/db/schema";
import type { Database } from "@/db/types";

/*
 * Real PostgreSQL for tests that need several connections at once (races).
 * PGlite is one in-process connection, so it can't run two transactions
 * concurrently. These tests run only when TEST_DATABASE_URL is set:
 *  - CI: a postgres service container (see .github/workflows/ci.yml)
 *  - locally: e.g. docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
 *    then TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** A fresh, migrated database per call, dropped by close(). Tests never share state. */
export async function createPostgresTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const name = `meetready_test_${randomBytes(6).toString("hex")}`;

  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 20 });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });

  return {
    db: db as unknown as Database,
    close: async () => {
      // DROP ... WITH (FORCE) terminates any connection still closing; without
      // a listener that "terminating connection" error would crash the run.
      pool.on("error", () => {});
      await pool.end();
      const cleanup = new Client({ connectionString: TEST_DATABASE_URL });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}
