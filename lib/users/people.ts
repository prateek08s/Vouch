import type { Db } from "@/lib/db";

export type PersonRow = {
    id: string; username: string; display_name: string; bio: string | null;
    following: boolean; vouch_count: number; top_topics: string[] | null;
};

/**
 * Everyone but the viewer, followed first, then by number of vouches. Reputation is
 * recommendation quality, not follower count (plan 8): counts only, never per-user ratings.
 */
export async function listPeople(db: Db, viewerId: string): Promise<PersonRow[]> {
  return db.query<PersonRow>(
    `select u.id, u.username, u.display_name, u.bio,
            exists (select 1 from follows f where f.follower_id = $1 and f.followee_id = u.id) as following,
            (select count(*)::int from vouches v where v.user_id = u.id and v.hidden_at is null) as vouch_count,
            (select array_agg(name) from (
               select t.name from vouches v join vouch_topics vt on vt.vouch_id = v.id join topics t on t.id = vt.topic_id
               where v.user_id = u.id group by t.name order by count(*) desc, t.name limit 3) x) as top_topics
     from users u where u.id <> $1 and u.suspended_at is null
     order by following desc, vouch_count desc, u.display_name`,
    [viewerId],
  );
}
