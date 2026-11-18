import type { Db } from "@/lib/db";
import { recordImpressions } from "@/lib/analytics";
import { applyRules, listRules } from "@/lib/rules";
import { loadTopics } from "@/lib/topics";
import { loadTrust, trustFor } from "@/lib/trust";
import { PAGE_SIZE, rankCircle, type FeedCandidate, type RankedItem } from "./rank";

/** How far back Circle looks for people's vouches. Freshness decays well before this. */
export const CANDIDATE_WINDOW_DAYS = 60;
/**
 * System curators (imported sources such as Hacker News) are evergreen: their picks are dated to
 * the original comment, often a year back, so the window would hide all of them. Instead the best
 * of them by number of independent recommendations are always candidates, ranked below fresh picks.
 */
export const SYSTEM_CANDIDATES = 200;

export type CirclePage = {
  items: RankedItem[];
  /** Offset of the next page, or null when the viewer is caught up. */
  nextCursor: number | null;
  /** Vouches hidden by the viewer's rules (count only, for "3 hidden by your rules"). */
  hiddenByRules: number;
  /** Distinct curators in the circle who contributed to this feed. */
  curatorCount: number;
};

type Row = {
  resource_id: string;
  title: string;
  duration_s: number | null;
  thumbnail_url: string | null;
  creator_external_id: string | null;
  creator_name: string | null;
  is_short: boolean;
  vouch_id: string;
  curator_id: string;
  curator_name: string;
  curator_username: string;
  note: string | null;
  is_own_content: boolean;
  created_at: Date;
  topic_ids: number[];
  is_system: boolean;
  mention_count: number;
};

/**
 * Circle feed (plan 14.1):
 *   1. recent vouches from followed users   2. merge per resource   3. hard rules
 *   4. drop rated and own-vouched           5. rank + explain + diversify   6. finite page
 */
export async function circleFeed(
  db: Db,
  viewerId: string,
  opts: { cursor?: number; now?: Date } = {},
): Promise<CirclePage> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 86_400_000);

  // Candidates: people's vouches inside the window, plus the best-recommended picks of followed
  // system curators at any age. Rated and own-vouched videos are excluded before the cap.
  const rows = await db.query<Row>(
    `with eligible as (
       select v.id, v.resource_id, u.is_system
       from follows f
       join vouches v   on v.user_id = f.followee_id and v.created_at <= $3
       join users u     on u.id = v.user_id
       join resources r on r.id = v.resource_id and r.metadata_status <> 'unavailable'
       where f.follower_id = $1
         and (u.is_system or v.created_at > $2)
         and not exists (select 1 from ratings x where x.user_id = $1 and x.resource_id = v.resource_id)
         and not exists (select 1 from vouches mine where mine.user_id = $1 and mine.resource_id = v.resource_id)
     ),
     picked as (
       select e.id, 0 as mentions from eligible e where not e.is_system
       union all
       (select e.id, m.n as mentions
        from eligible e
        cross join lateral (select count(distinct hm.author)::int as n from hn_mentions hm where hm.resource_id = e.resource_id) m
        where e.is_system
        order by m.n desc, e.id
        limit $4)
     )
     select r.id as resource_id, r.title, r.duration_s, r.thumbnail_url, r.creator_external_id,
            r.creator_name, r.is_short,
            v.id as vouch_id, v.user_id as curator_id, u.display_name as curator_name,
            u.username as curator_username, v.note, v.is_own_content, v.created_at,
            u.is_system, p.mentions as mention_count,
            coalesce(array_agg(vt.topic_id) filter (where vt.topic_id is not null), '{}') as topic_ids
     from picked p
     join vouches v   on v.id = p.id
     join users u     on u.id = v.user_id
     join resources r on r.id = v.resource_id
     left join vouch_topics vt on vt.vouch_id = v.id
     group by r.id, v.id, u.id, p.mentions`,
    [viewerId, since, now, SYSTEM_CANDIDATES],
  );
  if (!rows.length) return { items: [], nextCursor: null, hiddenByRules: 0, curatorCount: 0 };

  const [topicIndex, rules, stats] = await Promise.all([
    loadTopics(db),
    listRules(db, viewerId),
    db.query<{ resource_id: string; n: number; w: number }>(
      `select resource_id, count(*)::int n, (count(*) filter (where worth_it))::int w
       from ratings where resource_id = any($1::uuid[]) group by resource_id`,
      [[...new Set(rows.map((r) => r.resource_id))]],
    ),
  ]);
  const topicNames = new Map([...topicIndex.byId.values()].map((t) => [t.id, t.name]));
  const statsById = new Map(stats.map((s) => [s.resource_id, s]));
  const trust = await loadTrust(db, viewerId, [...new Set(rows.map((r) => r.curator_id))]);

  // Merge vouches per resource.
  const byResource = new Map<string, FeedCandidate & { creatorId: string | null; isShort: boolean; topicSlugs: string[]; topicCounts: Map<number, number> }>();
  for (const r of rows) {
    let c = byResource.get(r.resource_id);
    if (!c) {
      const s = statsById.get(r.resource_id);
      c = {
        resourceId: r.resource_id,
        title: r.title,
        durationS: r.duration_s,
        thumbnailUrl: r.thumbnail_url,
        creatorName: r.creator_name,
        creatorId: r.creator_external_id,
        isShort: r.is_short,
        primaryTopic: null,
        worthCount: s?.w ?? 0,
        ratingCount: s?.n ?? 0,
        vouches: [],
        topicSlugs: [],
        topicCounts: new Map(),
      };
      byResource.set(r.resource_id, c);
    }
    c.vouches.push({
      vouchId: r.vouch_id,
      curatorId: r.curator_id,
      curatorName: r.curator_name,
      curatorUsername: r.curator_username,
      note: r.note,
      isOwnContent: r.is_own_content,
      createdAt: r.created_at,
      evergreen: r.is_system,
      mentionCount: r.mention_count,
      topicIds: r.topic_ids,
      trust: trustFor(trust.get(r.curator_id), r.topic_ids),
    });
    for (const id of r.topic_ids) c.topicCounts.set(id, (c.topicCounts.get(id) ?? 0) + 1);
  }

  for (const c of byResource.values()) {
    const slugs = new Set<string>();
    // Full lineage, so blocking "hardware" also blocks "gpu" and "technology" blocks both.
    for (const id of c.topicCounts.keys()) for (const slug of topicIndex.lineage(id)) slugs.add(slug);
    c.topicSlugs = [...slugs];
    // Primary topic: the most-tagged, ties broken by lowest id for stability.
    const [top] = [...c.topicCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    c.primaryTopic = top ? { id: top[0], name: topicNames.get(top[0]) ?? "" } : null;
  }

  // Hard rules run before ranking, always.
  const { kept, removed } = applyRules(
    [...byResource.values()].map((c) => ({ ...c, creatorName: c.creatorName })),
    rules,
  );

  const ranked = rankCircle(kept, now, topicNames);
  const start = Math.max(0, opts.cursor ?? 0);
  const items = ranked.slice(start, start + PAGE_SIZE);
  const end = start + items.length;
  return {
    items,
    nextCursor: end < ranked.length ? end : null,
    hiddenByRules: removed.length,
    curatorCount: new Set(rows.map((r) => r.curator_id)).size,
  };
}

/** Logs what the Circle showed, so Worth-It rates can be compared per explanation (lib/analytics). */
export async function logImpressions(db: Db, viewerId: string, items: RankedItem[], now = new Date()) {
  return recordImpressions(db, viewerId, "circle", items.map((i) => ({ resourceId: i.resourceId, explanationCode: i.explanation.code })), now);
}
