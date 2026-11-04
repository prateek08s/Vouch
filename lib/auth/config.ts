/** Demo accounts are confined to local development with no managed auth configured. */
export function authConfigured(env = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function demoAuthAllowed(env = process.env): boolean {
  return env.NODE_ENV !== "production" && !authConfigured(env);
}

export function siteOrigin(env = process.env): string {
  const url = new URL(env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  if (env.NODE_ENV === "production" && (!env.NEXT_PUBLIC_SITE_URL || url.protocol !== "https:")) {
    throw new Error("Set NEXT_PUBLIC_SITE_URL to your public HTTPS origin.");
  }
  return url.origin;
}
