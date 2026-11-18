import { beforeEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import { createList, addToList } from "@/lib/lists";
import { createVouch } from "@/lib/vouches";
import { loadTopics } from "@/lib/topics";
import { createUser } from "@/lib/users";
import { resource, user } from "@/lib/test/fixtures";
import {
  choicePairs,
  completeOnboarding,
  expandTopics,
  makePairs,
  pickSuggestions,
  saveTopics,
  suggestions,
  userTopicSlugs,
  type ChoiceOption,
} from ".";

let db: Db;
beforeEach(async () => {
  db = await openPglite();
});

async function vouch(userId: string, topics: string[], note?: string) {
  const resourceId = await resource(db);
  const r = await createVouch({ userId, resourceId, topicSlugs: topics, note }, { db });
  if (!r.ok) throw new Error(r.error);
  return resourceId;
}

describe("saveTopics", () => {
  it("needs 3 to 5 known topics, and replaces earlier picks", async () => {
    const me = await user(db);
    expect(await saveTopics(db, me, ["ai", "gpu"])).toEqual({ ok: false, error: "too_few_topics" });
    expect(await saveTopics(db, me, ["ai", "gpu", "llms", "rust", "python", "web"])).toEqual({ ok: false, error: "too_many_topics" });
    expect(await saveTopics(db, me, ["ai", "gpu", "cooking"])).toEqual({ ok: false, error: "unknown_topic" });
    expect(await saveTopics(db, me, ["ai", "AI ", "gpu"])).toEqual({ ok: false, error: "too_few_topics" }); // duplicates count once
    expect(await saveTopics(db, me, ["ai", "gpu", "llms"])).toEqual({ ok: true });
    expect(await saveTopics(db, me, ["history", "physics", "space"])).toEqual({ ok: true });
    expect(await userTopicSlugs(db, me)).toEqual(["history", "physics", "space"]);
  });
});

describe("expandTopics", () => {
  it("includes everything under a chosen topic, but not its parent", async () => {
    const index = await loadTopics(db);
    const slugs = expandTopics(index, ["hardware"]).map((id) => index.byId.get(id)!.slug).sort();
    expect(slugs).toEqual(["cpu", "gpu", "hardware"]);
  });
});

describe("makePairs", () => {
  const opt = (resourceId: string, curatorId: string, creatorName: string | null = null): ChoiceOption => ({
    resourceId, title: resourceId, thumbnailUrl: null, creatorName, durationS: null, curatorId, curatorName: curatorId, note: null,
  });

  it("pairs videos from different curators and uses each video once", () => {
    const pairs = makePairs([opt("a1", "a"), opt("a2", "a"), opt("b1", "b"), opt("b2", "b")]);
    expect(pairs.map(([x, y]) => [x.resourceId, y.resourceId])).toEqual([["a1", "b1"], ["a2", "b2"]]);
  });

  it("skips videos that have no partner from another curator", () => {
    expect(makePairs([opt("a1", "a"), opt("a2", "a"), opt("a3", "a")])).toEqual([]);
    expect(makePairs([opt("a1", "a"), opt("a2", "a"), opt("b1", "b")]).length).toBe(1);
  });

  it("pairs different channels when there is only one curator", () => {
    const pairs = makePairs([opt("h1", "hn", "3Blue1Brown"), opt("h2", "hn", "3Blue1Brown"), opt("h3", "hn", "Veritasium")]);
    expect(pairs.map(([x, y]) => [x.resourceId, y.resourceId])).toEqual([["h1", "h3"]]);
  });

  it("stops at the maximum", () => {
    const many = Array.from({ length: 30 }, (_, i) => opt(`v${i}`, `c${i % 3}`));
    expect(makePairs(many, 6)).toHaveLength(6);
  });
});

describe("choicePairs", () => {
  it("offers videos from the person's topics, including subtopics, from two different curators", async () => {
    const me = await user(db);
    const priya = await user(db, "priya", "founding");
    const arjun = await user(db, "arjun", "founding");
    const gpu = await vouch(priya, ["gpu"], "Best GPU talk");
    const llm = await vouch(arjun, ["llms"]);
    await vouch(arjun, ["history"]); // not in my topics
    await saveTopics(db, me, ["hardware", "ai", "physics"]);

    const pairs = await choicePairs(db, me);
    expect(pairs).toHaveLength(1);
    const ids = pairs[0].map((o) => o.resourceId).sort();
    expect(ids).toEqual([gpu, llm].sort());
    expect(new Set(pairs[0].map((o) => o.curatorId)).size).toBe(2);
    // The video with a note comes first.
    expect(pairs[0][0]).toMatchObject({ resourceId: gpu, note: "Best GPU talk", curatorName: "priya" });
  });

  it("never offers the person's own vouches or removed videos", async () => {
    const me = await user(db);
    const other = await user(db, "other", "founding");
    await vouch(me, ["ai"]);
    await vouch(other, ["ai"]);
    const gone = await resource(db, { status: "unavailable" });
    await db.query("insert into vouches (user_id, resource_id) values ($1, $2)", [other, gone]);
    await saveTopics(db, me, ["ai", "llms", "gpu"]);
    expect(await choicePairs(db, me)).toEqual([]);
  });

  it("is empty before topics are chosen", async () => {
    expect(await choicePairs(db, await user(db))).toEqual([]);
  });
});

describe("pickSuggestions", () => {
  const s = (id: string, topicMatches: number, picked = 0) => ({ id, name: id, topicMatches, picked, topTopic: "AI" });

  it("takes up to 3 people and fills the rest with lists", () => {
    const out = pickSuggestions([s("p1", 5), s("p2", 4), s("p3", 3), s("p4", 2)], [s("l1", 9), s("l2", 8), s("l3", 7)]);
    expect(out.map((x) => x.id)).toEqual(["p1", "p2", "p3", "l1", "l2"]);
  });

  it("uses more people when there are not enough lists, and the reverse", () => {
    expect(pickSuggestions([s("p1", 5), s("p2", 4), s("p3", 3), s("p4", 2), s("p5", 1)], [s("l1", 9)]).map((x) => x.id)).toEqual(["p1", "p2", "p3", "p4", "l1"]);
    expect(pickSuggestions([s("p1", 5)], [s("l1", 9), s("l2", 8), s("l3", 7), s("l4", 6), s("l5", 5)]).map((x) => x.id)).toEqual(["p1", "l1", "l2", "l3", "l4"]);
  });

  it("weights a picked video above topic matches and explains why", () => {
    const out = pickSuggestions([s("many", 5), s("picked", 1, 2)], []);
    expect(out.map((x) => [x.id, x.reason])).toEqual([
      ["picked", "Vouched for 2 videos you picked"],
      ["many", "Vouched for 5 videos on AI"],
    ]);
  });

  it("never suggests something with nothing in common", () => {
    expect(pickSuggestions([s("none", 0)], [s("empty", 0)])).toEqual([]);
  });
});

describe("suggestions", () => {
  it("suggests people and public lists that match, never system curators or private lists", async () => {
    const me = await user(db);
    const priya = await user(db, "priya", "founding");
    const [hn] = await db.query<{ id: string }>(
      "insert into users (username, display_name, is_system, trust_tier) values ('hackernews', 'Hacker News', true, 'founding') returning id",
    );
    const picked = await vouch(priya, ["gpu"]);
    await vouch(hn.id, ["gpu"]);
    const pub = await createList(db, hn.id, { title: "Hacker News: GPU" });
    const priv = await createList(db, priya, { title: "Secret", isPublic: false });
    if (!pub.ok || !priv.ok) throw new Error("list");
    await addToList(db, hn.id, pub.list.id, picked);
    await addToList(db, priya, priv.list.id, picked);
    await saveTopics(db, me, ["hardware", "ai", "physics"]);

    const out = await suggestions(db, me, [picked]);
    expect(out.map((x) => [x.kind, x.name, x.reason])).toEqual([
      ["curator", "priya", "Vouched for 1 video you picked"],
      ["list", "Hacker News: GPU", "Has 1 video you picked"],
    ]);
  });

  it("ignores picks that are not valid IDs", async () => {
    const me = await user(db);
    await saveTopics(db, me, ["ai", "llms", "gpu"]);
    await expect(suggestions(db, me, ["'; drop table users; --"])).resolves.toEqual([]);
  });
});

describe("completeOnboarding", () => {
  it("follows the chosen people and lists, marks the person onboarded, and records it once", async () => {
    const r = await createUser(db, { username: "newbie", displayName: "New Person" });
    if (!r.ok) throw new Error(r.error);
    const me = r.user.id;
    expect(r.user.onboarded_at).toBeNull();

    const priya = await user(db, "priya", "founding");
    const [hn] = await db.query<{ id: string }>("insert into users (username, display_name, is_system) values ('hackernews', 'Hacker News', true) returning id");
    const list = await createList(db, priya, { title: "GPU talks" });
    if (!list.ok) throw new Error("list");
    await saveTopics(db, me, ["ai", "gpu", "llms"]);

    const now = new Date("2026-11-04T12:00:00Z");
    expect(await completeOnboarding(db, me, { curatorIds: [priya, priya, hn.id], listIds: [list.list.id] }, now)).toEqual({ follows: 1, lists: 1 });
    // Finishing again changes nothing and logs nothing new.
    await completeOnboarding(db, me, { curatorIds: [], listIds: [] }, new Date());

    const [u] = await db.query<{ onboarded_at: Date }>("select onboarded_at from users where id = $1", [me]);
    expect(u.onboarded_at.toISOString()).toBe(now.toISOString());
    const follows = await db.query("select 1 from follows where follower_id = $1", [me]);
    expect(follows).toHaveLength(1); // not the system curator
    const events = await db.query<{ props: { follows: number; lists: number; topics: number } }>(
      "select props from events where user_id = $1 and name = 'onboarding_complete'",
      [me],
    );
    expect(events.map((e) => e.props)).toEqual([{ follows: 1, lists: 1, topics: 3 }]);
  });

  it("can finish with nothing followed", async () => {
    const me = await user(db);
    expect(await completeOnboarding(db, me, { curatorIds: [], listIds: [] })).toEqual({ follows: 0, lists: 0 });
  });

  it("accounts created after the migration start not onboarded", async () => {
    const me = await user(db);
    const [u] = await db.query<{ onboarded_at: Date | null }>("select onboarded_at from users where id = $1", [me]);
    expect(u.onboarded_at).toBeNull();
  });
});
