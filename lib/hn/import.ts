import type { Db } from "@/lib/db";
import { ingestYouTubeUrl, type IngestError } from "@/lib/resources/ingest";
import { createVouch, updateVouch } from "@/lib/vouches";
import { canonicalYouTubeUrl } from "@/lib/youtube/parse";
import type { MetadataProvider, MetadataResult } from "@/lib/youtube/metadata";
import { noteFor, planLists, type TopicInfo, type VideoAggregate } from "./aggregate";

/**
 * Step 4 of the Hacker News import: write aggregated recommendations into Vouch.
 *
 *  - one clearly labeled system curator, "Hacker News"
 *  - one Vouch per video, dated to its latest recommending comment, with a quoted reason
 *  - one hn_mentions row per recommending comment, for "Recommended in N HN comments"
 *  - the public lists from planLists(), rebuilt in place on every run
 *
 * Safe to re-run: nothing is duplicated, and videos YouTube has removed are skipped.
 */

export const HN_USERNAME = "hackernews";
export const HN_DISPLAY_NAME = "Hacker News";
export const HN_BIO =
  "Videos Hacker News commenters recommended, quoted in their own words with a link to each comment. Source: the open-index/hacker-news dataset (ODC-BY).";

export function hnCommentUrl(commentId: number): string {
  return `https://news.ycombinator.com/item?id=${commentId}`;
}

/** The Hacker News system curator, created once. */
export async function ensureHnCurator(db: Db): Promise<string> {
  const [u] = await db.query<{ id: string }>(
    `insert into users (username, display_name, bio, trust_tier, is_system)
     values ($1, $2, $3, 'founding', true)
     on conflict (username) do update set is_system = true, display_name = excluded.display_name, bio = excluded.bio
     returning id`,
    [HN_USERNAME, HN_DISPLAY_NAME, HN_BIO],
  );
  return u.id;
}

export type ImportStats = {
  videos: number;
  imported: number;
  updated: number;
  mentions: number;
  skipped: Partial<Record<IngestError | "no_topic", number>>;
  lists: { key: string; title: string; items: number }[];
};

