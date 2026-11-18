import { authConfigured } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "./db";
import type { User } from "@/lib/users";

/**
 * The signed-in person, from their Supabase Auth session (Google or GitHub).
 * A Vouch profile is linked to the auth identity by provider id in /auth/callback.
 * Cached per request: the layout and the page share one Supabase check.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<User | null> {
  // Per-user data is request-time only. Without this, partial prefetching can run the
  // database code during a cookie-aware prerender, where clocks and I/O are not allowed.
  await connection();
  if (!authConfigured()) return null;
  const { data: { user }, error } = await (await authClient()).auth.getUser();
  if (error || !user) return null;
  const [profile] = await (await getDb()).query<User>("select * from users where auth_user_id = $1 and not is_system", [user.id]);
  return profile ?? null;
});

export async function signOut() {
  if (!authConfigured()) return;
  const { error } = await (await authClient()).auth.signOut();
  if (error) throw error;
}
