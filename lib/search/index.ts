import type { Db } from "@/lib/db";
import { applyRules, listRules } from "@/lib/rules";
import { loadTopics } from "@/lib/topics";

/**
 * Search vouched resources (plan 16): title, topic, curator, note, list. Postgres full-text
 * search first; embeddings only if they prove better (plan 20).
 */

export const SEARCH_LIMIT = 20;
const MAX_TERMS = 8;

/**
 * Builds a safe prefix tsquery: "GPU sched" -> "gpu:* & sched:*".
 * Only letters and digits survive, so user input can never inject tsquery syntax.
 */
export function toPrefixQuery(input: string): string | null {
  const terms = input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, MAX_TERMS);
  if (!terms.length) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

export type ParsedQuery = { text: string; curator: string | null; circleOnly: boolean };

/** Pulls "@username" out of the query as a curator filter. */
export function parseQuery(raw: string, circleOnly = false): ParsedQuery {
  let curator: string | null = null;
  const text = raw
    .replace(/(^|\s)@([a-z0-9_]{3,24})\b/gi, (_m, pre, name) => {
      curator ??= name.toLowerCase();
      return pre;
    })
    .trim();
  return { text, curator, circleOnly };
}

export type SearchResult = {
  resourceId: string;
  title: string;
  creatorName: string | null;
  durationS: number | null;
  thumbnailUrl: string | null;
  vouchCount: number;
  circleVouchers: string[];
  topics: string[];
  topNote: { text: string; by: string } | null;
  rank: number;
};

export type ListResult = { id: string; title: string; ownerName: string; itemCount: number };

export type SearchResponse = {
  results: SearchResult[];
  lists: ListResult[];
  hiddenByRules: number;
  query: ParsedQuery;
};

export async function search(
  db: Db,
  viewerId: string,
  raw: string,
  opts: { circleOnly?: boolean; topic?: string | null } = {},
): Promise<SearchResponse> {
  const query = parseQuery(raw, opts.circleOnly ?? false);
  const tsq = toPrefixQuery(query.text);
  const empty = { results: [], lists: [], hiddenByRules: 0, query };
  if (!tsq && !query.curator && !opts.topic) return empty;

  const topics = await loadTopics(db);
  let topicIds: number[] | null = null;
  if (opts.topic) {
    const root = topics.bySlug.get(opts.topic);
    if (!root) return empty;
    topicIds = [...topics.byId.values()].filter((t) => topics.lineage(t.id).includes(root.slug)).map((t) => t.id);
  }

  const rows = await db.query<{
    id: string; title: string; creator_name: string | null; creator_external_id: string | null;
    duration_s: number | null; thumbnail_url: string | null; is_short: boolean;
    vouch_count: number; circle_vouchers: string[] | null; topic_ids: number[] | null;
    top_note: string | null; top_note_by: string | null; rank: number;
  }>(
    `with docs as (
       select r.id, r.title, r.creator_name, r.creator_external_id, r.duration_s, r.thumbnail_url, r.is_short,
              count(distinct v.id)::int as vouch_count,
              array_agg(distinct u.display_name) filter (where f.followee_id is not null) as circle_vouchers,
              array_agg(distinct vt.topic_id) filter (where vt.topic_id is not null) as topic_ids,
              bool_or(u.username = $3) as by_curator,
              setweight(to_tsvector('english', r.title), 'A') ||
              setweight(to_tsvector('english', coalesce(r.creator_name, '')), 'B') ||
              setweight(to_tsvector('english', coalesce(string_agg(distinct t.name, ' '), '')), 'B') ||
              setweight(to_tsvector('english', coalesce(string_agg(distinct v.note, ' '), '')), 'C') ||
              setweight(to_tsvector('simple', string_agg(distinct u.display_name || ' ' || u.username, ' ')), 'C') as doc
       from resources r
       join vouches v on v.resource_id = r.id
       join users u on u.id = v.user_id
       left join follows f on f.follower_id = $1 and f.followee_id = v.user_id
       left join vouch_topics vt on vt.vouch_id = v.id
       left join topics t on t.id = vt.topic_id
       where r.metadata_status <> 'unavailable'
       group by r.id
     )
     select d.id, d.title, d.creator_name, d.creator_external_id, d.duration_s, d.thumbnail_url, d.is_short,
            d.vouch_count, d.circle_vouchers, d.topic_ids,
            n.note as top_note, n.display_name as top_note_by,
            (case when $2::text is null then 1 else ts_rank(d.doc, to_tsquery('english', $2)) end)
              * (1 + 0.5 * ln(1 + coalesce(cardinality(d.circle_vouchers), 0)))
              * (1 + 0.1 * ln(d.vouch_count)) as rank
     from docs d
     left join lateral (
       select v.note, u.display_name from vouches v join users u on u.id = v.user_id
       left join follows f on f.follower_id = $1 and f.followee_id = v.user_id
       where v.resource_id = d.id and v.note is not null
       order by (f.followee_id is not null) desc, v.created_at desc limit 1
     ) n on true
     where ($2::text is null or d.doc @@ to_tsquery('english', $2))
       and ($3::text is null or d.by_curator)
       and (not $4::boolean or d.circle_vouchers is not null)
       and ($5::int[] is null or d.topic_ids && $5::int[])
     order by rank desc, d.vouch_count desc, d.id
     limit 100`,
    [viewerId, tsq, query.curator, query.circleOnly, topicIds],
  );

  const rules = await listRules(db, viewerId);
  const { kept, removed } = applyRules(
    rows.map((r) => ({
      ...r,
      resourceId: r.id,
      creatorId: r.creator_external_id,
      creatorName: r.creator_name,
      durationS: r.duration_s,
      isShort: r.is_short,
      topicSlugs: [...new Set((r.topic_ids ?? []).flatMap((id) => topics.lineage(id)))],
    })),
    rules,
  );

  const results: SearchResult[] = kept.slice(0, SEARCH_LIMIT).map((r) => ({
    resourceId: r.id,
    title: r.title,
    creatorName: r.creator_name,
    durationS: r.duration_s,
    thumbnailUrl: r.thumbnail_url,
    vouchCount: r.vouch_count,
    circleVouchers: (r.circle_vouchers ?? []).sort(),
    topics: (r.topic_ids ?? []).map((id) => topics.byId.get(id)?.name ?? "").filter(Boolean).sort(),
    topNote: r.top_note ? { text: r.top_note, by: r.top_note_by ?? "" } : null,
    rank: r.rank,
  }));

  const lists = tsq
    ? await db.query<ListResult>(
        `select l.id, l.title, u.display_name as "ownerName",
                (select count(*)::int from list_items li where li.list_id = l.id) as "itemCount"
         from lists l join users u on u.id = l.owner_id
         where (l.is_public or l.owner_id = $1)
           and to_tsvector('english', l.title || ' ' || coalesce(l.description, '')) @@ to_tsquery('english', $2)
         order by ts_rank(to_tsvector('english', l.title || ' ' || coalesce(l.description, '')), to_tsquery('english', $2)) desc
         limit 5`,
        [viewerId, tsq],
      )
    : [];

  return { results, lists, hiddenByRules: removed.length, query };
}
