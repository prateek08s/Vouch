import { describe, expect, it } from "vitest";
import { authConfigured, demoAuthAllowed, siteOrigin } from "./config";

describe("production authentication configuration", () => {
  it("never enables demo sign-in in production", () => {
    expect(demoAuthAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(demoAuthAllowed({ NODE_ENV: "development" })).toBe(true);
  });
  it("disables demo mode when managed authentication is configured", () => {
    const env = { NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public" };
    expect(authConfigured(env)).toBe(true);
    expect(demoAuthAllowed(env)).toBe(false);
  });
  it("requires a configured HTTPS origin for production redirects", () => {
    expect(() => siteOrigin({ NODE_ENV: "production" })).toThrow();
    expect(() => siteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://example.com" })).toThrow();
    expect(siteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://vouch.example/path" })).toBe("https://vouch.example");
  });
});
