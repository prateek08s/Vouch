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
    savedVideos: await one("select r.canonical_url, r.title, s.saved_at from saved_resources s join resources r on r.id = s.resource_id where s.user_id = $1 order by s.saved_at desc"),
    watchProgress: await one("select r.canonical_url, r.title, p.position_s, p.status, p.updated_at from watch_progress p join resources r on r.id = p.resource_id where p.user_id = $1 order by p.updated_at desc"),
    ratings: await one(`select r.canonical_url, r.title, x.worth_it, x.created_at, x.updated_at
                        from ratings x join resources r on r.id = x.resource_id where x.user_id = $1 order by x.created_at`),
    follows: await one("select u.username, f.created_at from follows f join users u on u.id = f.followee_id where f.follower_id = $1"),
    lists: await one(`select l.title, l.description, l.is_public, l.created_at,
                        array(select r.canonical_url from list_items li join resources r on r.id = li.resource_id
                              where li.list_id = l.id order by li.position) as videos
                      from lists l where l.owner_id = $1 and l.system_key is null`),
    learningPaths: await one("select l.id as list_id, l.title, p.level, p.prerequisites, p.outcomes, p.updated_at from learning_paths p join lists l on l.id = p.list_id where l.owner_id = $1"),
    lessonResources: await one("select a.resource_id, l.title as collection_title, a.kind, a.title, a.url, a.created_at from lesson_resources a join lists l on l.id = a.list_id where l.owner_id = $1 order by a.created_at"),
    roadmaps: await one("select r.*, array(select list_id from roadmap_stages s where s.roadmap_id=r.id order by position) as paths from roadmaps r where owner_id=$1"),
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
