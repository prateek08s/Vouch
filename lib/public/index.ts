import type { Db } from "@/lib/db";

export type PublicPick = {
  id: string; title: string; canonical_url: string; thumbnail_url: string | null;
  note: string | null; curator: string; username: string;
};

/** Public endorsements only. Ratings, identities, trust edges and private lists never leave this boundary. */
export async function publicPicks(db: Db, username?: string): Promise<PublicPick[]> {
  return db.query<PublicPick>(
    `select r.id, r.title, r.canonical_url, r.thumbnail_url, v.note,
            u.display_name as curator, u.username
     from vouches v join resources r on r.id = v.resource_id join users u on u.id = v.user_id
     where r.metadata_status <> 'unavailable' and ($1::text is null or u.username = $1)
       and v.id = (select v2.id from vouches v2 where v2.resource_id = r.id
          and ($1::text is null or v2.user_id = u.id) order by v2.created_at desc, v2.id limit 1)
     order by v.created_at desc, v.id limit 12`,
    [username ?? null],
  );
}

export async function publicProfile(db: Db, username: string) {
  const [profile] = await db.query<{ username: string; display_name: string; bio: string | null }>(
    "select username, display_name, bio from users where username = $1", [username],
  );
  if (!profile) return null;
  const [picks, lists] = await Promise.all([
    publicPicks(db, username),
    db.query<{ id: string; title: string; description: string | null }>(
      "select id, title, description from lists where owner_id = (select id from users where username = $1) and is_public order by created_at desc limit 12",
      [username],
    ),
  ]);
  return { ...profile, picks, lists };
}
