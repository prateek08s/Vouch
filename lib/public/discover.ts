import type { Db } from "@/lib/db";
import { applyRules, listRules } from "@/lib/rules";
import { loadTopics } from "@/lib/topics";
import { hnCommentUrl } from "@/lib/hn/import";
import type { PublicPick } from "./index";

export const DISCOVER_PAGE = 12;
/** Ratings count as "recent" for this long. */
export const RECENT_DAYS = 30;
/** A human vouch's pull halves every two weeks; imported picks hold a floor. */
const HALF_LIFE_H = 24 * 14;
const EVERGREEN = 0.3;

/** Length buckets for the Discover filter, in seconds. */
export const LENGTHS = {
  short: { label: "Under 20 min", min: 0, max: 20 * 60 },
  medium: { label: "20–60 min", min: 20 * 60, max: 60 * 60 },
  long: { label: "Over 1 hour", min: 60 * 60, max: null },
} as const;
export type LengthKey = keyof typeof LENGTHS;
export const SORTS = { top: "Most recommended", newest: "Newest", shortest: "Shortest first" } as const;
export type SortKey = keyof typeof SORTS;
export const isLength = (v: string): v is LengthKey => v in LENGTHS;
export const isSort = (v: string): v is SortKey => v in SORTS;

export type DiscoverPick = PublicPick & {
  creatorName: string | null;
  durationS: number | null;
  people: number;
  recentWorth: number;
};

/**
 * Discover: the best of every public vouch, not only people you follow.
 *   score = (1 + 2 x recent Worth-it ratings) x (1 + ln(1 + distinct recommenders)) x freshness
 * Recommenders = people who vouched plus distinct Hacker News commenters. A signed-in viewer's
 * rules apply here as everywhere; their own vouches and rated videos are left out.
 */
export async function discoverPicks(
  db: Db,
  viewerId: string | null,
  opts: {
    topic?: string | null; cursor?: number; limit?: number; now?: Date;
    length?: LengthKey | null; sort?: SortKey;
  } = {},
): Promise<{ picks: DiscoverPick[]; nextCursor: number | null; hiddenByRules: number }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DISCOVER_PAGE;
  const cursor = Math.max(0, opts.cursor ?? 0);
  const topics = await loadTopics(db);
  let topicIds: number[] | null = null;
  if (opts.topic) {
    const root = topics.bySlug.get(opts.topic);
    if (!root) return { picks: [], nextCursor: null, hiddenByRules: 0 };
    topicIds = [...topics.byId.values()].filter((t) => topics.lineage(t.id).includes(root.slug)).map((t) => t.id);
  }
  const len = opts.length ? LENGTHS[opts.length] : null;
  const order = { top: "s.score desc", newest: "s.latest_any desc", shortest: "r.duration_s asc nulls last" }[opts.sort ?? "top"];
  const rows = await db.query<{
    id: string; title: string; canonical_url: string; thumbnail_url: string | null; creator_name: string | null;
    creator_external_id: string | null; duration_s: number | null; is_short: boolean;
    note: string | null; curator: string; username: string; people: number; recent_worth: number; topic_ids: number[];
    hn_author: string | null; hn_comment: string | null; hn_posted: Date | null; hn_total: number;
  }>(
    `with base as (
       select r.id,
              count(distinct v.user_id) filter (where not u.is_system)::int as humans,
              (select count(distinct hm.author)::int from hn_mentions hm where hm.resource_id = r.id) as commenters,
              max(v.created_at) filter (where not u.is_system) as latest_human,
              greatest(max(v.created_at), (select max(hm.posted_at) from hn_mentions hm where hm.resource_id = r.id)) as latest_any,
              array_agg(distinct vt.topic_id) filter (where vt.topic_id is not null) as topic_ids
       from resources r
       join vouches v on v.resource_id = r.id and v.hidden_at is null
       join users u on u.id = v.user_id
       left join vouch_topics vt on vt.vouch_id = v.id
       where r.metadata_status <> 'unavailable'
         and ($5::int is null or r.duration_s >= $5) and ($6::int is null or r.duration_s < $6)
         and ($2::uuid is null or not exists (select 1 from vouches mine where mine.user_id = $2 and mine.resource_id = r.id))
         and ($2::uuid is null or not exists (select 1 from ratings x where x.user_id = $2 and x.resource_id = r.id))
       group by r.id
     ),
     scored as (
       select b.*,
              (select count(*)::int from ratings x where x.resource_id = b.id and x.worth_it and x.updated_at > $3) as recent_worth,
              (1 + 2 * (select count(*) from ratings x where x.resource_id = b.id and x.worth_it and x.updated_at > $3))
                * (1 + ln(1 + b.humans + b.commenters))
                * greatest(${EVERGREEN}, case when b.latest_human is null then 0
                    else power(0.5, extract(epoch from ($4::timestamptz - b.latest_human)) / 3600 / ${HALF_LIFE_H}) end) as score
       from base b
       where $1::int[] is null or b.topic_ids && $1::int[]
     )
     select r.id, r.title, r.canonical_url, r.thumbnail_url, r.creator_name, r.creator_external_id, r.duration_s, r.is_short,
            n.note, n.curator, n.username, (s.humans + s.commenters)::int as people, s.recent_worth,
            coalesce(s.topic_ids, '{}') as topic_ids,
            hm.author as hn_author, hm.comment_id::text as hn_comment, hm.posted_at as hn_posted,
            (select count(*)::int from hn_mentions x where x.resource_id = s.id) as hn_total
     from scored s
     join resources r on r.id = s.id
     cross join lateral (
       select v.note, u.display_name as curator, u.username, u.is_system
       from vouches v join users u on u.id = v.user_id
       where v.resource_id = s.id and v.hidden_at is null
       order by (v.note is not null) desc, u.is_system, v.created_at desc limit 1
     ) n
     -- Credit the commenter whose words are the note (the importer quotes the longest reason).
     left join lateral (
       select m.author, m.comment_id, m.posted_at from hn_mentions m
       where n.is_system and m.resource_id = s.id
       order by (m.excerpt = n.note) desc nulls last, char_length(m.excerpt) desc nulls last, m.posted_at desc
       limit 1
     ) hm on true
     order by ${order}, s.score desc, s.id
     limit 400`,
    [topicIds, viewerId, new Date(now.getTime() - RECENT_DAYS * 86_400_000), now, len?.min || null, len?.max ?? null],
  );
  const rules = viewerId ? await listRules(db, viewerId) : [];
  const { kept, removed } = applyRules(
    rows.map((r) => ({
      ...r,
      resourceId: r.id,
      creatorId: r.creator_external_id,
      creatorName: r.creator_name,
      durationS: r.duration_s,
      isShort: r.is_short,
      topicSlugs: [...new Set(r.topic_ids.flatMap((id) => topics.lineage(id)))],
    })),
    rules,
  );
  const page = kept.slice(cursor, cursor + limit);
  return {
    picks: page.map((r) => ({
      id: r.id, title: r.title, canonical_url: r.canonical_url, thumbnail_url: r.thumbnail_url, note: r.note,
      curator: r.curator, username: r.username, creatorName: r.creator_name, durationS: r.duration_s,
      people: r.people, recentWorth: r.recent_worth,
      hn: r.hn_author && r.hn_comment && r.hn_posted
        ? { author: r.hn_author, url: hnCommentUrl(Number(r.hn_comment)), postedAt: r.hn_posted, total: r.hn_total }
        : null,
    })),
    nextCursor: cursor + limit < kept.length ? cursor + limit : null,
    hiddenByRules: removed.length,
  };
}
