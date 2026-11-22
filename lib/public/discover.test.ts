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

it("filters by length and sorts by newest or shortest", async () => {
  const mk = async (title: string, durationS: number, d: number) => {
    const u = await fx.user(db, undefined, "founding");
    const r = await fx.resource(db, { title, durationS });
    const v = await createVouch({ userId: u, resourceId: r, topicSlugs: ["gpu"] }, { db, now: daysAgo(d) });
    if (!v.ok) throw new Error(v.error);
  };
  await mk("Ten minutes", 600, 5);
  await mk("Forty minutes", 2400, 1);
  await mk("Two hours", 7200, 3);
  const titles = async (o: Parameters<typeof discoverPicks>[2]) =>
    (await discoverPicks(db, null, { now: NOW, ...o })).picks.map((p) => p.title);
  expect(await titles({ length: "short" })).toEqual(["Ten minutes"]);
  expect(await titles({ length: "medium" })).toEqual(["Forty minutes"]);
  expect(await titles({ length: "long" })).toEqual(["Two hours"]);
  expect(await titles({ sort: "shortest" })).toEqual(["Ten minutes", "Forty minutes", "Two hours"]);
  expect(await titles({ sort: "newest" })).toEqual(["Forty minutes", "Two hours", "Ten minutes"]);
});

it("credits the Hacker News commenter whose words are the note", async () => {
  const [hn] = await db.query<{ id: string }>(
    "insert into users (username, display_name, is_system) values ('hn_disc_test', 'Hacker News', true) on conflict (username) do update set is_system = true returning id",
  );
  const r = await fx.resource(db, { title: "Quoted" });
  const v = await createVouch({ userId: hn.id, resourceId: r, topicSlugs: ["gpu"], note: "the long, quoted reason" }, { db, now: daysAgo(1) });
  if (!v.ok) throw new Error(v.error);
  await db.query(
    `insert into hn_mentions (comment_id, resource_id, author, posted_at, excerpt) values
       (111, $1, 'alice', '2025-03-02', 'short'), (222, $1, 'bob', '2025-04-10', 'the long, quoted reason'), (333, $1, 'carol', '2025-05-01', null)`,
    [r],
  );
  const [pick] = (await discoverPicks(db, null, { now: NOW })).picks.filter((p) => p.title === "Quoted");
  expect(pick.hn).toMatchObject({ author: "bob", url: "https://news.ycombinator.com/item?id=222", total: 3 });
  expect(pick.hn!.postedAt.toISOString()).toBe("2025-04-10T00:00:00.000Z");
});

it("matches several topics including descendants and fails closed for an unknown topic",async()=>{
  await vouch(["gpu"],1,"Hardware"); await vouch(["biology"],1,"Biology"); await vouch(["web"],1,"Web");
  expect((await discoverPicks(db,null,{topics:["hardware","biology"],now:NOW})).picks.map(p=>p.title).sort()).toEqual(["Biology","Hardware"]);
  expect((await discoverPicks(db,null,{topics:["hardware","missing"],now:NOW})).picks).toEqual([]);
});
it("combines literal channel matching with an inclusive runtime budget",async()=>{
  const a=await vouch(["gpu"],1,"Fits"),b=await vouch(["biology"],1,"Too long"),c=await vouch(["gpu"],1,"Unknown runtime");
  await vouch(["gpu"],1,"Other channel");
  for(const id of [a.r,b.r,c.r]) await db.query("update resources set creator_name=$2 where id=$1",[id,"Teacher %_ + Friends"]);
  await db.query("update resources set duration_s=900 where id=$1",[a.r]);
  await db.query("update resources set duration_s=901 where id=$1",[b.r]);
  await db.query("update resources set duration_s=null where id=$1",[c.r]);
  expect((await discoverPicks(db,null,{topics:["hardware","biology"],channel:"TEACHER %_",maxMinutes:15,now:NOW})).picks.map(p=>p.title)).toEqual(["Fits"]);
  expect((await discoverPicks(db,null,{channel:"' OR true --",now:NOW})).picks).toEqual([]);
});
