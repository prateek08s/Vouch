import type { Db } from "@/lib/db";
import type { Resource } from "@/lib/resources/ingest";
import { loadTrust, trustFor, trustLevel, type TrustLevel } from "@/lib/trust";

export type WatchNote = {
  vouchId: string;
  curatorId: string;
  curatorName: string;
  curatorUsername: string;
  note: string | null;
  isOwnContent: boolean;
  createdAt: Date;
  inCircle: boolean;
  trustLevel: TrustLevel;
  /** A Vouch-run curator such as Hacker News; its notes are quotes from real commenters. */
  isSystem: boolean;
};

export type WatchData = {
  resource: Resource;
  topics: { slug: string; name: string }[];
  /** Vouches from the viewer's circle first, then the one they arrived through. */
  notes: WatchNote[];
  /** Who carried this video to the viewer (plan 5.8). */
  via: WatchNote | null;
  rating: boolean | null;
  publicVouchCount: number;
  /** Notes on this page the viewer has already reported. */
  reported: string[];
};

/** Stands in for "nobody" in viewer-scoped queries: no follows, ratings or attribution match it. */
const NO_VIEWER = "00000000-0000-0000-0000-000000000000";

/** Watch page data. A null viewer (signed out) sees the public vouches, newest notes first. */
export async function getWatchData(
  db: Db,
  viewer: string | null,
  resourceId: string,
  viaVouchId: string | null,
): Promise<WatchData | null> {
  const viewerId = viewer ?? NO_VIEWER;
  const [resource] = await db.query<Resource>("select * from resources where id = $1", [resourceId]);
  if (!resource) return null;

  const vouches = await db.query<{
    vouch_id: string; curator_id: string; curator_name: string; curator_username: string;
    note: string | null; is_own_content: boolean; created_at: Date; in_circle: boolean; topic_ids: number[];
    is_system: boolean;
  }>(
    `select v.id as vouch_id, v.user_id as curator_id, u.display_name as curator_name, u.username as curator_username,
            v.note, v.is_own_content, v.created_at, u.is_system,
            exists (select 1 from follows f where f.follower_id = $2 and f.followee_id = v.user_id) as in_circle,
            coalesce(array_agg(vt.topic_id) filter (where vt.topic_id is not null), '{}') as topic_ids
     from vouches v
     join users u on u.id = v.user_id
     left join vouch_topics vt on vt.vouch_id = v.id
     where v.resource_id = $1 and v.user_id <> $2 and v.hidden_at is null
     group by v.id, u.id`,
    [resourceId, viewerId],
  );

  const trust = await loadTrust(db, viewerId, vouches.map((v) => v.curator_id));
  const all: WatchNote[] = vouches.map((v) => ({
    vouchId: v.vouch_id,
    curatorId: v.curator_id,
    curatorName: v.curator_name,
    curatorUsername: v.curator_username,
    note: v.note,
    isOwnContent: v.is_own_content,
    createdAt: v.created_at,
    inCircle: v.in_circle,
    trustLevel: trustLevel(trustFor(trust.get(v.curator_id), v.topic_ids)),
    isSystem: v.is_system,
  }));

  // Existing attribution wins over the query string: the first person who brought you is the one credited.
  const [attr] = await db.query<{ source_vouch_id: string | null }>(
    "select source_vouch_id from vouch_attribution where user_id = $1 and resource_id = $2",
    [viewerId, resourceId],
  );
  const viaId = attr ? attr.source_vouch_id : viaVouchId;
  const via = all.find((n) => n.vouchId === viaId) ?? null;

  const notes = all
    .filter((n) => (viewer ? n.inCircle : n.note !== null) || n.vouchId === via?.vouchId)
    .sort((a, b) => Number(b.vouchId === via?.vouchId) - Number(a.vouchId === via?.vouchId) || b.createdAt.getTime() - a.createdAt.getTime());

  const [rating] = await db.query<{ worth_it: boolean }>(
    "select worth_it from ratings where user_id = $1 and resource_id = $2",
    [viewerId, resourceId],
  );
  const topics = await db.query<{ slug: string; name: string }>(
    `select t.slug, t.name from resource_topics rt join topics t on t.id = rt.topic_id
     where rt.resource_id = $1 order by t.name`,
    [resourceId],
  );

  // "N more people outside your circle vouched" counts people. A system curator such as Hacker News
  // has its own section on the watch page, so it only counts here when it is shown as a note.
  const systemIds = new Set(vouches.filter((v) => v.is_system).map((v) => v.vouch_id));
  const shown = new Set(notes.map((n) => n.vouchId));
  const publicVouchCount = all.filter((n) => !systemIds.has(n.vouchId) || shown.has(n.vouchId)).length;

  const reported = viewer
    ? (await db.query<{ vouch_id: string }>(
        `select rp.vouch_id from reports rp join vouches v on v.id = rp.vouch_id
         where rp.reporter_id = $1 and v.resource_id = $2`,
        [viewer, resourceId],
      )).map((r) => r.vouch_id)
    : [];

  return { resource, topics, notes, via, rating: rating?.worth_it ?? null, publicVouchCount, reported };
}
