import type { Db } from "@/lib/db";

export type FollowError = "self_follow" | "user_not_found";

/** Following creates a base trust edge (plan 6.2). Refollowing restores learned trust. */
export async function follow(
  db: Db,
  followerId: string,
  followeeId: string,
): Promise<{ ok: true; created: boolean } | { ok: false; error: FollowError }> {
  if (followerId === followeeId) return { ok: false, error: "self_follow" };
  return db.transaction(async (tx) => {
    const users = await tx.query("select id from users where id = any($1::uuid[])", [[followerId, followeeId]]);
    if (users.length !== 2) return { ok: false, error: "user_not_found" } as const;
    const inserted = await tx.query(
      `insert into follows (follower_id, followee_id) values ($1, $2)
       on conflict do nothing returning 1`,
      [followerId, followeeId],
    );
    await tx.query(
      `insert into trust_edges (user_id, curator_id) values ($1, $2) on conflict do nothing`,
      [followerId, followeeId],
    );
    if (inserted.length) {
      await tx.query("insert into events (user_id, name, props) values ($1, 'follow', $2)", [
        followerId,
        JSON.stringify({ followee_id: followeeId }),
      ]);
    }
    return { ok: true, created: inserted.length > 0 } as const;
  });
}

/** Unfollowing hides the curator from Circle but keeps learned trust (private) for a later refollow. */
export async function unfollow(db: Db, followerId: string, followeeId: string): Promise<boolean> {
  const rows = await db.query(
    "delete from follows where follower_id = $1 and followee_id = $2 returning 1",
    [followerId, followeeId],
  );
  return rows.length > 0;
}

export async function followingIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ followee_id: string }>("select followee_id from follows where follower_id = $1", [userId]);
  return rows.map((r) => r.followee_id);
}
