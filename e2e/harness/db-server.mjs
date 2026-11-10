// Test harness (not part of the app): an in-memory Postgres server with the
// real migrations, one onboarded host, and a valid signed session cookie.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const SECRET = process.env.BETTER_AUTH_SECRET;
const pg = new PGlite({ extensions: { btree_gist } });
await migrate(drizzle({ client: pg }), { migrationsFolder: process.argv[2] });

const token = randomBytes(24).toString("hex");
await pg.exec(`
  insert into "user"(id, name, email, email_verified, username, time_zone)
    values ('u_sakif', 'Sakif Azwad', 'sakif@example.com', true, 'sakif', 'Asia/Dhaka'),
           ('u_other', 'Other Host', 'other@example.com', true, 'other', 'UTC');
  insert into availability_rules(user_id, day_of_week, start_time, end_time)
    select 'u_sakif', d, '09:00', '17:00' from generate_series(1,5) d;
  insert into session(id, token, user_id, expires_at)
    values ('s1', '${token}', 'u_sakif', now() + interval '7 days');
  insert into event_types(user_id, title, slug, duration_minutes)
    values ('u_other', 'Other host secret meeting', 'secret', 30);
`);
const signature = createHmac("sha256", SECRET).update(token).digest("base64");
writeFileSync("/tmp/session-cookie.txt", encodeURIComponent(`${token}.${signature}`));
const { rows } = await pg.query(`select id from event_types where user_id = 'u_other'`);
writeFileSync("/tmp/other-event-id.txt", rows[0].id);

const server = new PGLiteSocketServer({ db: pg, port: 5433, host: "127.0.0.1", maxConnections: 20 });
await server.start();
console.log("db ready on 5433");
