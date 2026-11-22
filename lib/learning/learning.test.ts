import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createList, addToList, followList, getList, upNextFromLists } from "@/lib/lists";
import { createRule } from "@/lib/rules";
import { rate } from "@/lib/ratings";
import { deleteAccount, exportAccount } from "@/lib/users/account";
import { learningLibrary, learningState, savePlayback, setLearningStatus, setSaved } from "./index";

let db: Awaited<ReturnType<typeof openPglite>>;
beforeAll(async () => { db = await openPglite(); });
afterAll(async () => { await db.close(); });

it("keeps saving and ratings separate from watched progress", async () => {
  const user = await fx.user(db);
  const resource = await fx.resource(db);
  await setSaved(db, user, resource, true);
  await setSaved(db, user, resource, true);
  await rate({ userId: user, resourceId: resource, worthIt: true }, { db });
  expect(await learningState(db, user, resource)).toEqual({ saved: true, status: null, positionS: 0 });
  expect((await learningLibrary(db, user))).toHaveLength(1);
});

it("uses explicit watched and skipped states for list advancement, including unrated videos", async () => {
  const user = await fx.user(db);
  const owner = await fx.user(db);
  const list = await createList(db, owner, { title: "Three steps" });
  if (!list.ok) throw new Error("fixture list failed");
  const ids = await Promise.all([fx.resource(db), fx.resource(db), fx.resource(db)]);
  for (const id of ids) await addToList(db, owner, list.list.id, id);
  await followList(db, user, list.list.id);
  await rate({ userId: user, resourceId: ids[0], worthIt: false }, { db });
  expect((await upNextFromLists(db, user))[0].item.resource_id).toBe(ids[0]);
  await setLearningStatus(db, user, ids[0], "watched");
  await setLearningStatus(db, user, ids[1], "skipped");
  expect((await upNextFromLists(db, user))[0].item.resource_id).toBe(ids[2]);
});

it("clamps positions, rejects delayed samples and preserves an explicit skip", async () => {
  const user = await fx.user(db);
  const resource = await fx.resource(db, { durationS: 100 });
  const now = new Date("2026-11-20T10:00:00Z");
  const sample = (positionS: number, seconds: number) =>
    savePlayback(db, user, resource, { positionS, observedAt: now.getTime() + seconds * 1000 }, new Date(now.getTime() + seconds * 1000));
  expect(await sample(30, 0)).toBe(true);
  expect(await sample(20, -1)).toBe(false);
  expect((await learningState(db, user, resource)).positionS).toBe(30);
  await setLearningStatus(db, user, resource, "skipped", new Date(now.getTime() + 1000));
  expect(await sample(500, 2)).toBe(true);
  expect(await learningState(db, user, resource)).toMatchObject({ status: "skipped", positionS: 100 });
  await setLearningStatus(db, user, resource, "in_progress", new Date(now.getTime() + 3000));
  expect(await learningState(db, user, resource)).toMatchObject({ status: "in_progress", positionS: 0 });
});

it("marks a known-duration video watched at 90 percent and a video with unknown duration when ended", async () => {
  const user = await fx.user(db);
  const known = await fx.resource(db, { durationS: 100 });
  const unknown = await fx.resource(db, { durationS: null });
  const now = new Date();
  await savePlayback(db, user, known, { positionS: 90, observedAt: now.getTime() }, now);
  await savePlayback(db, user, unknown, { positionS: 45, observedAt: now.getTime(), ended: true }, now);
  expect((await learningState(db, user, known)).status).toBe("watched");
  expect((await learningState(db, user, unknown)).status).toBe("watched");
});

it("refuses invalid and unavailable playback updates", async () => {
  const user = await fx.user(db);
  const resource = await fx.resource(db, { status: "unavailable" });
  const now = new Date();
  expect(await savePlayback(db, user, resource, { positionS: 2, observedAt: now.getTime() }, now)).toBe(false);
  const available = await fx.resource(db);
  for (const input of [
    { positionS: NaN, observedAt: now.getTime() },
    { positionS: -1, observedAt: now.getTime() },
    { positionS: 10, observedAt: now.getTime() + 60_000 },
    { positionS: 10, observedAt: now.getTime() - 180_000 },
  ]) expect(await savePlayback(db, user, available, input, now)).toBe(false);
});

it("keeps account histories separate and filters blocked videos from the learning library and followed list", async () => {
  const user = await fx.user(db);
  const other = await fx.user(db);
  const resource = await fx.resource(db, { channelId: "UC_hidden" });
  await setSaved(db, user, resource, true);
  expect(await learningLibrary(db, other)).toEqual([]);
  const list = await createList(db, other, { title: "Public" });
  if (!list.ok) throw new Error("fixture list failed");
  await addToList(db, other, list.list.id, resource);
  expect((await getList(db, null, list.list.id))?.items).toHaveLength(1);
  await createRule(db, user, "channel", "UC_hidden");
  expect(await learningLibrary(db, user)).toEqual([]);
  expect(await getList(db, user, list.list.id)).toMatchObject({ items: [], hiddenByRules: 1 });
  expect((await getList(db, other, list.list.id))?.items).toHaveLength(1);
});

it("exports learning data and cascades it on account deletion", async () => {
  const user = await fx.user(db);
  const other = await fx.user(db);
  const resource = await fx.resource(db);
  await setSaved(db, user, resource, true);
  await setLearningStatus(db, user, resource, "watched");
  expect(await exportAccount(db, user)).toMatchObject({
    savedVideos: [expect.objectContaining({ title: expect.any(String) })],
    watchProgress: [expect.objectContaining({ status: "watched" })],
  });
  expect((await exportAccount(db, other)).savedVideos).toEqual([]);
  await deleteAccount(db, user);
  expect(await db.query("select 1 from saved_resources where user_id = $1", [user])).toEqual([]);
  expect(await db.query("select 1 from watch_progress where user_id = $1", [user])).toEqual([]);
});

it("upgrades existing data without turning future ratings into watched history", async () => {
  const tables = await db.query<{ rowsecurity: boolean }>("select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'saved_resources'");
  expect(tables[0].rowsecurity).toBe(true);
  const user = await fx.user(db);
  const resource = await fx.resource(db);
  await rate({ userId: user, resourceId: resource, worthIt: true }, { db });
  expect((await learningState(db, user, resource)).status).toBeNull();
});

it("preserves data when upgrading a local build with the earlier migration filename", async () => {
  const user = await fx.user(db);
  const resource = await fx.resource(db);
  const rated = await fx.resource(db);
  await setSaved(db, user, resource, true);
  await setLearningStatus(db, user, resource, "skipped");
  await rate({ userId: user, resourceId: rated, worthIt: true }, { db });
  await db.query("insert into schema_migrations (name) values ('0014_learning_progress.sql') on conflict do nothing");
  const sql = await readFile("supabase/migrations/0015_learning_progress.sql", "utf8");
  await db.transaction((tx) => tx.exec(sql));
  expect(await learningState(db, user, resource)).toMatchObject({ saved: true, status: "skipped" });
  expect((await learningState(db, user, rated)).status).toBeNull();
});