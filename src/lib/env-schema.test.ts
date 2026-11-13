import { describe, expect, it } from "vitest";
import { parseEnv } from "./env-schema";

const base = {
  DATABASE_URL: "postgresql://user:pw@ep-x.us-east-1.aws.neon.tech/neondb",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
};

describe("parseEnv", () => {
  it("treats empty optional values as unset (.env.example ships `RESEND_API_KEY=`)", () => {
    const env = parseEnv({ ...base, RESEND_API_KEY: "", DEMO_BOOKING_PATH: "", EMAIL_FROM: "" });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.DEMO_BOOKING_PATH).toBeUndefined();
    expect(env.EMAIL_FROM).toBe("MeetReady <onboarding@resend.dev>");
  });

  it("still rejects missing required values and a short secret", () => {
    expect(() => parseEnv({ ...base, GOOGLE_CLIENT_ID: "" })).toThrow();
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/at least 32/);
  });

  describe("app URL on Vercel", () => {
    const vercel = {
      ...base,
      BETTER_AUTH_URL: undefined,
      VERCEL_URL: "meetready-a1b2c3-sakif.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "meetready.vercel.app",
    };

    it("production uses the production domain, not the deployment's own URL", () => {
      expect(parseEnv({ ...vercel, VERCEL_ENV: "production" }).BETTER_AUTH_URL).toBe(
        "https://meetready.vercel.app",
      );
    });

    it("a preview uses its own URL, so its links reach its own database branch", () => {
      expect(parseEnv({ ...vercel, VERCEL_ENV: "preview" }).BETTER_AUTH_URL).toBe(
        "https://meetready-a1b2c3-sakif.vercel.app",
      );
    });

    it("an explicit BETTER_AUTH_URL always wins", () => {
      const env = parseEnv({
        ...vercel,
        VERCEL_ENV: "production",
        BETTER_AUTH_URL: "https://meetready.example",
      });
      expect(env.BETTER_AUTH_URL).toBe("https://meetready.example");
    });

    it("off Vercel, it's required", () => {
      expect(() => parseEnv({ ...base, BETTER_AUTH_URL: undefined })).toThrow();
    });
  });

  it("points at Google by default; only the E2E tests swap in a fake", () => {
    const env = parseEnv(base);
    expect(env.GOOGLE_CALENDAR_API_URL).toBe("https://www.googleapis.com/calendar/v3");
    expect(env.GOOGLE_REVOKE_URL).toBe("https://oauth2.googleapis.com/revoke");
    expect(parseEnv({ ...base, GOOGLE_CALENDAR_API_URL: "" }).GOOGLE_CALENDAR_API_URL).toBe(
      "https://www.googleapis.com/calendar/v3",
    );
  });

  describe("Redis for rate limiting", () => {
    it("is optional: unset or empty means limits are kept in memory", () => {
      expect(parseEnv(base).REDIS).toBeUndefined();
      expect(parseEnv({ ...base, KV_REST_API_URL: "", KV_REST_API_TOKEN: "" }).REDIS).toBeUndefined();
    });

    it("takes Vercel Marketplace's names or Upstash's own", () => {
      const redis = { url: "https://us1-x.upstash.io", token: "t" };
      expect(parseEnv({ ...base, KV_REST_API_URL: redis.url, KV_REST_API_TOKEN: "t" }).REDIS).toEqual(redis);
      expect(
        parseEnv({ ...base, UPSTASH_REDIS_REST_URL: redis.url, UPSTASH_REDIS_REST_TOKEN: "t" }).REDIS,
      ).toEqual(redis);
    });

    it("rejects half a pair at startup", () => {
      expect(() => parseEnv({ ...base, KV_REST_API_URL: "https://us1-x.upstash.io" })).toThrow();
      expect(() => parseEnv({ ...base, KV_REST_API_TOKEN: "t" })).toThrow();
    });
  });
});
