import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import { createTestDb } from "@/test/db";
import { createAuth, type Auth } from "./config";

/*
 * Runs the real Better Auth against our real schema on PGlite. Production uses
 * Google only; here email+password is switched on purely so the test can
 * create a user and a session without a Google round trip. What this proves:
 *  - our hand-written auth tables match what Better Auth reads and writes
 *  - the extra user fields (username, timeZone) come back on the session
 *  - users can't set username/timeZone themselves through Better Auth's API
 */

describe("Better Auth on our schema", () => {
  let db: Database;
  let auth: Auth;

  beforeAll(async () => {
    db = await createTestDb();
    auth = createAuth(db, {
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-1234",
      emailAndPassword: { enabled: true },
    });
  }, 30_000);

  async function signUp(email: string, extra: Record<string, unknown> = {}) {
    const { headers, response } = await auth.api.signUpEmail({
      body: { name: "Test User", email, password: "correct-horse-battery", ...extra } as never,
      returnHeaders: true,
    });
    const cookie = headers.get("set-cookie");
    if (!cookie) throw new Error("no session cookie returned");
    return { cookie, userId: response.user.id };
  }

  it("creates a user + session, and reads the session back from a cookie", async () => {
    const { cookie, userId } = await signUp("a@example.com");

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

    expect(session?.user.id).toBe(userId);
    expect(session?.user.email).toBe("a@example.com");
    expect(session?.user.timeZone).toBe("UTC"); // default applied
    expect(session?.user.username ?? null).toBeNull(); // not onboarded yet
  });

  it("returns no session for a missing or forged cookie", async () => {
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
    const forged = new Headers({ cookie: "better-auth.session_token=forged.value" });
    expect(await auth.api.getSession({ headers: forged })).toBeNull();
  });

  // `input: false` means Better Auth's own endpoints can't write these fields.
  // Only our onboarding action (with our validation) can.
  it("sign-up: rejects a username, and replaces a sent timeZone with the default", async () => {
    await expect(signUp("b@example.com", { username: "admin" })).rejects.toThrow(/username is not allowed/);

    // Fields with a default are overwritten with it rather than rejected (see
    // parseInputData in better-auth/dist/db/schema.mjs).
    const { userId } = await signUp("b2@example.com", { timeZone: "Asia/Dhaka" });
    const [row] = await db.select().from(user).where(eq(user.id, userId));
    expect(row?.timeZone).toBe("UTC");
  });

  it("update-user: a logged-in user can't change their username or timeZone through Better Auth", async () => {
    const { cookie } = await signUp("e@example.com");
    const headers = new Headers({ cookie });

    await expect(auth.api.updateUser({ headers, body: { username: "admin" } as never })).rejects.toThrow(
      /not allowed/,
    );
    await expect(auth.api.updateUser({ headers, body: { timeZone: "Asia/Dhaka" } as never })).rejects.toThrow(
      /not allowed/,
    );
  });

  it("sees username changes immediately (no stale cookie cache)", async () => {
    const { cookie, userId } = await signUp("c@example.com");
    await db.update(user).set({ username: "c-user" }).where(eq(user.id, userId));

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.username).toBe("c-user");
  });

  it("invalidates the session on sign-out", async () => {
    const { cookie } = await signUp("d@example.com");
    await auth.api.signOut({ headers: new Headers({ cookie }) });
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
});
