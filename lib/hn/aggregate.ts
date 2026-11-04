import type { CommentVerdict } from "./classify";

/**
 * Step 3 of the Hacker News import: from per-comment verdicts to one record per video.
 * Pure, so the ranking and list rules are unit tested without a database.
 */

export type Mention = { commentId: number; author: string; postedAt: string; excerpt: string | null; topics: string[] };

export type VideoAggregate = {
  videoId: string;
  /** One per distinct commenter, newest first. */
  mentions: Mention[];
  /** Distinct people who recommended it: the ranking signal (HN comments have no public score). */
  recommenders: number;
  latest: string;
  /** Up to 3 topics by how many commenters' comments were tagged with each. */
  topics: string[];
  /** The mention whose words become the Vouch note, or null when nobody gave a reason. */
  featured: Mention | null;
};

export const MAX_TOPICS = 3;

/** Better mention from the same person: one with a reason beats one without, then the longer reason, then the earlier comment. */
function better(a: Mention, b: Mention): Mention {
  const la = a.excerpt?.length ?? -1;
  const lb = b.excerpt?.length ?? -1;
  if (la !== lb) return la > lb ? a : b;
  return a.postedAt <= b.postedAt ? a : b;
}

export function aggregate(verdicts: CommentVerdict[]): VideoAggregate[] {
  const byVideo = new Map<string, Map<string, Mention>>();
  for (const v of verdicts) {
    for (const video of v.videos) {
      if (!video.recommends) continue;
      const m: Mention = { commentId: v.commentId, author: v.author, postedAt: v.postedAt, excerpt: video.excerpt, topics: video.topics };
      const people = byVideo.get(video.videoId) ?? new Map<string, Mention>();
      const prev = people.get(v.author);
      people.set(v.author, prev ? better(prev, m) : m);
      byVideo.set(video.videoId, people);
    }
  }

  const out: VideoAggregate[] = [];
  for (const [videoId, people] of byVideo) {
    const mentions = [...people.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.commentId - b.commentId);
    const votes = new Map<string, { n: number; first: number }>();
    mentions.forEach((m, i) =>
      m.topics.forEach((t, j) => {
        const cur = votes.get(t);
        // Earlier mention and earlier position (models list the most specific topic first) break ties.
        votes.set(t, { n: (cur?.n ?? 0) + 1, first: Math.min(cur?.first ?? Infinity, i * 10 + j) });
      }),
    );
    const topics = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).slice(0, MAX_TOPICS).map(([t]) => t);
    const withReason = mentions.filter((m) => m.excerpt);
    const featured = withReason.length ? withReason.reduce((best, m) => ((m.excerpt!.length > best.excerpt!.length) ? m : best)) : null;
    out.push({ videoId, mentions, recommenders: mentions.length, latest: mentions[0].postedAt, topics, featured });
  }
  return out.sort(rankOrder);
}

/** More recommenders first, then videos with a quoted reason, then the most recently recommended. */
export function rankOrder(a: VideoAggregate, b: VideoAggregate): number {
  return (
    b.recommenders - a.recommenders ||
    Number(!!b.featured) - Number(!!a.featured) ||
    b.latest.localeCompare(a.latest) ||
    a.videoId.localeCompare(b.videoId)
  );
}

/**
 * The Vouch note: the commenter's own words, unchanged. Every page already shows notes in
 * quotation marks credited to the curator ("Hacker News"); the watch page names each commenter
 * and links to their comment.
 */
export function noteFor(m: Mention | null): string | null {
  if (!m?.excerpt) return null;
  return m.excerpt.length <= 280 ? m.excerpt : null;
}

export type TopicInfo = { slug: string; name: string; parentSlug: string | null };

export type PlannedList = { key: string; title: string; description: string; videoIds: string[] };

export const LIST_SIZE = 100;
export const TOPIC_LIST_SIZE = 50;
export const MIN_TOPIC_LIST_SIZE = 8;
export const MAX_TOPIC_LISTS = 20;

/**
 * The public lists (plan section 10): "Hacker News Vouched" plus up to 20 topic lists.
 * A video counts toward its topics and their parents, so "Hardware" includes GPU videos.
 * Top-level topics (Technology, Science...) are too broad to be useful lists and are skipped.
 */
export function planLists(aggs: VideoAggregate[], topics: TopicInfo[], period: string): PlannedList[] {
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const lineage = (slug: string): string[] => {
    const out: string[] = [];
    for (let t = bySlug.get(slug); t && !out.includes(t.slug); t = t.parentSlug ? bySlug.get(t.parentSlug) : undefined) out.push(t.slug);
    return out;
  };
  const ranked = aggs.filter((a) => a.topics.length).sort(rankOrder);

  const lists: PlannedList[] = [{
    key: "hn:vouched",
    title: "Hacker News Vouched",
    description: `The YouTube videos Hacker News commenters recommended most in ${period}, ranked by how many different people recommended each one. Quotes link back to their comments.`,
    videoIds: ranked.slice(0, LIST_SIZE).map((a) => a.videoId),
  }];

  const perTopic = new Map<string, string[]>();
  for (const a of ranked) {
    const slugs = new Set(a.topics.flatMap(lineage));
    for (const s of slugs) perTopic.set(s, [...(perTopic.get(s) ?? []), a.videoId]);
  }
  const topicLists = [...perTopic.entries()]
    .filter(([slug, ids]) => bySlug.get(slug)?.parentSlug && ids.length >= MIN_TOPIC_LIST_SIZE)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_TOPIC_LISTS)
    .map(([slug, ids]) => {
      const name = bySlug.get(slug)!.name;
      return {
        key: `hn:topic:${slug}`,
        title: `Hacker News: ${name}`,
        description: `${name} videos Hacker News commenters recommended in ${period}, most recommended first.`,
        videoIds: ids.slice(0, TOPIC_LIST_SIZE),
      };
    });
  return [...lists, ...topicLists];
}
