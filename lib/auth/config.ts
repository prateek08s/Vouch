/** Sign-in is Supabase Auth only (GitHub, Google, email link). Without it, nobody can sign in. */
export function authConfigured(env = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export type AuthProvider = "github" | "google";
const KNOWN: readonly AuthProvider[] = ["github", "google"];

const DEFAULT_PROVIDERS = "github,email";
const listed = (env: NodeJS.ProcessEnv) => (env.AUTH_PROVIDERS ?? DEFAULT_PROVIDERS).split(",").map((p) => p.trim().toLowerCase());

/**
 * OAuth providers to offer, from AUTH_PROVIDERS (comma-separated, e.g. "github,google,email").
 * Defaults to GitHub plus an email link. Enable a provider in Supabase before listing it here.
 */
export function authProviders(env = process.env): AuthProvider[] {
  const providers = KNOWN.filter((p) => listed(env).includes(p));
  return providers.length || emailSignIn(env) ? providers : ["github"];
}

/** Sign in with a one-time link sent by email (Supabase's Email provider, on by default). */
export function emailSignIn(env = process.env): boolean {
  return listed(env).includes("email");
}

export function siteOrigin(env = process.env): string {
  const url = new URL(env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  if (env.NODE_ENV === "production" && (!env.NEXT_PUBLIC_SITE_URL || url.protocol !== "https:")) {
    throw new Error("Set NEXT_PUBLIC_SITE_URL to your public HTTPS origin.");
  }
  return url.origin;
}
