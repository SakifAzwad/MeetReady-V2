import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Database } from "@/db/types";

/**
 * A fresh, fully migrated Postgres per call (PGlite: real Postgres compiled to
 * WASM, in-process). Same migrations as production, so tests exercise the
 * real constraints.
 */
export async function createTestDb(): Promise<Database> {
  const client = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client, schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as Database;
}
