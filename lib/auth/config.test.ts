import { describe, expect, it } from "vitest";
import { authConfigured, authProviders, emailSignIn, siteOrigin } from "./config";

describe("production authentication configuration", () => {
  it("is configured only when both Supabase values are present", () => {
    expect(authConfigured({ NODE_ENV: "development" })).toBe(false);
    expect(authConfigured({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" })).toBe(false);
    const env = { NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public" };
    expect(authConfigured(env)).toBe(true);
  });
  it("offers GitHub and an email link unless other providers are listed", () => {
    expect(authProviders({ NODE_ENV: "development" })).toEqual(["github"]);
    expect(emailSignIn({ NODE_ENV: "development" })).toBe(true);
    expect(authProviders({ NODE_ENV: "development", AUTH_PROVIDERS: "Google, github" })).toEqual(["github", "google"]);
    expect(emailSignIn({ NODE_ENV: "development", AUTH_PROVIDERS: "Google, github" })).toBe(false);
    expect(authProviders({ NODE_ENV: "development", AUTH_PROVIDERS: "facebook" })).toEqual(["github"]);
    expect(authProviders({ NODE_ENV: "development", AUTH_PROVIDERS: "email" })).toEqual([]);
    expect(emailSignIn({ NODE_ENV: "development", AUTH_PROVIDERS: "email" })).toBe(true);
  });
  it("requires a configured HTTPS origin for production redirects", () => {
    expect(() => siteOrigin({ NODE_ENV: "production" })).toThrow();
    expect(() => siteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://example.com" })).toThrow();
    expect(siteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://vouch.example/path" })).toBe("https://vouch.example");
  });
});
