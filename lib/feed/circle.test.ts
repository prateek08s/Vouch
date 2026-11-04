import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { follow } from "@/lib/graph/follows";
import { createVouch } from "@/lib/vouches";
import { rate } from "@/lib/ratings";
import { createRule } from "@/lib/rules";
import { circleFeed, logImpressions } from "./circle";
import { MAX_FEED_ITEMS, PAGE_SIZE } from "./rank";

let db: Db;
const H = 3_600_000;
const NOW = new Date("2026-06-01T12:00:00Z");
const ago = (h: number) => () => new Date(NOW.getTime() - h * H);

let viewer: string;

beforeAll(async () => {
  db = await openPglite();
});
beforeEach(async () => {
  viewer = await fx.user(db);
});

async function curator(name?: string) {
  const id = await fx.user(db, name, "founding");
  await follow(db, viewer, id);
  return id;
}

async function vouch(curatorId: string, resourceId: string, topics = ["gpu"], hoursAgo = 1, note?: string) {
  const r = await createVouch({ userId: curatorId, resourceId, topicSlugs: topics, note }, { db, now: ago(hoursAgo) });
  if (!r.ok) throw new Error(r.error);
  return r.vouch;
}

const feed = (cursor?: number) => circleFeed(db, viewer, { now: NOW, cursor });

