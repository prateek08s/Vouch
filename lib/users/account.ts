import type { Db } from "@/lib/db";

/**
 * Everything a person put into Vouch, as plain data (their right to a copy).
 * Others' private data never appears: only this person's own rows.
 */
export async function exportAccount(db: Db, userId: string) {
  const one = async (sql: string) => db.query(sql, [userId]);
  const [profile] = await one("select username, display_name, bio, avatar_url, created_at, onboarded_at, passport_public from users where id = $1");
  return {
    exportedAt: new Date().toISOString(),
    profile,
    vouches: await one(`select r.canonical_url, r.title, v.note, v.is_own_content, v.created_at,
                          array(select t.slug from vouch_topics vt join topics t on t.id = vt.topic_id where vt.vouch_id = v.id) as topics
                        from vouches v join resources r on r.id = v.resource_id where v.user_id = $1 order by v.created_at`),
    ratings: await one(`select r.canonical_url, r.title, x.worth_it, x.created_at, x.updated_at
                        from ratings x join resources r on r.id = x.resource_id where x.user_id = $1 order by x.created_at`),
    follows: await one("select u.username, f.created_at from follows f join users u on u.id = f.followee_id where f.follower_id = $1"),
    lists: await one(`select l.title, l.description, l.is_public, l.created_at,
                        array(select r.canonical_url from list_items li join resources r on r.id = li.resource_id
                              where li.list_id = l.id order by li.position) as videos
                      from lists l where l.owner_id = $1 and l.system_key is null`),
    followedLists: await one("select l.title, lf.created_at from list_follows lf join lists l on l.id = lf.list_id where lf.user_id = $1"),
    rules: await one("select kind, value, created_at from rules where user_id = $1"),
    topics: await one("select t.slug from user_topics ut join topics t on t.id = ut.topic_id where ut.user_id = $1"),
  };
}

/**
 * Deletes the person's Vouch account and everything that belongs to it. Foreign keys cascade
 * (vouches, ratings, follows, lists, rules, trust); anonymous event rows keep no user id.
 * Returns the Supabase Auth id so the caller can remove the sign-in identity too.
 */
export async function deleteAccount(db: Db, userId: string): Promise<{ authUserId: string | null } | null> {
  const [row] = await db.query<{ auth_user_id: string | null }>(
    "delete from users where id = $1 and not is_system returning auth_user_id",
    [userId],
  );
  return row ? { authUserId: row.auth_user_id } : null;
}
