import type { Db } from "@/lib/db";

export type TrustTier = "new" | "standard" | "founding";

export type User = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  trust_tier: TrustTier;
  /** Curator accounts run by Vouch itself (such as "Hacker News"). Nobody signs in as one. */
  is_system: boolean;
  /** Null until the person finishes onboarding (topics, choices, first follows). */
  onboarded_at: Date | null;
  created_at: Date;
};

export type CreateUserError = "invalid_username" | "username_taken" | "invalid_display_name" | "bio_too_long";

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** "Sam O'Neil" + "4821" -> "sam_oneil_4821". Always matches USERNAME_PATTERN. */
export function usernameFrom(displayName: string, suffix: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24 - suffix.length - 1)
    .replace(/_+$/, "");
  return `${base || "user"}_${suffix}`;
}

export async function createUser(
  db: Db,
  input: { username: string; displayName: string; bio?: string; avatarUrl?: string; trustTier?: TrustTier },
): Promise<{ ok: true; user: User } | { ok: false; error: CreateUserError }> {
  const username = normalizeUsername(input.username);
  const displayName = input.displayName.trim();
  const bio = input.bio?.trim() || null;
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: "invalid_username" };
  if (displayName.length < 1 || displayName.length > 60) return { ok: false, error: "invalid_display_name" };
  if (bio && bio.length > 280) return { ok: false, error: "bio_too_long" };

  const rows = await db.query<User>(
    `insert into users (username, display_name, bio, avatar_url, trust_tier)
     values ($1, $2, $3, $4, $5)
     on conflict (username) do nothing
     returning *`,
    [username, displayName, bio, input.avatarUrl ?? null, input.trustTier ?? "new"],
  );
  if (!rows[0]) return { ok: false, error: "username_taken" };
  await db.query("insert into events (user_id, name) values ($1, 'signup')", [rows[0].id]);
  return { ok: true, user: rows[0] };
}

export async function getUserByUsername(db: Db, username: string): Promise<User | null> {
  const rows = await db.query<User>("select * from users where username = $1", [normalizeUsername(username)]);
  return rows[0] ?? null;
}
