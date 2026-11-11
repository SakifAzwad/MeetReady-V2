/*
 * Runs before `next build` (it's the first part of the webServer command in
 * playwright.config.ts): a fresh database with every migration applied.
 *
 * Why not Playwright's globalSetup? Playwright starts the webServer BEFORE
 * globalSetup runs, and the build needs a migrated database to exist.
 *
 * Run with Node's built-in TypeScript support (Node 22.18+): no build step.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
const name = url.pathname.slice(1);

// This DROPs a database. Refuse anything that isn't obviously a test database,
// so a mistyped env var can never wipe a dev or production one.
if (!/^[a-z0-9_]*e2e[a-z0-9_]*$/.test(name)) {
  throw new Error(`Refusing to reset "${name}": end-to-end database names must contain "e2e".`);
}

const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`drop database if exists ${name} with (force)`);
await admin.query(`create database ${name}`);
await admin.end();

const pool = new pg.Pool({ connectionString: url.toString() });
await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
await pool.end();
console.warn(`[e2e] fresh database "${name}" migrated`);
