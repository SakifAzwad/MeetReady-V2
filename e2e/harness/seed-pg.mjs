// Fresh real-Postgres database for the browser test: migrations + a host with
// an event type + a valid signed session cookie.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const ADMIN = "postgresql://postgres@127.0.0.1:5432/postgres";
const admin = new pg.Client(ADMIN); await admin.connect();
await admin.query("drop database if exists meetready_e2e with (force)");
await admin.query("create database meetready_e2e");
await admin.end();

const pool = new pg.Pool({ connectionString: "postgresql://postgres@127.0.0.1:5432/meetready_e2e" });
await migrate(drizzle({ client: pool }), { migrationsFolder: "/home/claude/meetready/drizzle" });
const token = randomBytes(24).toString("hex");
await pool.query(`
  insert into "user"(id, name, email, email_verified, username, time_zone)
    values ('u_sakif', 'Sakif Azwad', 'sakif@example.com', true, 'sakif', 'Asia/Dhaka');
  insert into availability_rules(user_id, day_of_week, start_time, end_time)
    select 'u_sakif', d, '09:00', '17:00' from generate_series(1,5) d;
  insert into session(id, token, user_id, expires_at) values ('s1', '${token}', 'u_sakif', now() + interval '7 days');
  insert into event_types(user_id, title, slug, description, duration_minutes, location_type, location_value, minimum_notice_minutes, booking_window_days)
    values ('u_sakif', 'Intro call', 'intro', 'A quick chat about the role.', 30, 'zoom', 'https://us05web.zoom.us/j/123', 60, 60);
`);
await pool.end();
const sig = createHmac("sha256", process.env.BETTER_AUTH_SECRET).update(token).digest("base64");
writeFileSync("/tmp/session-cookie.txt", encodeURIComponent(`${token}.${sig}`));
console.log("seeded");
