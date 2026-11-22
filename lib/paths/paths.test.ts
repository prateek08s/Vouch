import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { addToList, createList, deleteList } from "@/lib/lists";
import { deleteAccount, exportAccount } from "@/lib/users/account";
import { pathMetadata, publicPaths, savePath } from "./index";
import { pathProgress } from "./progress";

let db: Awaited<ReturnType<typeof openPglite>>;
beforeAll(async () => { db = await openPglite(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("delete from users; delete from resources"); });

const input = { enabled: true, level: "beginner", prerequisites: "Basic algebra", outcomes: "Explain the core idea\nApply it to an example" };
async function collection(isPublic = true) {
  const owner = await fx.user(db);
  const result = await createList(db, owner, { title: "A deliberate course", isPublic });
  if (!result.ok) throw new Error(result.error);
  return { owner, id: result.list.id };
}

it("saves curator metadata, normalizes duplicate lines, and rejects non-owner edits", async () => {
  const { owner, id } = await collection();
  expect(await savePath(db, owner, id, { ...input, prerequisites: "  Algebra\nAlgebra  " })).toEqual({ ok: true });
  expect(await pathMetadata(db, null, id)).toMatchObject({ prerequisites: ["Algebra"], level: "beginner" });
  const other = await fx.user(db);
  expect((await savePath(db, other, id, { ...input, outcomes: "Replace it" })).ok).toBe(false);
  expect((await pathMetadata(db, null, id))?.outcomes).toEqual(["Explain the core idea", "Apply it to an example"]);
});

it("keeps private paths and their metadata out of public and other-user reads", async () => {
  const { owner, id } = await collection(false);
  await savePath(db, owner, id, input);
  await addToList(db, owner, id, await fx.resource(db));
  expect(await pathMetadata(db, null, id)).toBeNull();
  expect(await pathMetadata(db, await fx.user(db), id)).toBeNull();
  expect(await pathMetadata(db, owner, id)).not.toBeNull();
  expect(await publicPaths(db)).toEqual([]);
});

it("lists only public paths with available lessons and reports incomplete runtime totals", async () => {
  const { owner, id } = await collection();
  await savePath(db, owner, id, input);
  expect(await publicPaths(db)).toEqual([]);
  await addToList(db, owner, id, await fx.resource(db, { durationS: 600 }));
  await addToList(db, owner, id, await fx.resource(db, { durationS: null }));
  await addToList(db, owner, id, await fx.resource(db, { status: "unavailable" }));
  expect(await publicPaths(db)).toMatchObject([{ id, lesson_count: 2, duration_s: 600, unknown_runtime: 1 }]);
});

it("rejects invalid levels, missing outcomes and oversized metadata without changing a path", async () => {
  const { owner, id } = await collection();
  for (const overrides of [{ level: "constructor" }, { outcomes: "" }, { outcomes: "x".repeat(241) }, { prerequisites: Array.from({ length: 9 }, (_, n) => String(n)).join("\n") }]) {
    expect((await savePath(db, owner, id, { ...input, ...overrides })).ok).toBe(false);
  }
  expect(await pathMetadata(db, owner, id)).toBeNull();
});

it("disables a path without removing its lessons and exports/cascades metadata with its owner", async () => {
  const { owner, id } = await collection();
  await addToList(db, owner, id, await fx.resource(db));
  await savePath(db, owner, id, input);
  expect((await exportAccount(db, owner)).learningPaths).toMatchObject([{ list_id: id, level: "beginner" }]);
  expect(await savePath(db, owner, id, { ...input, enabled: false })).toEqual({ ok: true });
  expect(await pathMetadata(db, owner, id)).toBeNull();
  expect(await db.query("select 1 from list_items where list_id = $1", [id])).toHaveLength(1);
  await savePath(db, owner, id, input);
  await deleteAccount(db, owner);
  expect(await db.query("select 1 from learning_paths where list_id = $1", [id])).toEqual([]);
});

it("deletes path metadata when its collection is deleted", async () => {
  const { owner, id } = await collection();
  await savePath(db, owner, id, input);
  await deleteList(db, owner, id);
  expect(await db.query("select 1 from learning_paths where list_id = $1", [id])).toEqual([]);
});

it("counts watched lessons separately from skipped and unavailable lessons", () => {
  const lesson = { resource_id: "a", title: "A", metadata_status: "ok", status: null };
  const result = pathProgress([
    { ...lesson, status: "watched" },
    { ...lesson, resource_id: "b", status: "skipped" },
    { ...lesson, resource_id: "c", metadata_status: "unavailable" },
    { ...lesson, resource_id: "d" },
  ]);
  expect(result).toMatchObject({ total: 3, watched: 1, skipped: 1, unavailable: 1, percent: 33, completed: false, next: { resource_id: "d" } });
  expect(pathProgress([{ ...lesson, status: "skipped" }])).toMatchObject({ completed: false, next: null, review: { resource_id: "a" } });
  expect(pathProgress([]).completed).toBe(false);
  expect(pathProgress([{ ...lesson, status: "watched" }]).completed).toBe(true);
});
