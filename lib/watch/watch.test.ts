import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { follow } from "@/lib/graph/follows";
import { createVouch } from "@/lib/vouches";
import { rate, recordOpen } from "@/lib/ratings";
import { getWatchData } from "./index";

let db: Db;
beforeAll(async () => {
  db = await openPglite();
});

async function setup() {
  const viewer = await fx.user(db);
  const friend = await fx.user(db, undefined, "founding");
  const stranger = await fx.user(db, undefined, "founding");
  const scout = await fx.user(db, undefined, "founding");
  await follow(db, viewer, friend);
  const r = await fx.resource(db, { title: "Watch me" });
  const t = (h: number) => () => new Date(Date.now() - h * 3_600_000);
  const vf = await createVouch({ userId: friend, resourceId: r, topicSlugs: ["gpu"], note: "friend note" }, { db, now: t(3) });
  const vs = await createVouch({ userId: stranger, resourceId: r, topicSlugs: ["gpu"], note: "stranger note" }, { db, now: t(2) });
  const vc = await createVouch({ userId: scout, resourceId: r, topicSlugs: ["gpu"], note: "scout note" }, { db, now: t(1) });
  if (!vf.ok || !vs.ok || !vc.ok) throw new Error("setup");
  return { viewer, friend, stranger, scout, r, vf: vf.vouch, vs: vs.vouch, vc: vc.vouch };
}

it("returns null for an unknown resource", async () => {
  expect(await getWatchData(db, await fx.user(db), "00000000-0000-0000-0000-000000000000", null)).toBeNull();
});

it("shows circle notes, hides strangers, and counts every public vouch", async () => {
  const s = await setup();
  const w = (await getWatchData(db, s.viewer, s.r, null))!;
  expect(w.notes.map((n) => n.note)).toEqual(["friend note"]);
  expect(w.publicVouchCount).toBe(3);
  expect(w.via).toBeNull();
  expect(w.rating).toBeNull();
  expect(w.topics.map((t) => t.slug)).toEqual(["gpu"]);
});

it("puts the person you came through first, even outside your circle", async () => {
  const s = await setup();
  const w = (await getWatchData(db, s.viewer, s.r, s.vc.id))!;
  expect(w.via?.curatorId).toBe(s.scout);
  expect(w.notes.map((n) => n.note)).toEqual(["scout note", "friend note"]);
});

it("ignores a via id from another resource", async () => {
  const s = await setup();
  const other = await setup();
  const w = (await getWatchData(db, s.viewer, s.r, other.vf.id))!;
  expect(w.via).toBeNull();
});

it("keeps the recorded attribution over a later ?via", async () => {
  const s = await setup();
  await recordOpen(db, { userId: s.viewer, resourceId: s.r, vouchId: s.vf.id });
  const w = (await getWatchData(db, s.viewer, s.r, s.vc.id))!;
  expect(w.via?.curatorId).toBe(s.friend);
});

it("reports the viewer's rating", async () => {
  const s = await setup();
  await rate({ userId: s.viewer, resourceId: s.r, worthIt: false }, { db });
  expect((await getWatchData(db, s.viewer, s.r, null))!.rating).toBe(false);
});
