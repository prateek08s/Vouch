import type { Db } from "@/lib/db";
import type { TrustTier } from "@/lib/users";

let seq = 0;
const next = () => (++seq).toString(36).padStart(4, "0");

export async function user(db: Db, username?: string, tier: TrustTier = "new"): Promise<string> {
  const name = username ?? `user_${next()}`;
  const [r] = await db.query<{ id: string }>(
    "insert into users (username, display_name, trust_tier) values ($1, $2, $3) returning id",
    [name, name, tier],
  );
  return r.id;
}

/** A distinct 11-char YouTube-style ID per call. */
export function videoId(): string {
  return `vid${next()}`.padEnd(11, "x");
}

export async function resource(
  db: Db,
  over: Partial<{
    externalId: string;
    title: string;
    channelId: string;
    channelName: string;
    durationS: number | null;
    isShort: boolean;
    status: "ok" | "partial" | "unavailable";
  }> = {},
): Promise<string> {
  const id = over.externalId ?? videoId();
  const [r] = await db.query<{ id: string }>(
    `insert into resources (source, external_id, canonical_url, title, creator_external_id, creator_name,
                            duration_s, is_short, metadata_status)
     values ('youtube', $1, 'https://www.youtube.com/watch?v=' || $1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      id,
      over.title ?? `Video ${id}`,
      over.channelId ?? "UC_default",
      over.channelName ?? "Default Channel",
      over.durationS === undefined ? 600 : over.durationS,
      over.isShort ?? false,
      over.status ?? "ok",
    ],
  );
  return r.id;
}

export async function follow(db: Db, follower: string, followee: string) {
  await db.query("insert into follows (follower_id, followee_id) values ($1, $2)", [follower, followee]);
}
