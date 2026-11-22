import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { addToList, createList, removeFromList } from "@/lib/lists";
import { deleteAccount, exportAccount } from "@/lib/users/account";
import { addLessonResource, lessonResources, removeLessonResource, resourceUrl } from "./index";

let db: Awaited<ReturnType<typeof openPglite>>;
beforeAll(async () => { db = await openPglite(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("delete from users; delete from resources"); });

async function fixture(isPublic = true) {
  const owner = await fx.user(db);
  const result = await createList(db, owner, { title: "Resources course", isPublic });
  if (!result.ok) throw new Error(result.error);
  const video = await fx.resource(db);
  await addToList(db, owner, result.list.id, video);
  return { owner, list: result.list.id, video };
}
const input = { kind: "code", title: "Example code", url: "https://example.org/code" };

it("allows the owner to add resources and scopes reads to the lesson", async () => {
  const { owner, list, video } = await fixture();
  expect(await addLessonResource(db, owner, list, video, input)).toEqual({ ok: true });
  expect(await lessonResources(db, null, list, video)).toMatchObject([{ title: "Example code", kind: "code", url: input.url }]);
  expect(await lessonResources(db, null, list, await fx.resource(db))).toEqual([]);
});

it("rejects another owner's edits, unknown lessons, and cross-lesson removal", async () => {
  const { owner, list, video } = await fixture();
  const other = await fx.user(db);
  expect((await addLessonResource(db, other, list, video, input)).ok).toBe(false);
  expect((await addLessonResource(db, owner, list, await fx.resource(db), input)).ok).toBe(false);
  await addLessonResource(db, owner, list, video, input);
  const [attachment] = await lessonResources(db, owner, list);
  expect((await removeLessonResource(db, other, list, video, attachment.id)).ok).toBe(false);
  expect((await removeLessonResource(db, owner, list, await fx.resource(db), attachment.id)).ok).toBe(false);
  expect(await lessonResources(db, null, list)).toHaveLength(1);
});

it("never exposes private collection resources to guests or another account", async () => {
  const { owner, list, video } = await fixture(false);
  await addLessonResource(db, owner, list, video, input);
  expect(await lessonResources(db, null, list)).toEqual([]);
  expect(await lessonResources(db, await fx.user(db), list)).toEqual([]);
  expect(await lessonResources(db, owner, list)).toHaveLength(1);
});

it("rejects unsafe URLs, credentials, invalid types and oversized titles", async () => {
  const { owner, list, video } = await fixture();
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "//example.org/a", "http://example.org/a", "https://user:secret@example.org/a", "invalid"]) {
    expect(resourceUrl(url)).toBeNull();
    expect((await addLessonResource(db, owner, list, video, { ...input, url })).ok).toBe(false);
  }
  expect((await addLessonResource(db, owner, list, video, { ...input, kind: "constructor" })).ok).toBe(false);
  expect((await addLessonResource(db, owner, list, video, { ...input, title: "x".repeat(121) })).ok).toBe(false);
  expect(resourceUrl(" https://EXAMPLE.org ")).toBe("https://example.org/");
});

it("rejects duplicate normalized URLs and caps resources at eight without losing saved links", async () => {
  const { owner, list, video } = await fixture();
  await addLessonResource(db, owner, list, video, { ...input, url: "https://EXAMPLE.org" });
  expect((await addLessonResource(db, owner, list, video, { ...input, url: "https://example.org/" })).ok).toBe(false);
  for (let n = 1; n < 8; n++) await addLessonResource(db, owner, list, video, { ...input, url: `https://example.org/${n}` });
  expect((await addLessonResource(db, owner, list, video, input)).ok).toBe(false);
  expect(await lessonResources(db, null, list)).toHaveLength(8);
});

it("exports only owned links and cascades resources when a lesson or account is removed", async () => {
  const { owner, list, video } = await fixture();
  await addLessonResource(db, owner, list, video, input);
  expect((await exportAccount(db, owner)).lessonResources).toMatchObject([{ title: "Example code", url: input.url }]);
  expect((await exportAccount(db, await fx.user(db))).lessonResources).toEqual([]);
  const [attachment] = await lessonResources(db, owner, list);
  expect(await removeLessonResource(db, owner, list, video, attachment.id)).toEqual({ ok: true });
  await addLessonResource(db, owner, list, video, input);
  await removeFromList(db, owner, list, video);
  expect(await lessonResources(db, null, list)).toEqual([]);
  await addToList(db, owner, list, video);
  await addLessonResource(db, owner, list, video, input);
  await deleteAccount(db, owner);
  expect(await db.query("select 1 from lesson_resources")).toEqual([]);
});

it("supports roadmap references with the same ownership and privacy as other lesson resources", async () => {
  const { owner, list, video } = await fixture(false);
  expect(await addLessonResource(db, owner, list, video, { kind: "roadmap", title: "Suggested learning sequence", url: "https://example.org/roadmap" })).toEqual({ ok: true });
  expect(await lessonResources(db, null, list)).toEqual([]);
  expect(await lessonResources(db, owner, list)).toMatchObject([{ kind: "roadmap", title: "Suggested learning sequence" }]);
  expect((await exportAccount(db, owner)).lessonResources).toMatchObject([{ kind: "roadmap" }]);
});