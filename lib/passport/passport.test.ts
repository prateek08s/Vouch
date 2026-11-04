import { beforeEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import { rate } from "@/lib/ratings";
import { recordOpen } from "@/lib/ratings";
import { createVouch } from "@/lib/vouches";
import { resource, user } from "@/lib/test/fixtures";
import {
  curatorSuccess,
  ownPassport,
  publicPassport,
  setPassportSettings,
  topicLevels,
  type AttributedRating,
  type TopicSignal,
} from ".";

const NOW = new Date("2026-11-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const NAMES = new Map([[1, "AI"], [2, "GPU"], [3, "History"], [4, "Physics"], [5, "Rust"], [6, "Space"], [7, "Typography"]]);
const sig = (topicId: number, kind: TopicSignal["kind"], d = 90): TopicSignal => ({ topicId, kind, at: daysAgo(d) });

describe("topicLevels", () => {
  it("is null until there are at least 3 signals", () => {
    expect(topicLevels([sig(1, "vouch"), sig(1, "worth")], NAMES, NOW)).toBeNull();
  });

  it("weights a vouch twice a Worth-It rating and labels levels, not scores", () => {
    const levels = topicLevels([
      ...Array(5).fill(sig(1, "vouch")),  // AI: 10
      ...Array(7).fill(sig(2, "worth")),  // GPU: 7  (>= 60% of 10: core)
      ...Array(2).fill(sig(3, "vouch")),  // History: 4 (>= 25%: strong)
      sig(4, "worth"),                    // Physics: 1 (too weak, left out)
    ], NAMES, NOW);
    expect(levels).toEqual([
      { topicId: 1, name: "AI", level: "core" },
      { topicId: 2, name: "GPU", level: "core" },
      { topicId: 3, name: "History", level: "strong" },
    ]);
  });

  it("marks a recent, smaller topic as emerging even below the strong cut-off", () => {
    const levels = topicLevels([...Array(10).fill(sig(1, "vouch")), sig(6, "worth", 3), sig(6, "worth", 10)], NAMES, NOW);
    expect(levels?.find((t) => t.name === "Space")?.level).toBe("emerging");
  });

  it("calls nothing emerging when all activity is recent, since there is no before to compare with", () => {
    const levels = topicLevels([...Array(10).fill(sig(1, "vouch", 5)), sig(6, "worth", 3), sig(6, "worth", 4), ...Array(3).fill(sig(3, "vouch", 2))], NAMES, NOW);
    expect(levels?.some((t) => t.level === "emerging")).toBe(false);
    expect(levels?.find((t) => t.name === "History")?.level).toBe("strong");
  });

  it("does not call an old topic emerging", () => {
    const levels = topicLevels([...Array(10).fill(sig(1, "vouch")), sig(6, "worth", 200), sig(6, "worth", 300)], NAMES, NOW);
    expect(levels?.find((t) => t.name === "Space")).toBeUndefined();
  });

  it("shows at most 5 topics", () => {
    const signals = [...NAMES.keys()].flatMap((id) => Array(3).fill(sig(id, "vouch")));
    expect(topicLevels(signals, NAMES, NOW)).toHaveLength(5);
  });

  it("ignores topics it has no name for", () => {
    expect(topicLevels([sig(99, "vouch"), sig(99, "vouch"), sig(99, "vouch")], NAMES, NOW)).toBeNull();
  });
});

describe("curatorSuccess", () => {
  const r = (raterId: string, worthIt: boolean, topicIds = [1]): AttributedRating => ({ raterId, worthIt, topicIds });

  it("has no rate until 5 ratings, then the share rated Worth It", () => {
    expect(curatorSuccess([r("a", true), r("b", true), r("c", false), r("d", true)], NAMES).worthItRate).toBeNull();
    expect(curatorSuccess([r("a", true), r("b", true), r("c", false), r("d", true), r("e", true)], NAMES).worthItRate).toBeCloseTo(0.8);
  });

  it("counts each person helped once, and only Worth It ratings", () => {
    const s = curatorSuccess([r("a", true), r("a", true), r("b", false)], NAMES);
    expect(s.peopleHelped).toBe(1);
  });

  it("is trusted for topics with at least 3 ratings and a high Worth-It rate", () => {
    const s = curatorSuccess([
      r("a", true, [2]), r("b", true, [2]), r("c", true, [2]),   // GPU 3/3
      r("a", true, [1]), r("b", false, [1]), r("c", false, [1]), // AI 1/3
      r("a", true, [3]), r("b", true, [3]),                      // History 2/2: too few
    ], NAMES);
    expect(s.trustedFor).toEqual(["GPU"]);
  });
});

describe("Passport from the database", () => {
  let db: Db;
  beforeEach(async () => {
    db = await openPglite();
  });

  async function setup() {
    const me = await user(db, "sam");
    const fan = await user(db, "fan");
    const picks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await resource(db);
      const v = await createVouch({ userId: me, resourceId: res, topicSlugs: ["gpu"] }, { db, now: () => daysAgo(60) });
      if (!v.ok) throw new Error(v.error);
      picks.push(res);
      // A follower reached each pick through Sam's vouch and rated it.
      await recordOpen(db, { userId: fan, resourceId: res, vouchId: v.vouch.id });
      await rate({ userId: fan, resourceId: res, worthIt: i < 2 }, { db });
    }
    // Sam privately enjoyed some history videos without vouching for them.
    for (let i = 0; i < 4; i++) {
      const res = await resource(db);
      await db.query("insert into resource_topics (resource_id, topic_id) select $1, id from topics where slug = 'history'", [res]);
      await rate({ userId: me, resourceId: res, worthIt: true }, { db });
    }
    return { me, fan, picks };
  }

  it("the owner sees topics from vouches and their own Worth-It ratings, plus curator success", async () => {
    const { me } = await setup();
    const p = await ownPassport(db, me, NOW);
    expect(p?.topics?.map((t) => t.name).sort()).toEqual(["GPU", "History"]);
    expect(p?.success).toMatchObject({ rated: 3, worth: 2, peopleHelped: 1, worthItRate: null });
    expect(p?.settings).toEqual({ isPublic: false, showSuccess: true });
    expect(p?.vouchCount).toBe(3);
  });

  it("is private until shared", async () => {
    const { me } = await setup();
    expect(await publicPassport(db, "sam", NOW)).toBeNull();
    await setPassportSettings(db, me, { isPublic: true, showSuccess: true }, NOW);
    expect(await publicPassport(db, "sam", NOW)).not.toBeNull();
  });

  it("the public version never reflects private ratings", async () => {
    const { me } = await setup();
    await setPassportSettings(db, me, { isPublic: true, showSuccess: true }, NOW);
    const p = await publicPassport(db, "SAM ", NOW);
    expect(p?.view).toBe("public");
    // History came only from Sam's private Worth-It ratings, so it must not appear.
    expect(p?.topics?.map((t) => t.name)).toEqual(["GPU"]);
  });

  it("can hide curator success from the public version", async () => {
    const { me } = await setup();
    await setPassportSettings(db, me, { isPublic: true, showSuccess: false }, NOW);
    expect((await publicPassport(db, "sam", NOW))?.success).toBeNull();
    expect((await ownPassport(db, me, NOW))?.success).not.toBeNull();
  });

  it("records passport_shared only when it goes from private to public", async () => {
    const { me } = await setup();
    await setPassportSettings(db, me, { isPublic: true, showSuccess: true }, NOW);
    await setPassportSettings(db, me, { isPublic: true, showSuccess: false }, NOW);
    await setPassportSettings(db, me, { isPublic: false, showSuccess: false }, NOW);
    await setPassportSettings(db, me, { isPublic: true, showSuccess: false }, NOW);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from events where name = 'passport_shared' and user_id = $1", [me]);
    expect(n).toBe(2);
  });

  it("system curators never have a public Passport", async () => {
    await db.query("insert into users (username, display_name, is_system, passport_public) values ('hackernews', 'Hacker News', true, true)");
    expect(await publicPassport(db, "hackernews", NOW)).toBeNull();
  });
});
