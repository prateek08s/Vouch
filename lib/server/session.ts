import { authConfigured, demoAuthAllowed } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getDb } from "./db";
import type { User } from "@/lib/users";

/**
 * Development sign-in: a signed cookie holding a user id.
 * Stand-in for Supabase Auth (Google/GitHub), which replaces only this file.
 */
const COOKIE = "vouch_session";
const globalSecret = globalThis as unknown as { __vouchSecret?: string };

function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return (globalSecret.__vouchSecret ??= randomBytes(32).toString("hex"));
}

function sign(value: string): string {
  return `${value}.${createHmac("sha256", secret()).update(value).digest("base64url")}`;
}

export function verify(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const value = token.slice(0, i);
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? value : null;
}

export async function getCurrentUser(): Promise<User | null> {
  // Per-user data is request-time only. Without this, partial prefetching can run the
  // database code during a cookie-aware prerender, where clocks and I/O are not allowed.
  await connection();
  if (authConfigured()) {
    const { data: { user }, error } = await (await authClient()).auth.getUser();
    if (error || !user) return null;
    const [profile] = await (await getDb()).query<User>("select * from users where auth_user_id = $1 and not is_system", [user.id]);
    return profile ?? null;
  }
  if (!demoAuthAllowed()) return null;
  const userId = verify((await cookies()).get(COOKIE)?.value);
  if (!userId) return null;
  const db = await getDb();
  const rows = await db.query<User>("select * from users where id = $1", [userId]);
  return rows[0] ?? null;
}

export async function signIn(userId: string) {
  if (!demoAuthAllowed()) throw new Error("Demo sign-in is disabled.");
  (await cookies()).set(COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function signOut() {
  if (authConfigured()) {
    const { error } = await (await authClient()).auth.signOut();
    if (error) throw error;
  }
  (await cookies()).delete(COOKIE);
}
