import { beforeAll, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { rate } from "@/lib/ratings";
import { setLearningStatus } from "@/lib/learning";
import { createRule } from "@/lib/rules";
import { createVouch } from "@/lib/vouches";
import {
  LIST_MAX_ITEMS,
  addToList,
  createList,
  deleteList,
  followList,
  getList,
  listsFor,
  moveItem,
  removeFromList,
  unfollowList,
  upNextFromLists,
} from "./index";

let db: Db;
beforeAll(async () => {
  db = await openPglite();
});

async function listWith(owner: string, n: number, title = "Learn Rust from Zero") {
  const c = await createList(db, owner, { title });
  if (!c.ok) throw new Error(c.error);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await fx.resource(db, { title: `Part ${i + 1}` });
    const a = await addToList(db, owner, c.list.id, r);
    if (!a.ok) throw new Error(a.error);
    ids.push(r);
  }
  return { list: c.list, ids };
}

const order = async (viewer: string, listId: string) => (await getList(db, viewer, listId))!.items.map((i) => i.title);

describe("create and add", () => {
  it("creates a list with a cleaned title", async () => {
    const r = await createList(db, await fx.user(db), { title: "  Best   GPU talks ", description: " " });
    expect(r).toMatchObject({ ok: true, list: { title: "Best GPU talks", description: null, is_public: true } });
  });

  it.each([
    [{ title: "   " }, "invalid_title"],
    [{ title: "x".repeat(121) }, "invalid_title"],
    [{ title: "ok", description: "x".repeat(501) }, "description_too_long"],
  ])("validates %o", async (input, error) => {
    expect(await createList(db, await fx.user(db), input)).toEqual({ ok: false, error });
  });

  it("appends in order and refuses duplicates", async () => {
    const owner = await fx.user(db);
    const { list, ids } = await listWith(owner, 3);
    expect(await order(owner, list.id)).toEqual(["Part 1", "Part 2", "Part 3"]);
    expect(await addToList(db, owner, list.id, ids[0])).toEqual({ ok: false, error: "already_in_list" });
  });

  it("only lets the owner add", async () => {
    const owner = await fx.user(db);
    const { list } = await listWith(owner, 0);
    expect(await addToList(db, await fx.user(db), list.id, await fx.resource(db))).toEqual({ ok: false, error: "list_not_found" });
  });

  it(`caps lists at ${LIST_MAX_ITEMS} items`, async () => {
    const owner = await fx.user(db);
    const { list } = await listWith(owner, 0);
    await db.query(
      `insert into list_items (list_id, resource_id, position)
       select $1, r.id, row_number() over () - 1 from (select id from resources limit $2) r`,
      [list.id, LIST_MAX_ITEMS],
    );
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from list_items where list_id = $1", [list.id]);
    if (n < LIST_MAX_ITEMS) for (let i = n; i < LIST_MAX_ITEMS; i++) await addToList(db, owner, list.id, await fx.resource(db));
    expect(await addToList(db, owner, list.id, await fx.resource(db))).toEqual({ ok: false, error: "list_full" });
  });
});

describe("reorder and remove", () => {
  it("moves an item and keeps positions contiguous", async () => {
    const owner = await fx.user(db);
    const { list, ids } = await listWith(owner, 4);
    expect(await moveItem(db, owner, list.id, ids[3], 0)).toEqual({ ok: true });
    expect(await order(owner, list.id)).toEqual(["Part 4", "Part 1", "Part 2", "Part 3"]);
    await moveItem(db, owner, list.id, ids[3], 2);
    expect(await order(owner, list.id)).toEqual(["Part 1", "Part 2", "Part 4", "Part 3"]);
    const positions = (await getList(db, owner, list.id))!.items.map((i) => i.position);
    expect(positions).toEqual([0, 1, 2, 3]);
  });

  it("clamps out-of-range moves", async () => {
    const owner = await fx.user(db);
    const { list, ids } = await listWith(owner, 3);
    await moveItem(db, owner, list.id, ids[0], 99);
    expect(await order(owner, list.id)).toEqual(["Part 2", "Part 3", "Part 1"]);
    await moveItem(db, owner, list.id, ids[0], -5);
    expect(await order(owner, list.id)).toEqual(["Part 1", "Part 2", "Part 3"]);
  });

  it("removes and compacts", async () => {
    const owner = await fx.user(db);
    const { list, ids } = await listWith(owner, 3);
    expect(await removeFromList(db, owner, list.id, ids[1])).toEqual({ ok: true });
    const items = (await getList(db, owner, list.id))!.items;
    expect(items.map((i) => [i.title, i.position])).toEqual([["Part 1", 0], ["Part 3", 1]]);
    // Appending after a removal lands at the end, not in a gap.
    const r = await fx.resource(db, { title: "Part 4" });
    expect(await addToList(db, owner, list.id, r)).toEqual({ ok: true, position: 2 });
    expect(await removeFromList(db, owner, list.id, ids[1])).toEqual({ ok: false, error: "not_in_list" });
  });

  it("does not let others reorder, remove, or delete", async () => {
    const owner = await fx.user(db);
    const other = await fx.user(db);
    const { list, ids } = await listWith(owner, 2);
    expect(await moveItem(db, other, list.id, ids[0], 1)).toEqual({ ok: false, error: "list_not_found" });
    expect(await removeFromList(db, other, list.id, ids[0])).toEqual({ ok: false, error: "list_not_found" });
    expect(await deleteList(db, other, list.id)).toBe(false);
    expect(await order(owner, list.id)).toEqual(["Part 1", "Part 2"]);
  });
});