type Deps = {
  db: Db;
  metadata: MetadataProvider;
  /** Parallel YouTube lookups. Database writes stay sequential. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  now?: () => Date;
};

/** Fetches metadata for many videos at once, then serves ingest from the cache. */
async function prefetch(ids: string[], provider: MetadataProvider, concurrency: number, onProgress?: Deps["onProgress"]) {
  const cache = new Map<string, MetadataResult>();
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      cache.set(id, await provider.fetch(id));
      onProgress?.(++done, ids.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  const cached: MetadataProvider = { fetch: async (id) => cache.get(id) ?? provider.fetch(id) };
  return cached;
}

export async function importHn(
  aggs: VideoAggregate[],
  topics: TopicInfo[],
  opts: { period: string },
  deps: Deps,
): Promise<ImportStats> {
  const { db } = deps;
  const curatorId = await ensureHnCurator(db);
  const stats: ImportStats = { videos: aggs.length, imported: 0, updated: 0, mentions: 0, skipped: {}, lists: [] };
  const skip = (why: keyof ImportStats["skipped"]) => (stats.skipped[why] = (stats.skipped[why] ?? 0) + 1);

  const tagged = aggs.filter((a) => a.topics.length);
  for (let i = tagged.length; i < aggs.length; i++) skip("no_topic");

  const known = new Map(
    (await db.query<{ external_id: string; id: string }>(
      "select external_id, id from resources where source = 'youtube' and external_id = any($1::text[])",
      [tagged.map((a) => a.videoId)],
    )).map((r) => [r.external_id, r.id]),
  );
  // Only unknown videos need a lookup; ingest refreshes known ones itself when they are stale.
  const metadata = await prefetch(tagged.filter((a) => !known.has(a.videoId)).map((a) => a.videoId), deps.metadata, deps.concurrency ?? 6, deps.onProgress);

  const resourceIds = new Map<string, string>();
  for (const a of tagged) {
    const r = await ingestYouTubeUrl(canonicalYouTubeUrl(a.videoId), { db, metadata });
    if (!r.ok) {
      skip(r.error);
      continue;
    }
    resourceIds.set(a.videoId, r.resource.id);

    await db.transaction(async (tx) => {
      for (const m of a.mentions) {
        await tx.query(
          `insert into hn_mentions (comment_id, resource_id, author, posted_at, excerpt)
           values ($1, $2, $3, $4, $5)
           on conflict (comment_id, resource_id) do update set excerpt = excluded.excerpt`,
          [m.commentId, r.resource.id, m.author, new Date(m.postedAt), m.excerpt],
        );
      }
    });
    stats.mentions += a.mentions.length;

    const note = noteFor(a.featured);
    const [existing] = await db.query<{ id: string }>("select id from vouches where user_id = $1 and resource_id = $2", [curatorId, r.resource.id]);
    if (existing) {
      const u = await updateVouch({ userId: curatorId, vouchId: existing.id, note, topicSlugs: a.topics }, { db });
      if (u.ok) stats.updated++;
    } else {
      const v = await createVouch(
        { userId: curatorId, resourceId: r.resource.id, note, topicSlugs: a.topics },
        { db, now: () => new Date(a.latest) },
      );
      if (v.ok) stats.imported++;
    }
  }

  const imported = aggs.filter((a) => resourceIds.has(a.videoId));
  const byVideo = new Map(imported.map((a) => [a.videoId, a]));
  const plans = planLists(imported, topics, opts.period);
  // Lists pages sort newest first. Stamp the plan's order into created_at, so "Hacker News Vouched"
  // leads and topic lists follow largest first, on the first import and on every re-import.
  const base = (deps.now?.() ?? new Date()).getTime();
  for (const [i, plan] of plans.entries()) {
    const items = plan.videoIds.map((id) => ({ resourceId: resourceIds.get(id)!, note: noteFor(byVideo.get(id)!.featured) }));
    const createdAt = new Date(base - i * 1000);
    await db.transaction(async (tx) => {
      const [list] = await tx.query<{ id: string }>(
        `insert into lists (owner_id, title, description, is_public, system_key, created_at)
         values ($1, $2, $3, true, $4, $5)
         on conflict (system_key) where system_key is not null
         do update set title = excluded.title, description = excluded.description, created_at = excluded.created_at
         returning id`,
        [curatorId, plan.title, plan.description, plan.key, createdAt],
      );
      await tx.query("delete from list_items where list_id = $1", [list.id]);
      await tx.query(
        `insert into list_items (list_id, resource_id, position, note)
         select $1, x.resource_id, x.pos - 1, x.note
         from unnest($2::uuid[], $3::text[]) with ordinality as x(resource_id, note, pos)`,
        [list.id, items.map((i) => i.resourceId), items.map((i) => i.note)],
      );
    });
    stats.lists.push({ key: plan.key, title: plan.title, items: items.length });
  }
  return stats;
}

export type HnMentionView = { commentId: number; author: string; postedAt: Date; excerpt: string | null; url: string };

/** For the watch page: how many HN commenters recommended this video, and the latest few. */
export async function hnMentionsFor(db: Db, resourceId: string, limit = 5): Promise<{ total: number; mentions: HnMentionView[] }> {
  const rows = await db.query<{ comment_id: string; author: string; posted_at: Date; excerpt: string | null; total: number }>(
    `select comment_id::text, author, posted_at, excerpt, count(*) over ()::int as total
     from hn_mentions where resource_id = $1
     order by (excerpt is not null) desc, posted_at desc limit $2`,
    [resourceId, limit],
  );
  return {
    total: rows[0]?.total ?? 0,
    mentions: rows.map((r) => ({
      commentId: Number(r.comment_id),
      author: r.author,
      postedAt: r.posted_at,
      excerpt: r.excerpt,
      url: hnCommentUrl(Number(r.comment_id)),
    })),
  };
}
