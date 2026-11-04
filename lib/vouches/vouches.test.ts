import { beforeAll, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createUser } from "@/lib/users";
import { DAILY_LIMIT, createVouch, deleteVouch, remainingVouchesToday, updateVouch } from "./index";

let db: Db;
const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-03-10T12:00:00Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);

beforeAll(async () => {
  db = await openPglite();
});

describe("createUser", () => {
  it("normalizes @handles and case", async () => {
    const r = await createUser(db, { username: " @Priya_K ", displayName: "Priya K" });
    expect(r).toMatchObject({ ok: true, user: { username: "priya_k", trust_tier: "new" } });
  });

  it("rejects taken usernames regardless of case", async () => {
    await createUser(db, { username: "arjun", displayName: "Arjun" });
    expect(await createUser(db, { username: "ARJUN", displayName: "Other" })).toEqual({ ok: false, error: "username_taken" });
  });

  it.each([
    ["ab", "invalid_username"],
    ["has space", "invalid_username"],
    ["x".repeat(25), "invalid_username"],
  ])("rejects username %s", async (username, error) => {
    expect(await createUser(db, { username, displayName: "X" })).toEqual({ ok: false, error });
  });

  it("rejects blank display names and long bios", async () => {
    expect(await createUser(db, { username: "blank_dn", displayName: "  " })).toEqual({ ok: false, error: "invalid_display_name" });
    expect(await createUser(db, { username: "long_bio", displayName: "B", bio: "x".repeat(281) })).toEqual({ ok: false, error: "bio_too_long" });
  });
});

describe("createVouch", () => {
  it("creates a vouch with note, topics, and disclosure", async () => {
    const u = await fx.user(db);
    const r = await fx.resource(db);
    const res = await createVouch(
      { userId: u, resourceId: r, note: "  Best GPU explainer I've seen.  ", topicSlugs: ["gpu", "Hardware"], isOwnContent: true },
      { db },
    );
    expect(res).toMatchObject({ ok: true, vouch: { note: "Best GPU explainer I've seen.", is_own_content: true } });
    const topics = await db.query<{ slug: string }>(
      "select t.slug from vouch_topics vt join topics t on t.id = vt.topic_id where vt.vouch_id = $1 order by t.slug",
      [res.ok && res.vouch.id],
    );
    expect(topics.map((t) => t.slug)).toEqual(["gpu", "hardware"]);
  });

  it("tags the resource with the vouch's topics", async () => {
    const u = await fx.user(db);
    const r = await fx.resource(db);
    await createVouch({ userId: u, resourceId: r, topicSlugs: ["rust"] }, { db });
    const rows = await db.query<{ source: string }>(
      "select rt.source from resource_topics rt join topics t on t.id = rt.topic_id where rt.resource_id = $1 and t.slug = 'rust'",
      [r],
    );
    expect(rows).toEqual([{ source: "vouch" }]);
  });

  it("stores an empty note as null", async () => {
    const res = await createVouch({ userId: await fx.user(db), resourceId: await fx.resource(db), note: "   ", topicSlugs: ["ai"] }, { db });
    expect(res.ok && res.vouch.note).toBeNull();
  });

  it("records a vouch_created event", async () => {
    const u = await fx.user(db);
    await createVouch({ userId: u, resourceId: await fx.resource(db), topicSlugs: ["ai"] }, { db });
    const ev = await db.query("select 1 from events where user_id = $1 and name = 'vouch_created'", [u]);
    expect(ev).toHaveLength(1);
  });

  it("refuses a second vouch for the same resource", async () => {
    const u = await fx.user(db);
    const r = await fx.resource(db);
    await createVouch({ userId: u, resourceId: r, topicSlugs: ["ai"] }, { db });
    expect(await createVouch({ userId: u, resourceId: r, topicSlugs: ["ai"] }, { db })).toEqual({ ok: false, error: "already_vouched" });
  });

  it.each([
    [{ note: "x".repeat(281), topicSlugs: ["ai"] }, "note_too_long"],
    [{ topicSlugs: [] }, "topics_required"],
    [{ topicSlugs: ["  "] }, "topics_required"],
    [{ topicSlugs: ["ai", "gpu", "rust", "python"] }, "too_many_topics"],
    [{ topicSlugs: ["ai", "not-a-topic"] }, "unknown_topic"],
  ])("validates %o -> %s", async (over, error) => {
    const res = await createVouch({ userId: await fx.user(db), resourceId: await fx.resource(db), ...over }, { db });
    expect(res).toEqual({ ok: false, error });
  });

  it("counts duplicate topic slugs once", async () => {
    const res = await createVouch({ userId: await fx.user(db), resourceId: await fx.resource(db), topicSlugs: ["ai", "AI", "ai", "gpu"] }, { db });
    expect(res.ok).toBe(true);
  });

  it("rejects missing users, missing resources, and removed videos", async () => {
    const u = await fx.user(db);
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(await createVouch({ userId: missing, resourceId: await fx.resource(db), topicSlugs: ["ai"] }, { db })).toEqual({ ok: false, error: "user_not_found" });
    expect(await createVouch({ userId: u, resourceId: missing, topicSlugs: ["ai"] }, { db })).toEqual({ ok: false, error: "resource_not_found" });
    const gone = await fx.resource(db, { status: "unavailable" });
    expect(await createVouch({ userId: u, resourceId: gone, topicSlugs: ["ai"] }, { db })).toEqual({ ok: false, error: "resource_unavailable" });
  });

  it("writes nothing when validation fails mid-transaction", async () => {
    const u = await fx.user(db);
    await createVouch({ userId: u, resourceId: "00000000-0000-0000-0000-000000000000", topicSlugs: ["ai"] }, { db });
    expect(await db.query("select 1 from vouches where user_id = $1", [u])).toHaveLength(0);
    expect(await db.query("select 1 from events where user_id = $1 and name = 'vouch_created'", [u])).toHaveLength(0);
  });
});

