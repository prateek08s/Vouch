import { createClient } from "@supabase/supabase-js";

/**
 * Removes a Supabase Auth identity. Needs SUPABASE_SECRET_KEY (server-only, never NEXT_PUBLIC_).
 * Without it the Vouch data is still deleted; signing in again would start a fresh, empty account.
 */
export async function deleteAuthUser(authUserId: string): Promise<"deleted" | "skipped"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return "skipped";
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.deleteUser(authUserId);
  if (error) throw error;
  return "deleted";
}
