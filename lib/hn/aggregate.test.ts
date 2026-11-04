import { describe, expect, it } from "vitest";
import { aggregate, noteFor, planLists, rankOrder, MIN_TOPIC_LIST_SIZE, type TopicInfo, type VideoAggregate } from "./aggregate";
import type { CommentVerdict } from "./classify";

let seq = 0;
function v(author: string, postedAt: string, videos: CommentVerdict["videos"]): CommentVerdict {
  return { commentId: ++seq, author, postedAt, videos };
}
const rec = (videoId: string, topics: string[], excerpt: string | null = null) => ({ videoId, recommends: true, excerpt, topics });
const no = (videoId: string) => ({ videoId, recommends: false, excerpt: null, topics: [] });

describe("aggregate", () => {
  it("ignores videos that were mentioned but not recommended", () => {
    expect(aggregate([v("a", "2025-01-01", [no("vidA")])])).toEqual([]);
  });

  it("counts each person once per video and keeps their best mention", () => {
    const aggs = aggregate([
      v("alice", "2025-01-01", [rec("vidA", ["ai"])]),
      v("alice", "2025-03-01", [rec("vidA", ["ai"], "short")]),
      v("alice", "2025-05-01", [rec("vidA", ["ai"], "a much longer reason")]),
      v("bob", "2025-02-01", [rec("vidA", ["ai"])]),
    ]);
    expect(aggs).toHaveLength(1);
    expect(aggs[0].recommenders).toBe(2);
    expect(aggs[0].mentions.map((m) => [m.author, m.excerpt])).toEqual([["alice", "a much longer reason"], ["bob", null]]);
    expect(aggs[0].latest).toBe("2025-05-01");
  });

  it("features the longest quoted reason, or nothing when nobody gave one", () => {
    const [withReason, without] = aggregate([
      v("a", "2025-01-01", [rec("vidA", ["ai"], "good"), rec("vidB", ["ai"])]),
      v("b", "2025-01-02", [rec("vidA", ["ai"], "the best explanation of attention")]),
    ]);
    expect(withReason.featured?.author).toBe("b");
    expect(without.featured).toBeNull();
  });

  it("chooses topics by vote, breaking ties by the order the first commenter gave", () => {
    const [a] = aggregate([
      v("a", "2025-01-03", [rec("vidA", ["gpu", "hardware", "ai"])]),
      v("b", "2025-01-02", [rec("vidA", ["ai", "llms"])]),
      v("c", "2025-01-01", [rec("vidA", ["llms", "pure-math"])]),
    ]);
    // ai and llms have 2 votes each; ai was listed by the newest mention, so it comes first.
    expect(a.topics).toEqual(["ai", "llms", "gpu"]);
  });

  it("ranks by recommenders, then quoted reason, then recency", () => {
    const aggs = aggregate([
      v("a", "2025-06-01", [rec("recent", ["ai"])]),
      v("b", "2025-01-01", [rec("old", ["ai"])]),
      v("c", "2025-01-01", [rec("quoted", ["ai"], "worth it")]),
      v("d", "2025-01-01", [rec("popular", ["ai"])]),
      v("e", "2025-01-01", [rec("popular", ["ai"])]),
    ]);
    expect(aggs.map((x) => x.videoId)).toEqual(["popular", "quoted", "recent", "old"]);
  });
});

describe("noteFor", () => {
  it("is the commenter's words, unchanged (pages add the quotation marks)", () => {
    expect(noteFor({ commentId: 1, author: "pg", postedAt: "", excerpt: "Watch this twice.", topics: [] })).toBe("Watch this twice.");
  });
  it("is null without a reason, and never exceeds the note limit", () => {
    expect(noteFor(null)).toBeNull();
    expect(noteFor({ commentId: 1, author: "pg", postedAt: "", excerpt: null, topics: [] })).toBeNull();
    expect(noteFor({ commentId: 1, author: "pg", postedAt: "", excerpt: "x".repeat(281), topics: [] })).toBeNull();
  });
});

