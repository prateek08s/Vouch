import { expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { recordOpen, rate } from "./index";

it("handles a deleted resource submitted by a stale rating form", async () => {
  const db = await openPglite();
  const userId = await fx.user(db);
  const resourceId = await fx.resource(db);
  await db.query("delete from resources where id = $1", [resourceId]);
  await expect(recordOpen(db, { userId, resourceId, vouchId: null })).resolves.toBeUndefined();
  expect(await rate({ userId, resourceId, worthIt: true }, { db })).toEqual({ ok: false, error: "resource_not_found" });
  expect(await db.query("select 1 from vouch_attribution")).toHaveLength(0);
  expect(await db.query("select 1 from events")).toHaveLength(0);
});
