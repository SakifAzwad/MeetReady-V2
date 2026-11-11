/*
 * Applies pending migrations (drizzle/*.sql). Vercel runs it before
 * `next build` (see the vercel-build script and vercel.json), so a deploy
 * never serves code whose tables don't exist yet.
 *
 * - Production builds migrate the production database. Preview builds get
 *   their own Neon branch from the Neon-Vercel integration (its own
 *   DATABASE_URL), so a preview's migrations never touch production.
 * - The DIRECT connection, not the pooled one: Neon's pooler (PgBouncer in
 *   transaction mode) can hand each statement of a migration to a different
 *   server connection, which breaks the session-level lock below.
 * - An advisory lock, so two builds starting at once can't both apply the
 *   same migration.
 *
 * Migrations must be additive (expand, then contract later): for a moment the
 * OLD code still runs against the NEW schema, until the new build goes live.
 *
 * Run with Node's built-in TypeScript support (Node 22.18+).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("migrate: set DATABASE_URL (or DATABASE_URL_UNPOOLED)");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // Any constant works as the key, as long as every migrator uses the same one.
  await client.query("select pg_advisory_lock(hashtext('meetready:migrations'))");
  await migrate(drizzle({ client }), { migrationsFolder: "./drizzle" });
  console.warn(`[migrate] up to date (${new URL(url).hostname})`);
} finally {
  await client.end(); // ending the session releases the lock
}
