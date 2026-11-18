import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createVouch } from "@/lib/vouches";
import { rate } from "@/lib/ratings";
import { deleteAccount, exportAccount } from "./account";

let db: Db;
beforeAll(async () => { db = await openPglite(); });

it("exports only the person's own data", async () => {
  const me = await fx.user(db, undefined, "founding");
  const other = await fx.user(db, undefined, "founding");
  const r = await fx.resource(db, { title: "Mine" });
  await createVouch({ userId: me, resourceId: r, topicSlugs: ["gpu"], note: "good" }, { db });
  await rate({ userId: other, resourceId: r, worthIt: false }, { db });
  const data = await exportAccount(db, me);
  expect(data.vouches).toHaveLength(1);
  expect(data.vouches[0]).toMatchObject({ title: "Mine", note: "good", topics: ["gpu"] });
  expect(data.ratings).toEqual([]);
});

it("deletes the account and everything it owns, but never a system account", async () => {
  const me = await fx.user(db, undefined, "founding");
  const r = await fx.resource(db);
  await createVouch({ userId: me, resourceId: r, topicSlugs: ["gpu"] }, { db });
  expect(await deleteAccount(db, me)).toEqual({ authUserId: null });
  expect(await db.query("select 1 from vouches where user_id = $1", [me])).toEqual([]);
  const sys = await fx.user(db);
  await db.query("update users set is_system = true where id = $1", [sys]);
  expect(await deleteAccount(db, sys)).toBeNull();
});
