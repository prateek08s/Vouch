import { expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createVouch } from "@/lib/vouches";
import { recordOpen } from "@/lib/ratings";
import { getWatchData } from "./index";

it("does not replace a recorded direct visit with later referral credit", async () => {
  const db = await openPglite();
  const viewer = await fx.user(db);
  const curator = await fx.user(db);
  const resourceId = await fx.resource(db);
  const v = await createVouch({ userId: curator, resourceId, topicSlugs: ["gpu"] }, { db });
  if (!v.ok) throw new Error(v.error);
  await recordOpen(db, { userId: viewer, resourceId, vouchId: null });
  const watch = await getWatchData(db, viewer, resourceId, v.vouch.id);
  expect(watch?.via).toBeNull();
});
