import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createVouch } from "@/lib/vouches";
import { publicPicks, publicProfile } from "./index";
let db: Db;
beforeAll(async () => { db = await openPglite(); });
it("shows endorsed available videos and omits private list metadata", async () => {
  const id = await fx.user(db, "public_curator");
  const available = await fx.resource(db);
  const removed = await fx.resource(db);
  await createVouch({ userId: id, resourceId: available, topicSlugs: ["gpu"] }, { db });
  await createVouch({ userId: id, resourceId: removed, topicSlugs: ["gpu"] }, { db });
  await db.query("update resources set metadata_status = 'unavailable' where id = $1", [removed]);
  await db.query("insert into lists (owner_id, title, is_public) values ($1, 'Secret', false)", [id]);
  const profile = await publicProfile(db, "public_curator");
  expect(profile?.picks.map(p => p.id)).toEqual([available]);
  expect(profile?.lists).toEqual([]);
  expect(Object.keys(profile!)).not.toContain("auth_user_id");
  expect(await publicPicks(db)).toHaveLength(1);
});
it("returns null for an unknown curator", async () => {
  expect(await publicProfile(db, "missing")).toBeNull();
});
