import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createVouch } from "@/lib/vouches";
import { getWatchData } from "@/lib/watch";
import { search } from "@/lib/search";
import { dismissReports, hideVouch, openReports, reportVouch, suspendUser } from ".";

let db: Db;
beforeAll(async () => { db = await openPglite(); });

async function vouched(note: string) {
  const author = await fx.user(db, undefined, "founding");
  const r = await fx.resource(db, { title: `Video ${note}` });
  const v = await createVouch({ userId: author, resourceId: r, topicSlugs: ["gpu"], note }, { db });
  if (!v.ok) throw new Error("setup");
  return { author, resource: r, vouch: v.vouch.id };
}

it("records one report per person, never on your own vouch, and groups them by vouch", async () => {
  const { author, vouch } = await vouched("buy my course");
  const a = await fx.user(db), b = await fx.user(db);
  expect(await reportVouch(db, a, vouch, "spam", "  link farm  ")).toBe(true);
  expect(await reportVouch(db, a, vouch, "other")).toBe(false);
  expect(await reportVouch(db, author, vouch, "spam")).toBe(false);
  expect(await reportVouch(db, b, vouch, "misleading")).toBe(true);
  const open = (await openReports(db)).find((r) => r.vouchId === vouch)!;
  expect(open.reports).toBe(2);
  expect(open.reasons.sort()).toEqual(["misleading", "spam"]);
  expect(open.details).toEqual(["link farm"]);
});

it("hiding a vouch closes its reports and removes it from the watch page and search", async () => {
  const { resource, vouch } = await vouched("zebraquartz secret phrase");
  const admin = await fx.user(db), reporter = await fx.user(db);
  await reportVouch(db, reporter, vouch, "spam");
  expect((await search(db, reporter, "zebraquartz")).results.length).toBeGreaterThan(0);

  await hideVouch(db, admin, vouch);
  expect((await openReports(db)).some((r) => r.vouchId === vouch)).toBe(false);
  expect((await getWatchData(db, null, resource, null))!.notes).toHaveLength(0);
  expect((await search(db, reporter, "zebraquartz")).results).toHaveLength(0);
  expect(await reportVouch(db, reporter, vouch, "other")).toBe(false);
});

it("dismissing keeps the vouch up", async () => {
  const { resource, vouch } = await vouched("fine actually");
  await reportVouch(db, await fx.user(db), vouch, "harassment");
  await dismissReports(db, await fx.user(db), vouch);
  expect((await openReports(db)).some((r) => r.vouchId === vouch)).toBe(false);
  expect((await getWatchData(db, null, resource, null))!.notes).toHaveLength(1);
});

it("suspending hides every vouch by that person, but never touches system curators", async () => {
  const { author, resource, vouch } = await vouched("first");
  await reportVouch(db, await fx.user(db), vouch, "spam");
  const admin = await fx.user(db);
  expect(await suspendUser(db, admin, author)).toBe(true);
  expect(await suspendUser(db, admin, author)).toBe(false);
  expect((await getWatchData(db, null, resource, null))!.notes).toHaveLength(0);
  expect((await openReports(db)).some((r) => r.vouchId === vouch)).toBe(false);

  const [sys] = await db.query<{ id: string }>(
    "insert into users (username, display_name, is_system) values ('sys_mod_test', 'Sys', true) returning id",
  );
  expect(await suspendUser(db, admin, sys.id)).toBe(false);
});
