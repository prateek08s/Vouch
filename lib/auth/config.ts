/** Sign-in is Supabase Auth only (Google and GitHub). Without it, nobody can sign in. */
export function authConfigured(env = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export type AuthProvider = "github" | "google";
const KNOWN: readonly AuthProvider[] = ["github", "google"];

/**
 * Sign-in providers to offer, from AUTH_PROVIDERS (comma-separated, e.g. "github,google").
 * Defaults to GitHub only. Enable a provider in Supabase before listing it here.
 */
export function authProviders(env = process.env): AuthProvider[] {
  const listed = (env.AUTH_PROVIDERS ?? "github").split(",").map((p) => p.trim().toLowerCase());
  const providers = KNOWN.filter((p) => listed.includes(p));
  return providers.length ? providers : ["github"];
}

export function siteOrigin(env = process.env): string {
  const url = new URL(env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  if (env.NODE_ENV === "production" && (!env.NEXT_PUBLIC_SITE_URL || url.protocol !== "https:")) {
    throw new Error("Set NEXT_PUBLIC_SITE_URL to your public HTTPS origin.");
  }
  return url.origin;
}
