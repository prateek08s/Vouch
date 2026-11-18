import type { Db } from "@/lib/db";
import { follow } from "@/lib/graph/follows";
import { followList } from "@/lib/lists";
import { loadTopics, type TopicIndex } from "@/lib/topics";

/**
 * Onboarding (plan 15.2): no 30-question survey.
 *   1. pick 3 to 5 topics
 *   2. a few "Which would you rather watch?" choices drawn from those topics
 *   3. five curators or lists to follow, each with the reason it was suggested
 *   4. straight into the Circle
 * The Taste Graph then learns from Worth It ratings, as for everyone else.
 */

export const MIN_TOPICS = 3;
export const MAX_TOPICS = 5;
export const MAX_PAIRS = 6;
export const SUGGESTION_COUNT = 5;
/** People make the Circle; lists fill the rest. */
export const MAX_CURATOR_SUGGESTIONS = 3;
/** A picked video says more about taste than a topic match. */
export const PICK_WEIGHT = 3;

export type OnboardingError = "too_few_topics" | "too_many_topics" | "unknown_topic";
export const ONBOARDING_ERROR_MESSAGES: Record<OnboardingError, string> = {
  too_few_topics: `Pick at least ${MIN_TOPICS} topics.`,
  too_many_topics: `Pick up to ${MAX_TOPICS} topics.`,
  unknown_topic: "One of those topics doesn't exist.",
};

export async function saveTopics(db: Db, userId: string, slugs: string[]): Promise<{ ok: true } | { ok: false; error: OnboardingError }> {
  const unique = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (unique.length < MIN_TOPICS) return { ok: false, error: "too_few_topics" };
  if (unique.length > MAX_TOPICS) return { ok: false, error: "too_many_topics" };
  const rows = await db.query<{ id: number }>("select id from topics where slug = any($1::text[])", [unique]);
  if (rows.length !== unique.length) return { ok: false, error: "unknown_topic" };
  await db.transaction(async (tx) => {
    await tx.query("delete from user_topics where user_id = $1", [userId]);
    await tx.query("insert into user_topics (user_id, topic_id) select $1, unnest($2::int[])", [userId, rows.map((r) => r.id)]);
  });
  return { ok: true };
}

export async function userTopicSlugs(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ slug: string }>(
    "select t.slug from user_topics ut join topics t on t.id = ut.topic_id where ut.user_id = $1 order by t.name",
    [userId],
  );
  return rows.map((r) => r.slug);
}

/** A chosen topic also covers everything under it: picking Hardware includes GPU videos. */
export function expandTopics(index: TopicIndex, slugs: string[]): number[] {
  const wanted = new Set(slugs);
  return [...index.byId.values()].filter((t) => index.lineage(t.id).some((s) => wanted.has(s))).map((t) => t.id);
}

export type ChoiceOption = {
  resourceId: string;
  title: string;
  thumbnailUrl: string | null;
  creatorName: string | null;
  durationS: number | null;
  curatorId: string;
  curatorName: string;
  note: string | null;
};

/**
 * Pairs two videos from different curators, so each choice says something about whose taste
 * fits; with a single curator, from different channels. Options arrive best first; each video is used once. Pure.
 */
export function makePairs(options: ChoiceOption[], max = MAX_PAIRS): [ChoiceOption, ChoiceOption][] {
  const pool = [...options];
  const pairs: [ChoiceOption, ChoiceOption][] = [];
  while (pool.length >= 2 && pairs.length < max) {
    const a = pool.shift()!;
    let j = pool.findIndex((b) => b.curatorId !== a.curatorId && b.resourceId !== a.resourceId);
    // One curator only (an import such as Hacker News): contrast channels instead, so the
    // choice still says something about taste.
    if (j === -1) j = pool.findIndex((b) => b.resourceId !== a.resourceId && b.creatorName !== a.creatorName);
    if (j === -1) continue;
    pairs.push([a, pool.splice(j, 1)[0]]);
  }
  return pairs;
}

export async function choicePairs(db: Db, userId: string): Promise<[ChoiceOption, ChoiceOption][]> {
  const index = await loadTopics(db);
  const topicIds = expandTopics(index, await userTopicSlugs(db, userId));
  if (!topicIds.length) return [];
  // One row per video: its best vouch (with a note, then newest). Notes make a choice meaningful.
  const rows = await db.query<{
    resource_id: string; title: string; thumbnail_url: string | null; creator_name: string | null;
    duration_s: number | null; curator_id: string; curator_name: string; note: string | null;
  }>(
    `select distinct on (r.id) r.id as resource_id, r.title, r.thumbnail_url, r.creator_name, r.duration_s,
            u.id as curator_id, u.display_name as curator_name, v.note, v.created_at
     from vouches v
     join users u on u.id = v.user_id
     join resources r on r.id = v.resource_id and r.metadata_status <> 'unavailable'
     where v.user_id <> $1
       and exists (select 1 from vouch_topics vt where vt.vouch_id = v.id and vt.topic_id = any($2::int[]))
     order by r.id, (v.note is not null) desc, v.created_at desc`,
    [userId, topicIds],
  );
  const options = rows
    .map((r) => ({
      resourceId: r.resource_id, title: r.title, thumbnailUrl: r.thumbnail_url, creatorName: r.creator_name,
      durationS: r.duration_s, curatorId: r.curator_id, curatorName: r.curator_name, note: r.note,
    }))
    // Deterministic and note-first, so the same person sees the same choices on reload.
    .sort((a, b) => Number(!!b.note) - Number(!!a.note) || a.resourceId.localeCompare(b.resourceId));
  return makePairs(options);
}

