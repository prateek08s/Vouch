/**
 * The critical milestone (plan, Week 6): Vouch -> Watch -> Worth It -> Trust update, end to end.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { follow, unfollow } from "@/lib/graph/follows";
import { createVouch, deleteVouch } from "@/lib/vouches";
import { rate, recordOpen } from "@/lib/ratings";
import { loadTrust, recomputeTrust, trustFor, trustLevel } from "./index";

let db: Db;
let gpuId: number;
let designId: number;
const MIN = 60 * 1000;
const T0 = new Date("2026-04-01T09:00:00Z").getTime();
let clock = 0;
const tick = () => new Date(T0 + ++clock * MIN);
/** Real curators spread vouches out; 3h apart keeps fixtures under the daily limit. */
const vouchTick = () => new Date(T0 + (clock += 180) * MIN);

beforeAll(async () => {
  db = await openPglite();
  const rows = await db.query<{ slug: string; id: number }>("select slug, id from topics where slug in ('gpu','ui-design')");
  gpuId = rows.find((r) => r.slug === "gpu")!.id;
  designId = rows.find((r) => r.slug === "ui-design")!.id;
});

/** Curator vouches a fresh resource on a topic; returns resource id. */
async function vouched(curator: string, topic: string, standard = true): Promise<string> {
  if (standard) await db.query("update users set trust_tier = 'founding' where id = $1", [curator]);
  const r = await fx.resource(db);
  const res = await createVouch({ userId: curator, resourceId: r, topicSlugs: [topic] }, { db, now: vouchTick });
  if (!res.ok) throw new Error(res.error);
  return r;
}

async function trustOf(viewer: string, curator: string) {
  return (await loadTrust(db, viewer, [curator])).get(curator)!;
}

describe("follow", () => {
  it("creates a default trust edge and one follow event", async () => {
    const a = await fx.user(db);
    const b = await fx.user(db);
    expect(await follow(db, a, b)).toEqual({ ok: true, created: true });
    expect(await follow(db, a, b)).toEqual({ ok: true, created: false });
    const t = await trustOf(a, b);
    expect(t.base.weight).toBe(1);
    const ev = await db.query("select 1 from events where user_id = $1 and name = 'follow'", [a]);
    expect(ev).toHaveLength(1);
  });

  it("rejects self-follows and unknown users", async () => {
    const a = await fx.user(db);
    expect(await follow(db, a, a)).toEqual({ ok: false, error: "self_follow" });
    expect(await follow(db, a, "00000000-0000-0000-0000-000000000000")).toEqual({ ok: false, error: "user_not_found" });
  });
});

describe("topic-specific trust (plan 5.4)", () => {
  let prateek: string;
  let priya: string;

  beforeAll(async () => {
    prateek = await fx.user(db, "prateek_t");
    priya = await fx.user(db, "priya_t");
    await follow(db, prateek, priya);

    const gpu = [];
    for (let i = 0; i < 12; i++) gpu.push(await vouched(priya, "gpu"));
    const design = [];
    for (let i = 0; i < 3; i++) design.push(await vouched(priya, "ui-design"));

    for (const [i, r] of gpu.entries()) await rate({ userId: prateek, resourceId: r, worthIt: i !== 0 }, { db, now: tick });
    for (const r of design) await rate({ userId: prateek, resourceId: r, worthIt: false }, { db, now: tick });
  });

  it("learns strong GPU trust from 11/12 Worth It", async () => {
    const gpu = (await trustOf(prateek, priya)).byTopic.get(gpuId)!;
    expect(gpu).toMatchObject({ sampleCount: 12, worthCount: 11 });
    expect(trustLevel(gpu)).toBe("strong");
  });

  it("learns lower design trust from 0/3 at the same time", async () => {
    const design = (await trustOf(prateek, priya)).byTopic.get(designId)!;
    expect(design).toMatchObject({ sampleCount: 3, worthCount: 0 });
    expect(design.weight).toBeLessThan(1);
  });

  it("keeps base trust across all of her picks", async () => {
    const t = await trustOf(prateek, priya);
    expect(t.base).toMatchObject({ sampleCount: 15, worthCount: 11 });
    expect(t.base.weight).toBeGreaterThan(1);
  });

  it("picks the topic edge for a GPU vouch and the base for an unrated topic", async () => {
    const t = await trustOf(prateek, priya);
    expect(trustFor(t, [gpuId]).topicId).toBe(gpuId);
    const rust = (await db.query<{ id: number }>("select id from topics where slug = 'rust'"))[0].id;
    expect(trustFor(t, [rust])).toMatchObject({ topicId: null, weight: t.base.weight });
  });

  it("is private to the viewer: Priya has no trust edge toward Prateek", async () => {
    const rows = await db.query("select 1 from trust_edges where user_id = $1", [priya]);
    expect(rows).toHaveLength(0);
  });
});

