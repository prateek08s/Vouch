import { beforeEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import { followList, getList, listsFor, upNextFromLists } from "@/lib/lists";
import { getWatchData } from "@/lib/watch";
import { createRule } from "@/lib/rules";
import { createVouch, remainingVouchesToday } from "@/lib/vouches";
import { user } from "@/lib/test/fixtures";
import type { MetadataProvider, MetadataResult } from "@/lib/youtube/metadata";
import { aggregate, type TopicInfo } from "./aggregate";
import type { CommentVerdict } from "./classify";
import { HN_USERNAME, hnMentionsFor, importHn } from "./import";

let db: Db;
let topics: TopicInfo[];

/** Answers for any 11-char ID; IDs starting with "gone" or "noembed" fail like YouTube would. */
function fakeYouTube(): MetadataProvider & { calls: string[] } {
  const p: MetadataProvider & { calls: string[] } = {
    calls: [],
    async fetch(id): Promise<MetadataResult> {
      p.calls.push(id);
      if (id.startsWith("gone")) return { ok: false, error: "video_not_found" };
      if (id.startsWith("noembed")) return { ok: false, error: "not_embeddable" };
      return {
        ok: true,
        metadata: {
          videoId: id, title: `Talk ${id}`, channelId: `UC_${id.slice(0, 3)}`, channelName: `Channel ${id.slice(0, 3)}`,
          durationSeconds: 1800, thumbnailUrl: null, publishedAt: null, completeness: "ok",
        },
      };
    },
  };
  return p;
}

let seq = 0;
/** A distinct 11-character video ID that keeps its prefix (the fake YouTube keys off it). */
const vid = (prefix: string) => `${prefix}${String(++seq).padStart(11 - prefix.length, "0")}`;
function verdict(author: string, postedAt: string, videoId: string, topicSlugs: string[], excerpt: string | null = null): CommentVerdict {
  return { commentId: ++seq + 1000, author, postedAt, videos: [{ videoId, recommends: true, excerpt, topics: topicSlugs }] };
}

beforeEach(async () => {
  db = await openPglite();
  topics = await db.query<TopicInfo>(
    `select t.slug, t.name, p.slug as "parentSlug" from topics t left join topics p on p.id = t.parent_topic_id`,
  );
});

async function hnUser() {
  const [u] = await db.query<{ id: string; is_system: boolean; trust_tier: string }>("select id, is_system, trust_tier from users where username = $1", [HN_USERNAME]);
  return u;
}

describe("importHn", () => {
  it("creates one labeled system curator, even when run twice", async () => {
    await importHn([], topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    await importHn([], topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    const rows = await db.query<{ display_name: string; is_system: boolean }>("select display_name, is_system from users where username = $1", [HN_USERNAME]);
    expect(rows).toEqual([{ display_name: "Hacker News", is_system: true }]);
  });

  it("vouches once per video with the quoted reason, topics and the latest comment's date", async () => {
    const id = vid("gpu");
    const aggs = aggregate([
      verdict("alice", "2025-02-01T10:00:00Z", id, ["gpu"], "the best intro to GPU scheduling"),
      verdict("bob", "2025-06-01T10:00:00Z", id, ["gpu", "hardware"]),
    ]);
    const stats = await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(stats).toMatchObject({ videos: 1, imported: 1, updated: 0, mentions: 2, skipped: {} });

    const [v] = await db.query<{ note: string; created_at: Date; topics: string[] }>(
      `select v.note, v.created_at, array_agg(t.slug order by t.slug) as topics
       from vouches v join users u on u.id = v.user_id join vouch_topics vt on vt.vouch_id = v.id join topics t on t.id = vt.topic_id
       where u.username = $1 group by v.id`,
      [HN_USERNAME],
    );
    expect(v.note).toBe("the best intro to GPU scheduling");
    expect(v.created_at.toISOString()).toBe("2025-06-01T10:00:00.000Z");
    expect(v.topics).toEqual(["gpu", "hardware"]);
  });

  it("records every recommending comment with a link back to it", async () => {
    const id = vid("rec");
    const aggs = aggregate([verdict("alice", "2025-02-01T00:00:00Z", id, ["ai"], "worth every minute"), verdict("bob", "2025-03-01T00:00:00Z", id, ["ai"])]);
    await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    const [{ id: resourceId }] = await db.query<{ id: string }>("select id from resources where external_id = $1", [id]);
    const { total, mentions } = await hnMentionsFor(db, resourceId);
    expect(total).toBe(2);
    // Mentions with a quoted reason come first.
    expect(mentions.map((m) => [m.author, m.excerpt])).toEqual([["alice", "worth every minute"], ["bob", null]]);
    expect(mentions[0].url).toBe(`https://news.ycombinator.com/item?id=${mentions[0].commentId}`);
  });

  it("keeps both videos when one comment recommends two (found in the real January data)", async () => {
    const [a, b] = [vid("two"), vid("two")];
    const comment: CommentVerdict = {
      commentId: 424242, author: "both", postedAt: "2025-01-05T00:00:00Z",
      videos: [
        { videoId: a, recommends: true, excerpt: "first is great", topics: ["ai"] },
        { videoId: b, recommends: true, excerpt: "second too", topics: ["ai"] },
      ],
    };
    const stats = await importHn(aggregate([comment]), topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from hn_mentions where comment_id = 424242");
    expect(n).toBe(2);
    expect(stats.mentions).toBe(2);
    for (const id of [a, b]) {
      const [{ id: resourceId }] = await db.query<{ id: string }>("select id from resources where external_id = $1", [id]);
      expect((await hnMentionsFor(db, resourceId)).total).toBe(1);
    }
  });

  it("skips videos with no Vouch topic or that YouTube no longer serves, and says why", async () => {
    const aggs = aggregate([
      verdict("a", "2025-01-01T00:00:00Z", vid("ok"), ["ai"]),
      verdict("b", "2025-01-01T00:00:00Z", vid("music"), []),
      verdict("c", "2025-01-01T00:00:00Z", vid("gone"), ["ai"]),
      verdict("d", "2025-01-01T00:00:00Z", vid("noembed"), ["ai"]),
    ]);
    const stats = await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(stats.imported).toBe(1);
    expect(stats.skipped).toEqual({ no_topic: 1, video_not_found: 1, not_embeddable: 1 });
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from hn_mentions");
    expect(n).toBe(1);
  });

  it("is not limited to 10 vouches a day, and does not count as user activity", async () => {
    const aggs = aggregate(Array.from({ length: 30 }, (_, i) => verdict(`u${i}`, "2025-03-01T00:00:00Z", vid("bulk"), ["ai"])));
    const stats = await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(stats.imported).toBe(30);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from events where name in ('vouch_created', 'signup')");
    expect(n).toBe(0);
  });

  it("still enforces the daily limit for people", async () => {
    const person = await user(db, "person", "new");
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const [r] = await db.query<{ id: string }>(
        "insert into resources (source, external_id, canonical_url, title) values ('youtube', $1, 'u', 't') returning id",
        [vid("lim")],
      );
      ids.push(r.id);
    }
    const results = [];
    for (const id of ids) results.push(await createVouch({ userId: person, resourceId: id, topicSlugs: ["ai"] }, { db }));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results[5]).toEqual({ ok: false, error: "daily_limit_reached" });
    expect(await remainingVouchesToday(db, person)).toBe(0);
  });

  it("looks up each new video once, and skips lookups for videos Vouch already has", async () => {
    const id = vid("once");
    const yt = fakeYouTube();
    const aggs = aggregate([verdict("a", "2025-01-01T00:00:00Z", id, ["ai"]), verdict("b", "2025-01-02T00:00:00Z", id, ["ai"])]);
    await importHn(aggs, topics, { period: "2025" }, { db, metadata: yt });
    expect(yt.calls).toEqual([id]);
    await importHn(aggs, topics, { period: "2025" }, { db, metadata: yt });
    expect(yt.calls).toEqual([id]);
  });

  it("re-running updates in place instead of duplicating anything", async () => {
    const ids = Array.from({ length: 10 }, () => vid("re"));
    const first = aggregate(ids.map((id, i) => verdict(`u${i}`, "2025-01-01T00:00:00Z", id, ["pure-math"])));
    await importHn(first, topics, { period: "2025" }, { db, metadata: fakeYouTube() });

    // Second run: a new reason for the first video, same comments otherwise.
    const second = first.map((a, i) =>
      i === 0 ? { ...a, featured: { ...a.mentions[0], excerpt: "now with a reason" }, mentions: [{ ...a.mentions[0], excerpt: "now with a reason" }] } : a,
    );
    const stats = await importHn(second, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(stats).toMatchObject({ imported: 0, updated: 10 });

    const counts = await db.query<{ t: string; n: number }>(
      `select 'vouches' t, count(*)::int n from vouches union all select 'mentions', count(*)::int from hn_mentions
       union all select 'lists', count(*)::int from lists union all select 'items', count(*)::int from list_items`,
    );
    // 2 lists: Hacker News Vouched and Pure Math (10 videos >= the minimum). Mathematics is top-level, so no list.
    expect(Object.fromEntries(counts.map((c) => [c.t, c.n]))).toEqual({ vouches: 10, mentions: 10, lists: 2, items: 20 });
    const [{ note }] = await db.query<{ note: string }>("select note from vouches v join resources r on r.id = v.resource_id where r.external_id = $1", [ids[0]]);
    expect(note).toBe("now with a reason");
  });

  it("builds public lists in rank order, with the quoted reasons as item notes", async () => {
    const top = vid("top");
    const rest = Array.from({ length: 8 }, () => vid("gpu"));
    const aggs = aggregate([
      verdict("a", "2025-01-01T00:00:00Z", top, ["gpu"], "changed how I think about GPUs"),
      verdict("b", "2025-01-02T00:00:00Z", top, ["gpu"]),
      ...rest.map((id, i) => verdict(`r${i}`, `2025-02-0${i + 1}T00:00:00Z`, id, ["gpu"])),
    ]);
    const stats = await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(stats.lists.map((l) => [l.title, l.items])).toEqual([
      ["Hacker News Vouched", 9],
      ["Hacker News: GPU", 9],
      ["Hacker News: Hardware", 9],
    ]);

    const viewer = await user(db, "viewer");
    const [{ id: listId }] = await db.query<{ id: string }>("select id from lists where system_key = 'hn:vouched'");
    const view = await getList(db, viewer, listId);
    expect(view?.list.is_public).toBe(true);
    expect(view?.owner.username).toBe(HN_USERNAME);
    expect(view?.items[0]).toMatchObject({ title: `Talk ${top}`, note: "changed how I think about GPUs" });
    // Newest single recommendation next.
    expect(view?.items[1].title).toBe(`Talk ${rest[7]}`);
  });

  it("shows Hacker News Vouched first on the Lists page, then topic lists largest first, even after a re-import", async () => {
    const gpu = Array.from({ length: 10 }, () => vid("ord"));
    const math = Array.from({ length: 8 }, () => vid("ord"));
    const aggs = aggregate([
      ...gpu.map((id, i) => verdict(`g${i}`, "2025-01-01T00:00:00Z", id, ["gpu"])),
      ...math.map((id, i) => verdict(`m${i}`, "2025-01-01T00:00:00Z", id, ["pure-math"])),
    ]);
    const viewer = await user(db, "browser");
    const order = async () => (await listsFor(db, viewer)).discover.map((l) => l.title);
    await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    const expected = ["Hacker News Vouched", "Hacker News: GPU", "Hacker News: Hardware", "Hacker News: Pure Math"];
    expect(await order()).toEqual(expected);
    await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(await order()).toEqual(expected);
  });

  it("does not count the Hacker News curator as a person outside your circle", async () => {
    const id = vid("cnt");
    await importHn(aggregate([verdict("a", "2025-01-01T00:00:00Z", id, ["ai"], "great")]), topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    const [{ id: resourceId }] = await db.query<{ id: string }>("select id from resources where external_id = $1", [id]);
    const viewer = await user(db, "watcher");
    const priya = await user(db, "priya_c", "founding");
    expect((await getWatchData(db, viewer, resourceId, null))?.publicVouchCount).toBe(0);
    await createVouch({ userId: priya, resourceId, topicSlugs: ["ai"] }, { db });
    expect((await getWatchData(db, viewer, resourceId, null))?.publicVouchCount).toBe(1);
    // Following Hacker News puts its note on the page, so it counts like any shown note.
    const [{ id: hn }] = await db.query<{ id: string }>("select id from users where username = $1", [HN_USERNAME]);
    await db.query("insert into follows (follower_id, followee_id) values ($1, $2)", [viewer, hn]);
    const w = await getWatchData(db, viewer, resourceId, null);
    expect(w?.notes.map((n) => n.curatorName)).toEqual(["Hacker News"]);
    expect((w?.publicVouchCount ?? 0) - (w?.notes.length ?? 0)).toBe(1);
  });

  it("respects the viewer's rules when they follow a Hacker News list", async () => {
    const blocked = vid("blk");
    const fine = vid("fin");
    const aggs = aggregate([
      verdict("a", "2025-01-02T00:00:00Z", blocked, ["ai"]),
      verdict("b", "2025-01-01T00:00:00Z", fine, ["ai"]),
    ]);
    await importHn(aggs, topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    const viewer = await user(db, "ruler");
    const [{ id: listId }] = await db.query<{ id: string }>("select id from lists where system_key = 'hn:vouched'");
    expect((await followList(db, viewer, listId)).ok).toBe(true);
    expect((await upNextFromLists(db, viewer))[0].item.title).toBe(`Talk ${blocked}`);

    const [{ creator_external_id }] = await db.query<{ creator_external_id: string }>("select creator_external_id from resources where external_id = $1", [blocked]);
    expect((await createRule(db, viewer, "channel", creator_external_id)).ok).toBe(true);
    const [next] = await upNextFromLists(db, viewer);
    expect(next.item.title).toBe(`Talk ${fine}`);
    expect(next.hiddenByRules).toBe(1);
  });
});

describe("system curator safety", () => {
  it("is marked as a system account so sign-in can refuse it", async () => {
    await importHn([], topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(await hnUser()).toMatchObject({ is_system: true });
    const signable = await db.query("select 1 from users where username = $1 and not is_system", [HN_USERNAME]);
    expect(signable).toEqual([]);
  });

  it("takes over an existing 'hackernews' row as a system account instead of failing", async () => {
    await user(db, HN_USERNAME);
    await importHn([], topics, { period: "2025" }, { db, metadata: fakeYouTube() });
    expect(await hnUser()).toMatchObject({ is_system: true });
  });
});