describe("daily limit", () => {
  async function vouchMany(u: string, n: number, now: () => Date) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(await createVouch({ userId: u, resourceId: await fx.resource(db), topicSlugs: ["ai"] }, { db, now }));
    }
    return out;
  }

  it(`allows ${DAILY_LIMIT.new} per rolling 24h for new accounts`, async () => {
    const u = await fx.user(db);
    const rs = await vouchMany(u, DAILY_LIMIT.new + 1, at(0));
    expect(rs.slice(0, DAILY_LIMIT.new).every((r) => r.ok)).toBe(true);
    expect(rs.at(-1)).toEqual({ ok: false, error: "daily_limit_reached" });
    expect(await remainingVouchesToday(db, u, at(0)())).toBe(0);
  });

  it("is a rolling window, not a calendar day", async () => {
    const u = await fx.user(db);
    await vouchMany(u, DAILY_LIMIT.new, at(0));
    expect((await vouchMany(u, 1, at(23 * HOUR)))[0]).toEqual({ ok: false, error: "daily_limit_reached" });
    expect((await vouchMany(u, 1, at(24 * HOUR + 1)))[0].ok).toBe(true);
  });

  it("gives accounts in good standing more", async () => {
    const u = await fx.user(db, undefined, "standard");
    const rs = await vouchMany(u, DAILY_LIMIT.standard, at(0));
    expect(rs.every((r) => r.ok)).toBe(true);
  });

  it("holds under concurrent submissions", async () => {
    const u = await fx.user(db);
    const resources = await Promise.all(Array.from({ length: DAILY_LIMIT.new + 4 }, () => fx.resource(db)));
    const rs = await Promise.all(
      resources.map((r) => createVouch({ userId: u, resourceId: r, topicSlugs: ["ai"] }, { db, now: at(0) })),
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(DAILY_LIMIT.new);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from vouches where user_id = $1", [u]);
    expect(n).toBe(DAILY_LIMIT.new);
  });

  it("does not count edits against the limit", async () => {
    const u = await fx.user(db);
    const [first] = await vouchMany(u, DAILY_LIMIT.new, at(0));
    const edit = await updateVouch({ userId: u, vouchId: first.ok ? first.vouch.id : "", note: "Edited" }, { db, now: at(HOUR) });
    expect(edit).toMatchObject({ ok: true, vouch: { note: "Edited" } });
    expect(await remainingVouchesToday(db, u, at(HOUR)())).toBe(0);
  });
});

describe("updateVouch and deleteVouch", () => {
  it("edits note and topics but keeps the original vouch time", async () => {
    const u = await fx.user(db);
    const created = await createVouch({ userId: u, resourceId: await fx.resource(db), note: "v1", topicSlugs: ["ai"] }, { db, now: at(0) });
    if (!created.ok) throw new Error(created.error);
    const upd = await updateVouch({ userId: u, vouchId: created.vouch.id, note: "v2", topicSlugs: ["llms"] }, { db, now: at(HOUR) });
    expect(upd).toMatchObject({ ok: true, vouch: { note: "v2" } });
    expect(upd.ok && upd.vouch.created_at.getTime()).toBe(T0.getTime());
    const t = await db.query<{ slug: string }>(
      "select slug from vouch_topics join topics on topics.id = topic_id where vouch_id = $1",
      [created.vouch.id],
    );
    expect(t).toEqual([{ slug: "llms" }]);
  });

  it("leaves the note alone when only topics change", async () => {
    const u = await fx.user(db);
    const c = await createVouch({ userId: u, resourceId: await fx.resource(db), note: "keep me", topicSlugs: ["ai"] }, { db });
    const upd = await updateVouch({ userId: u, vouchId: c.ok ? c.vouch.id : "", topicSlugs: ["gpu"] }, { db });
    expect(upd.ok && upd.vouch.note).toBe("keep me");
  });

  it("can clear a note", async () => {
    const u = await fx.user(db);
    const c = await createVouch({ userId: u, resourceId: await fx.resource(db), note: "remove me", topicSlugs: ["ai"] }, { db });
    const upd = await updateVouch({ userId: u, vouchId: c.ok ? c.vouch.id : "", note: "" }, { db });
    expect(upd.ok && upd.vouch.note).toBeNull();
  });

  it("only lets the author edit or delete", async () => {
    const author = await fx.user(db);
    const other = await fx.user(db);
    const c = await createVouch({ userId: author, resourceId: await fx.resource(db), topicSlugs: ["ai"] }, { db });
    const id = c.ok ? c.vouch.id : "";
    expect(await updateVouch({ userId: other, vouchId: id, note: "hijack" }, { db })).toEqual({ ok: false, error: "vouch_not_found" });
    expect(await deleteVouch(db, other, id)).toBe(false);
    expect(await deleteVouch(db, author, id)).toBe(true);
  });
});
