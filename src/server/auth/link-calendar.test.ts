import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/types";
import { CALENDAR_SCOPES } from "@/lib/calendar";
import { createTestDb } from "@/test/db";
import { createAuth, type Auth } from "./config";

/*
 * The "Connect Google Calendar" button asks Better Auth to link the Google
 * account again with more scopes. The real consent screen can't run in a
 * test, but the URL Better Auth sends the browser to can be checked: it's
 * where every promise about permissions is actually made.
 */
describe("connecting Google Calendar: the consent URL", () => {
  let db: Database;
  let auth: Auth;
  let cookie: string;

  beforeAll(async () => {
    db = await createTestDb();
    auth = createAuth(db, {
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-1234",
      emailAndPassword: { enabled: true }, // only to get a signed-in session without Google
      socialProviders: {
        google: { clientId: "client-id", clientSecret: "client-secret", prompt: "select_account" },
      },
    });
    const { headers } = await auth.api.signUpEmail({
      body: { name: "Host", email: "host@example.com", password: "correct-horse-battery" },
      returnHeaders: true,
    });
    cookie = headers.get("set-cookie")!;
  }, 30_000);

  // The same options the dashboard button sends (calendar-connection.tsx).
  async function consentUrl() {
    const { url } = await auth.api.linkSocialAccount({
      headers: new Headers({ cookie }),
      body: {
        provider: "google",
        scopes: [...CALENDAR_SCOPES],
        callbackURL: "/dashboard/availability/calendar-connected",
        errorCallbackURL: "/dashboard/availability?calendar=error",
        additionalParams: { access_type: "offline", prompt: "consent" },
      },
    });
    return new URL(url);
  }

  it("asks Google for exactly the sign-in scopes plus the two calendar ones", async () => {
    const scopes = (await consentUrl()).searchParams.get("scope")!.split(" ");
    expect(scopes.sort()).toEqual(["email", "openid", "profile", ...CALENDAR_SCOPES].sort());
  });

  it("asks for offline access, on a consent screen (the only way Google sends a refresh token)", async () => {
    const params = (await consentUrl()).searchParams;
    expect(params.get("access_type")).toBe("offline");
    // Overrides the provider's sign-in default ("select_account").
    expect(params.get("prompt")).toBe("consent");
    // Incremental authorisation: what was granted at sign-in stays granted.
    expect(params.get("include_granted_scopes")).toBe("true");
  });

  it("goes to Google, with PKCE and a state, back to our own callback", async () => {
    const url = await consentUrl();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/google");
  });

  it("can't be started without a session", async () => {
    await expect(
      auth.api.linkSocialAccount({ headers: new Headers(), body: { provider: "google" } }),
    ).rejects.toThrow();
  });
});