describe("planLists", () => {
  const TOPICS: TopicInfo[] = [
    { slug: "technology", name: "Technology", parentSlug: null },
    { slug: "hardware", name: "Hardware", parentSlug: "technology" },
    { slug: "gpu", name: "GPU", parentSlug: "hardware" },
    { slug: "ai", name: "AI", parentSlug: "technology" },
    { slug: "mathematics", name: "Mathematics", parentSlug: null },
    { slug: "pure-math", name: "Pure Math", parentSlug: "mathematics" },
  ];
  const agg = (videoId: string, topics: string[], recommenders = 1): VideoAggregate => ({
    videoId, topics, recommenders, latest: "2025-01-01", featured: null,
    mentions: Array.from({ length: recommenders }, (_, i) => ({ commentId: i, author: `u${i}`, postedAt: "2025-01-01", excerpt: null, topics })),
  });
  const many = (n: number, topics: string[], prefix: string) => Array.from({ length: n }, (_, i) => agg(`${prefix}${i}`, topics));

  it("puts the most recommended videos with a topic in Hacker News Vouched", () => {
    const lists = planLists([agg("top", ["ai"], 5), agg("untagged", [], 9), agg("second", ["gpu"], 2)], TOPICS, "2025");
    expect(lists[0]).toMatchObject({ key: "hn:vouched", title: "Hacker News Vouched", videoIds: ["top", "second"] });
    expect(lists[0].description).toContain("in 2025");
  });

  it("caps Hacker News Vouched at 100 videos", () => {
    expect(planLists(many(150, ["ai"], "v"), TOPICS, "2025")[0].videoIds).toHaveLength(100);
  });

  it("rolls videos up into parent topics but never makes top-level lists", () => {
    const lists = planLists(many(MIN_TOPIC_LIST_SIZE, ["gpu"], "g"), TOPICS, "2025");
    expect(lists.map((l) => l.key)).toEqual(["hn:vouched", "hn:topic:gpu", "hn:topic:hardware"]);
    expect(lists.find((l) => l.key === "hn:topic:hardware")?.title).toBe("Hacker News: Hardware");
  });

  it("skips topics with too few videos", () => {
    const lists = planLists([...many(MIN_TOPIC_LIST_SIZE, ["ai"], "a"), ...many(MIN_TOPIC_LIST_SIZE - 1, ["pure-math"], "m")], TOPICS, "2025");
    expect(lists.map((l) => l.key)).toEqual(["hn:vouched", "hn:topic:ai"]);
  });

  it("orders topic lists by size and their items by rank", () => {
    const lists = planLists([...many(10, ["pure-math"], "m"), ...many(12, ["ai"], "a"), agg("best-ai", ["ai"], 3)], TOPICS, "2025");
    expect(lists.slice(1).map((l) => l.key)).toEqual(["hn:topic:ai", "hn:topic:pure-math"]);
    expect(lists[1].videoIds[0]).toBe("best-ai");
  });

  it("caps each topic list at 50 and the number of topic lists at 20", () => {
    const topics: TopicInfo[] = [{ slug: "root", name: "Root", parentSlug: null }];
    const aggs: VideoAggregate[] = [];
    for (let t = 0; t < 25; t++) {
      topics.push({ slug: `t${t}`, name: `T${t}`, parentSlug: "root" });
      aggs.push(...many(t === 0 ? 60 : MIN_TOPIC_LIST_SIZE, [`t${t}`], `t${t}-`));
    }
    const lists = planLists(aggs, topics, "2025");
    expect(lists).toHaveLength(21);
    expect(lists[1]).toMatchObject({ key: "hn:topic:t0" });
    expect(lists[1].videoIds).toHaveLength(50);
  });
});

describe("rankOrder", () => {
  it("is a stable total order", () => {
    const a: VideoAggregate = { videoId: "a", mentions: [], recommenders: 1, latest: "2025", topics: [], featured: null };
    expect(rankOrder(a, { ...a })).toBe(0);
    expect(rankOrder(a, { ...a, videoId: "b" })).toBeLessThan(0);
  });
});