describe("circleFeed", () => {
  it("is empty and caught up with no follows", async () => {
    expect(await feed()).toEqual({ items: [], nextCursor: null, hiddenByRules: 0, curatorCount: 0 });
  });

  it("shows only vouches from people the viewer follows", async () => {
    const friend = await curator();
    const stranger = await fx.user(db, undefined, "founding");
    const a = await fx.resource(db, { title: "From friend" });
    const b = await fx.resource(db, { title: "From stranger" });
    await vouch(friend, a);
    await vouch(stranger, b);
    expect((await feed()).items.map((i) => i.title)).toEqual(["From friend"]);
  });

  it("merges multiple vouches for one video into one card", async () => {
    const [p, q, s] = [await curator(), await curator(), await curator()];
    const r = await fx.resource(db);
    await vouch(p, r);
    await vouch(q, r, ["gpu"], 2);
    await vouch(s, r, ["hardware"], 3);
    const { items, curatorCount } = await feed();
    expect(items).toHaveLength(1);
    expect(items[0].vouches).toHaveLength(3);
    expect(items[0].explanation.headline).toMatch(/and 2 others you follow$/);
    expect(curatorCount).toBe(3);
  });

  it("removes resources the viewer already rated or vouched", async () => {
    const c = await curator();
    const rated = await fx.resource(db, { title: "rated" });
    const mine = await fx.resource(db, { title: "mine" });
    const fresh = await fx.resource(db, { title: "fresh" });
    for (const r of [rated, mine, fresh]) await vouch(c, r);
    await rate({ userId: viewer, resourceId: rated, worthIt: true }, { db, now: () => NOW });
    await db.query("update users set trust_tier = 'founding' where id = $1", [viewer]);
    await createVouch({ userId: viewer, resourceId: mine, topicSlugs: ["ai"] }, { db, now: ago(0.5) });
    expect((await feed()).items.map((i) => i.title)).toEqual(["fresh"]);
  });

  it("hides removed videos and vouches older than the window", async () => {
    const c = await curator();
    const gone = await fx.resource(db, { title: "gone" });
    await vouch(c, gone);
    await db.query("update resources set metadata_status = 'unavailable' where id = $1", [gone]);
    await vouch(c, await fx.resource(db, { title: "ancient" }), ["gpu"], 61 * 24);
    await vouch(c, await fx.resource(db, { title: "ok" }));
    expect((await feed()).items.map((i) => i.title)).toEqual(["ok"]);
  });

  it("never shows a vouch dated in the future", async () => {
    const c = await curator();
    await vouch(c, await fx.resource(db, { title: "future" }), ["gpu"], -5);
    expect((await feed()).items).toHaveLength(0);
  });

  describe("hard rules (applied before ranking)", () => {
    it("excludes the most-trusted, most-vouched item if a rule blocks it", async () => {
      const cs = [await curator(), await curator(), await curator(), await curator()];
      const popular = await fx.resource(db, { title: "Crypto mega hit", channelId: "UC_hype" });
      for (const c of cs) await vouch(c, popular);
      await vouch(cs[0], await fx.resource(db, { title: "Quiet gem" }), ["physics"], 40);

      for (const [kind, value] of [["keyword", "crypto"], ["channel", "UC_hype"], ["topic", "hardware"]] as const) {
        const v2 = await fx.user(db);
        for (const c of cs) await follow(db, v2, c);
        await createRule(db, v2, kind, value);
        const page = await circleFeed(db, v2, { now: NOW });
        expect(page.items.map((i) => i.title), `${kind}=${value}`).toEqual(["Quiet gem"]);
        expect(page.hiddenByRules).toBe(1);
      }
    });

    it("applies duration rules and no-shorts", async () => {
      const c = await curator();
      await vouch(c, await fx.resource(db, { title: "long", durationS: 3 * 3600 }));
      await vouch(c, await fx.resource(db, { title: "short", isShort: true, durationS: 30 }), ["physics"]);
      await vouch(c, await fx.resource(db, { title: "unknown", durationS: null }), ["biology"]);
      await vouch(c, await fx.resource(db, { title: "right", durationS: 20 * 60 }), ["space"]);
      await createRule(db, viewer, "max_duration", "60");
      await createRule(db, viewer, "no_shorts", "");
      const page = await feed();
      expect(page.items.map((i) => i.title)).toEqual(["right"]);
      expect(page.hiddenByRules).toBe(3);
    });
  });

  describe("ranking", () => {
    it("puts a pick from a proven curator ahead of an untested one", async () => {
      const proven = await curator("proven_p");
      const untested = await curator("untested_u");
      for (let i = 0; i < 6; i++) {
        const r = await fx.resource(db);
        await vouch(proven, r, ["gpu"], 200 + i);
        await rate({ userId: viewer, resourceId: r, worthIt: true }, { db, now: ago(100) });
      }
      const a = await fx.resource(db, { title: "proven pick" });
      const b = await fx.resource(db, { title: "untested pick" });
      await vouch(untested, b, ["gpu"], 1);
      await vouch(proven, a, ["gpu"], 1);
      const { items } = await feed();
      expect(items.map((i) => i.title)).toEqual(["proven pick", "untested pick"]);
      expect(items[0].explanation.whyThis).toBe("You rated 6 of proven_p's 6 GPU picks Worth It.");
    });

    it("features the best note on the card", async () => {
      const c = await curator();
      await vouch(c, await fx.resource(db), ["gpu"], 1, "Best explanation of GPU scheduling I've seen.");
      const [item] = (await feed()).items;
      expect(item.explanation.featuredNote?.text).toBe("Best explanation of GPU scheduling I've seen.");
    });
  });

  describe("finite pagination", () => {
    it(`pages ${PAGE_SIZE} at a time, ends at ${MAX_FEED_ITEMS}, never repeats`, async () => {
      const cs = await Promise.all(Array.from({ length: 6 }, () => curator()));
      const topics = ["gpu", "physics", "rust", "biology", "ai", "space"];
      for (let i = 0; i < 40; i++) await vouch(cs[i % 6], await fx.resource(db), [topics[i % 6]], 1 + i);

      const seen: string[] = [];
      let cursor: number | undefined = 0;
      let pages = 0;
      while (cursor !== undefined) {
        const page = await feed(cursor);
        expect(page.items.length).toBeLessThanOrEqual(PAGE_SIZE);
        seen.push(...page.items.map((i) => i.resourceId));
        cursor = page.nextCursor ?? undefined;
        if (++pages > 10) throw new Error("feed did not end");
      }
      expect(seen).toHaveLength(MAX_FEED_ITEMS);
      expect(new Set(seen).size).toBe(MAX_FEED_ITEMS);
    });
  });

  it("logs impressions with their explanation code", async () => {
    const c = await curator();
    await vouch(c, await fx.resource(db));
    const { items } = await feed();
    await logImpressions(db, viewer, items);
    const rows = await db.query<{ explanation_code: string; source_type: string }>(
      "select explanation_code, source_type from recommendation_impressions where user_id = $1",
      [viewer],
    );
    expect(rows).toEqual([{ explanation_code: "circle_follow", source_type: "circle" }]);
  });
});
