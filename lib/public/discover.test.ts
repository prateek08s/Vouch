import { beforeAll, beforeEach, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createVouch } from "@/lib/vouches";
import { rate } from "@/lib/ratings";
import { createRule } from "@/lib/rules";
import { discoverPicks } from "./discover";

let db: Db;
const NOW = new Date("2026-11-19T12:00:00Z");
const daysAgo = (d: number) => () => new Date(NOW.getTime() - d * 86_400_000);
beforeAll(async () => { db = await openPglite(); });
beforeEach(async () => {
  await db.exec("delete from ratings; delete from vouches; delete from rules; delete from resources;");
});

async function vouch(topics = ["gpu"], d = 1, title?: string, channelId?: string) {
  const u = await fx.user(db, undefined, "founding");
  const r = await fx.resource(db, { title, channelId });
  const v = await createVouch({ userId: u, resourceId: r, topicSlugs: topics }, { db, now: daysAgo(d) });
  if (!v.ok) throw new Error(v.error);
  return { u, r };
}

it("ranks a video rated Worth it recently above an unrated one", async () => {
  const a = await vouch(["gpu"], 2, "Unrated");
  const b = await vouch(["gpu"], 2, "Loved");
  for (let i = 0; i < 3; i++) await rate({ userId: await fx.user(db), resourceId: b.r, worthIt: true }, { db, now: () => NOW });
  const { picks } = await discoverPicks(db, null, { now: NOW });
  expect(picks.map((p) => p.title)).toEqual(["Loved", "Unrated"]);
  expect(a).toBeTruthy();
});

it("applies the viewer's rules and leaves out what they rated or vouched", async () => {
  await vouch(["gpu"], 1, "Blocked channel", "UC_blocked");
  const kept = await vouch(["gpu"], 1, "Kept");
  const rated = await vouch(["gpu"], 1, "Already rated");
  const viewer = await fx.user(db);
  await createRule(db, viewer, "channel", "UC_blocked");
  await rate({ userId: viewer, resourceId: rated.r, worthIt: true }, { db, now: () => NOW });
  const res = await discoverPicks(db, viewer, { now: NOW });
  expect(res.picks.map((p) => p.title)).toEqual(["Kept"]);
  expect(res.hiddenByRules).toBe(1);
  expect(kept).toBeTruthy();
});

it("filters by topic, including subtopics, and pages", async () => {
  for (let i = 0; i < 5; i++) await vouch(["gpu"], i + 1);
  await vouch(["biology"], 1, "Biology");
  const hw = await discoverPicks(db, null, { topic: "hardware", limit: 3, now: NOW });
  expect(hw.picks).toHaveLength(3);
  expect(hw.nextCursor).toBe(3);
  const rest = await discoverPicks(db, null, { topic: "hardware", limit: 3, cursor: 3, now: NOW });
  expect(rest.picks).toHaveLength(2);
  expect(rest.nextCursor).toBeNull();
  expect(rest.picks.map((p) => p.title)).not.toContain("Biology");
});