export type Suggestion = {
  kind: "curator" | "list";
  id: string;
  name: string;
  /** Why it was suggested, in plain words. */
  reason: string;
  score: number;
};

type Scored = { id: string; name: string; topicMatches: number; picked: number; topTopic: string | null };

function reasonFor(s: Scored, kind: Suggestion["kind"]): string {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  if (s.picked > 0) return kind === "curator" ? `Vouched for ${n(s.picked, "video")} you picked` : `Has ${n(s.picked, "video")} you picked`;
  const where = s.topTopic ? ` on ${s.topTopic}` : " in your topics";
  return kind === "curator" ? `Vouched for ${n(s.topicMatches, "video")}${where}` : `${n(s.topicMatches, "video")}${where}`;
}

/** Up to 3 people, the rest lists, 5 in all; whichever kind runs short, the other fills in. Pure. */
export function pickSuggestions(curators: Scored[], lists: Scored[], count = SUGGESTION_COUNT, maxCurators = MAX_CURATOR_SUGGESTIONS): Suggestion[] {
  const score = (s: Scored) => s.topicMatches + PICK_WEIGHT * s.picked;
  const rank = (xs: Scored[], kind: Suggestion["kind"]) =>
    xs
      .filter((s) => score(s) > 0)
      .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
      .map((s) => ({ kind, id: s.id, name: s.name, reason: reasonFor(s, kind), score: score(s) }));
  const c = rank(curators, "curator");
  const l = rank(lists, "list");
  const people = c.slice(0, Math.min(maxCurators, count));
  const fromLists = l.slice(0, count - people.length);
  const more = c.slice(people.length, people.length + (count - people.length - fromLists.length));
  return [...people, ...more, ...fromLists];
}

/**
 * Suggestions from the person's topics and picks. System curators (such as Hacker News) are not
 * suggested as people: their vouches are dated to the original comments, so they would add nothing
 * to the Circle. Their lists are suggested instead, which is how imported content reaches people.
 */
export async function suggestions(db: Db, userId: string, pickedResourceIds: string[]): Promise<Suggestion[]> {
  const index = await loadTopics(db);
  const topicIds = expandTopics(index, await userTopicSlugs(db, userId));
  const picked = pickedResourceIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));

  const curators = await db.query<{ id: string; name: string; topic_matches: number; picked: number; top_topic: string | null }>(
    `select u.id, u.display_name as name,
            count(distinct v.resource_id) filter (where vt.topic_id = any($2::int[]))::int as topic_matches,
            count(distinct v.resource_id) filter (where v.resource_id = any($3::uuid[]))::int as picked,
            (select t.name from vouches v2 join vouch_topics vt2 on vt2.vouch_id = v2.id join topics t on t.id = vt2.topic_id
             where v2.user_id = u.id and vt2.topic_id = any($2::int[]) group by t.name order by count(*) desc, t.name limit 1) as top_topic
     from users u
     join vouches v on v.user_id = u.id
     left join vouch_topics vt on vt.vouch_id = v.id
     where u.id <> $1 and not u.is_system
     group by u.id`,
    [userId, topicIds, picked],
  );
  const lists = await db.query<{ id: string; name: string; topic_matches: number; picked: number; top_topic: string | null }>(
    `select l.id, l.title as name,
            count(distinct li.resource_id) filter (where rt.topic_id = any($2::int[]))::int as topic_matches,
            count(distinct li.resource_id) filter (where li.resource_id = any($3::uuid[]))::int as picked,
            (select t.name from list_items li2 join resource_topics rt2 on rt2.resource_id = li2.resource_id join topics t on t.id = rt2.topic_id
             where li2.list_id = l.id and rt2.topic_id = any($2::int[]) group by t.name order by count(*) desc, t.name limit 1) as top_topic
     from lists l
     join list_items li on li.list_id = l.id
     left join resource_topics rt on rt.resource_id = li.resource_id
     where l.is_public and l.owner_id <> $1
     group by l.id`,
    [userId, topicIds, picked],
  );
  const toScored = (r: (typeof curators)[number]): Scored => ({ id: r.id, name: r.name, topicMatches: r.topic_matches, picked: r.picked, topTopic: r.top_topic });
  return pickSuggestions(curators.map(toScored), lists.map(toScored));
}

/** Follows what the person kept checked, marks onboarding done, and records it once. */
export async function completeOnboarding(
  db: Db,
  userId: string,
  choice: { curatorIds: string[]; listIds: string[] },
  now = new Date(),
): Promise<{ follows: number; lists: number }> {
  let follows = 0;
  let lists = 0;
  for (const id of new Set(choice.curatorIds)) {
    const [u] = await db.query<{ is_system: boolean }>("select is_system from users where id = $1", [id]);
    if (!u || u.is_system) continue;
    if ((await follow(db, userId, id)).ok) follows++;
  }
  for (const id of new Set(choice.listIds)) if ((await followList(db, userId, id)).ok) lists++;
  const done = await db.query(
    "update users set onboarded_at = $2 where id = $1 and onboarded_at is null returning 1",
    [userId, now],
  );
  if (done.length) {
    await db.query(
      "insert into events (user_id, name, props, created_at) values ($1, 'onboarding_complete', $2, $3)",
      [userId, JSON.stringify({ follows, lists, topics: (await userTopicSlugs(db, userId)).length }), now],
    );
  }
  return { follows, lists };
}