describe("following and privacy", () => {
  it("follows a public list, counts followers, and unfollows", async () => {
    const owner = await fx.user(db);
    const viewer = await fx.user(db);
    const { list } = await listWith(owner, 1);
    expect(await followList(db, viewer, list.id)).toEqual({ ok: true });
    expect(await followList(db, viewer, list.id)).toEqual({ ok: true }); // idempotent
    expect(await getList(db, viewer, list.id)).toMatchObject({ followerCount: 1, isFollowing: true, isOwner: false });
    expect(await unfollowList(db, viewer, list.id)).toBe(true);
    expect(await getList(db, viewer, list.id)).toMatchObject({ followerCount: 0, isFollowing: false });
  });

  it("refuses following your own list", async () => {
    const owner = await fx.user(db);
    const { list } = await listWith(owner, 0);
    expect(await followList(db, owner, list.id)).toEqual({ ok: false, error: "own_list" });
  });

  it("hides private lists from everyone but the owner", async () => {
    const owner = await fx.user(db);
    const viewer = await fx.user(db);
    const c = await createList(db, owner, { title: "Secret", isPublic: false });
    const id = c.ok ? c.list.id : "";
    expect(await getList(db, viewer, id)).toBeNull();
    expect(await followList(db, viewer, id)).toEqual({ ok: false, error: "list_not_found" });
    expect(await getList(db, owner, id)).not.toBeNull();
    expect((await listsFor(db, viewer)).discover.map((l) => l.id)).not.toContain(id);
  });

  it("groups lists into mine, following, and discover", async () => {
    const viewer = await fx.user(db);
    const other = await fx.user(db);
    await listWith(viewer, 0, "Mine");
    const followed = await listWith(other, 1, "Followed");
    const other2 = await listWith(other, 1, "Discoverable");
    const empty = await listWith(other, 0, "Empty");
    await followList(db, viewer, followed.list.id);
    const g = await listsFor(db, viewer);
    expect(g.mine.map((l) => l.title)).toEqual(["Mine"]);
    expect(g.following.map((l) => l.title)).toEqual(["Followed"]);
    const d = g.discover.map((l) => l.id);
    expect(d).toContain(other2.list.id);
    expect(d).not.toContain(empty.list.id); // empty lists are not worth discovering
  });
});

describe("upNextFromLists", () => {
  it("shows the first unfinished item with its position", async () => {
    const owner = await fx.user(db);
    const viewer = await fx.user(db);
    const { list, ids } = await listWith(owner, 4);
    await followList(db, viewer, list.id);
    await rate({ userId: viewer, resourceId: ids[0], worthIt: true }, { db });
    await rate({ userId: viewer, resourceId: ids[1], worthIt: false }, { db });
    await setLearningStatus(db, viewer, ids[0], "watched");
    await setLearningStatus(db, viewer, ids[1], "skipped");
    const [next] = await upNextFromLists(db, viewer);
    expect(next).toMatchObject({ listTitle: "Learn Rust from Zero", index: 2, total: 4, item: { title: "Part 3" } });
  });

  it("skips items blocked by the viewer's rules (rules are absolute in every feed)", async () => {
    const owner = await fx.user(db, undefined, "founding");
    const viewer = await fx.user(db);
    const c = await createList(db, owner, { title: "Mixed" });
    const listId = c.ok ? c.list.id : "";
    const crypto = await fx.resource(db, { title: "Crypto basics" });
    const gpu = await fx.resource(db, { title: "GPU basics" });
    const ok = await fx.resource(db, { title: "Fine" });
    await createVouch({ userId: owner, resourceId: gpu, topicSlugs: ["gpu"] }, { db });
    for (const r of [crypto, gpu, ok]) await addToList(db, owner, listId, r);
    await followList(db, viewer, listId);
    await createRule(db, viewer, "keyword", "crypto");
    await createRule(db, viewer, "topic", "hardware"); // gpu's parent
    const [next] = await upNextFromLists(db, viewer);
    expect(next).toMatchObject({ item: { title: "Fine" }, index: 2, hiddenByRules: 2 });
  });

  it("omits finished lists, unfollowed lists, and lists that went private", async () => {
    const owner = await fx.user(db);
    const viewer = await fx.user(db);
    const done = await listWith(owner, 1, "Done");
    const priv = await listWith(owner, 1, "Went private");
    await followList(db, viewer, done.list.id);
    await followList(db, viewer, priv.list.id);
    await rate({ userId: viewer, resourceId: done.ids[0], worthIt: true }, { db });
    await setLearningStatus(db, viewer, done.ids[0], "watched");
    await db.query("update lists set is_public = false where id = $1", [priv.list.id]);
    expect(await upNextFromLists(db, viewer)).toEqual([]);
  });

  it("skips removed videos", async () => {
    const owner = await fx.user(db);
    const viewer = await fx.user(db);
    const { list, ids } = await listWith(owner, 2);
    await followList(db, viewer, list.id);
    await db.query("update resources set metadata_status = 'unavailable' where id = $1", [ids[0]]);
    const [next] = await upNextFromLists(db, viewer);
    expect(next.item.title).toBe("Part 2");
  });
});
