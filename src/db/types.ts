import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Any Drizzle Postgres database with our schema: Neon in production, PGlite in
 * tests. Server code takes `db: Database` as a parameter instead of importing
 * the Neon client, so the same function runs against both.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