describe("rating semantics", () => {
  it("re-rating replaces the earlier answer with no drift", async () => {
    const viewer = await fx.user(db);
    const curator = await fx.user(db);
    await follow(db, viewer, curator);
    const r = await vouched(curator, "gpu");
    await rate({ userId: viewer, resourceId: r, worthIt: true }, { db, now: tick });
    const once = (await trustOf(viewer, curator)).base.weight;
    for (const w of [false, true, false, true]) await rate({ userId: viewer, resourceId: r, worthIt: w }, { db, now: tick });
    const t = await trustOf(viewer, curator);
    expect(t.base.weight).toBe(once);
    expect(t.base.sampleCount).toBe(1);
  });

  it("reports whether the answer changed, and logs one event per change", async () => {
    const viewer = await fx.user(db);
    const r = await fx.resource(db);
    expect((await rate({ userId: viewer, resourceId: r, worthIt: true }, { db })).ok && true).toBe(true);
    const again = await rate({ userId: viewer, resourceId: r, worthIt: true }, { db });
    expect(again).toMatchObject({ ok: true, changed: false });
    const ev = await db.query("select name from events where user_id = $1 and name in ('worth_it','not_worth_it')", [viewer]);
    expect(ev).toHaveLength(1);
  });

  it("does not credit a curator who vouched after the viewer rated", async () => {
    const viewer = await fx.user(db);
    const late = await fx.user(db, undefined, "founding");
    await follow(db, viewer, late);
    const r = await fx.resource(db);
    await rate({ userId: viewer, resourceId: r, worthIt: true }, { db, now: tick });
    await createVouch({ userId: late, resourceId: r, topicSlugs: ["gpu"] }, { db, now: tick });
    // A later rating change triggers recompute; the late vouch still must not count.
    const res = await rate({ userId: viewer, resourceId: r, worthIt: false }, { db, now: tick });
    expect(res.ok && res.updatedCurators).toEqual([]);
    expect((await trustOf(viewer, late)).base.sampleCount).toBe(0);
  });

  it("updates every followed curator who vouched, but not strangers", async () => {
    const viewer = await fx.user(db);
    const [a, b, stranger] = [await fx.user(db), await fx.user(db), await fx.user(db)];
    await follow(db, viewer, a);
    await follow(db, viewer, b);
    const r = await fx.resource(db);
    for (const c of [a, b, stranger]) await createVouch({ userId: c, resourceId: r, topicSlugs: ["ai"] }, { db, now: tick });
    const res = await rate({ userId: viewer, resourceId: r, worthIt: true }, { db, now: tick });
    expect(res.ok && [...res.updatedCurators].sort()).toEqual([a, b].sort());
    expect(await db.query("select 1 from trust_edges where user_id = $1 and curator_id = $2", [viewer, stranger])).toHaveLength(0);
  });

  it("credits the curator the viewer came through, even if not followed", async () => {
    const viewer = await fx.user(db);
    const scout = await fx.user(db);
    const r = await fx.resource(db);
    const v = await createVouch({ userId: scout, resourceId: r, topicSlugs: ["ai"] }, { db, now: tick });
    await recordOpen(db, { userId: viewer, resourceId: r, vouchId: v.ok ? v.vouch.id : null, source: "discover" });
    const res = await rate({ userId: viewer, resourceId: r, worthIt: true }, { db, now: tick });
    expect(res.ok && res.updatedCurators).toEqual([scout]);
    const [rating] = await db.query<{ attribution_vouch_id: string }>(
      "select attribution_vouch_id from ratings where user_id = $1",
      [viewer],
    );
    expect(rating.attribution_vouch_id).toBe(v.ok && v.vouch.id);
  });

  it("keeps the first attribution (the person who actually brought you)", async () => {
    const viewer = await fx.user(db);
    const [first, second] = [await fx.user(db), await fx.user(db)];
    const r = await fx.resource(db);
    const v1 = await createVouch({ userId: first, resourceId: r, topicSlugs: ["ai"] }, { db, now: tick });
    const v2 = await createVouch({ userId: second, resourceId: r, topicSlugs: ["ai"] }, { db, now: tick });
    await recordOpen(db, { userId: viewer, resourceId: r, vouchId: v1.ok ? v1.vouch.id : null });
    await recordOpen(db, { userId: viewer, resourceId: r, vouchId: v2.ok ? v2.vouch.id : null });
    const [a] = await db.query<{ source_curator_id: string }>("select source_curator_id from vouch_attribution where user_id = $1", [viewer]);
    expect(a.source_curator_id).toBe(first);
  });

  it("ignores a vouch id that belongs to a different resource", async () => {
    const viewer = await fx.user(db);
    const c = await fx.user(db);
    const other = await fx.resource(db);
    const v = await createVouch({ userId: c, resourceId: other, topicSlugs: ["ai"] }, { db, now: tick });
    const r = await fx.resource(db);
    await recordOpen(db, { userId: viewer, resourceId: r, vouchId: v.ok ? v.vouch.id : null });
    const [a] = await db.query<{ source_curator_id: string | null }>("select source_curator_id from vouch_attribution where user_id = $1", [viewer]);
    expect(a.source_curator_id).toBeNull();
  });

  it("never builds trust toward yourself when rating your own vouch", async () => {
    const me = await fx.user(db);
    const r = await vouched(me, "ai");
    await rate({ userId: me, resourceId: r, worthIt: true }, { db, now: tick });
    expect(await db.query("select 1 from trust_edges where user_id = $1", [me])).toHaveLength(0);
  });

  it("drops evidence when a curator deletes their vouch", async () => {
    const viewer = await fx.user(db);
    const c = await fx.user(db);
    await follow(db, viewer, c);
    const r = await fx.resource(db);
    const v = await createVouch({ userId: c, resourceId: r, topicSlugs: ["ai"] }, { db, now: tick });
    await rate({ userId: viewer, resourceId: r, worthIt: true }, { db, now: tick });
    expect((await trustOf(viewer, c)).base.sampleCount).toBe(1);
    await deleteVouch(db, c, v.ok ? v.vouch.id : "");
    await recomputeTrust(db, viewer, [c]);
    const t = await trustOf(viewer, c);
    expect(t.base).toMatchObject({ sampleCount: 0, weight: 1 });
    expect(t.byTopic.size).toBe(0);
  });

  it("restores learned trust after unfollow and refollow", async () => {
    const viewer = await fx.user(db);
    const c = await fx.user(db);
    await follow(db, viewer, c);
    await rate({ userId: viewer, resourceId: await vouched(c, "ai"), worthIt: true }, { db, now: tick });
    const before = (await trustOf(viewer, c)).base.weight;
    await unfollow(db, viewer, c);
    await follow(db, viewer, c);
    expect((await trustOf(viewer, c)).base.weight).toBe(before);
    expect(before).toBeGreaterThan(1);
  });

  it("rejects ratings for unknown resources", async () => {
    const viewer = await fx.user(db);
    expect(await rate({ userId: viewer, resourceId: "00000000-0000-0000-0000-000000000000", worthIt: true }, { db })).toEqual({
      ok: false,
      error: "resource_not_found",
    });
  });
});
