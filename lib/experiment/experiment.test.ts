import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { experimentOn, experimentReport, isAnonId, pruneAnonEvents, recordAnon, recordAnonRating, variantFor } from ".";

let db: Db;
beforeAll(async () => { db = await openPglite(); });

const A = "11111111-1111-4111-8111-111111111100"; // ends 00: even, sees the note
const B = "22222222-2222-4222-8222-2222222222ff"; // ends ff: odd, doesn't

it("assigns a stable variant per browser and validates ids", () => {
  expect(variantFor(A)).toBe("note");
  expect(variantFor(B)).toBe("nonote");
  expect(isAnonId(A)).toBe(true);
  expect(isAnonId("not-a-uuid")).toBe(false);
  expect(experimentOn({})).toBe(false);
  expect(experimentOn({ VOUCH_NOTE_EXPERIMENT: "1" })).toBe(true);
});

it("counts impressions and opens once, keeps the latest rating, and reports totals per variant", async () => {
  const r1 = await fx.resource(db, { title: "One" });
  const r2 = await fx.resource(db, { title: "Two" });
  await recordAnon(db, A, "note", "impression", [r1, r2]);
  await recordAnon(db, A, "note", "impression", [r1]);
  await recordAnon(db, A, "note", "open", [r1]);
  await recordAnonRating(db, A, "note", r1, false);
  await recordAnonRating(db, A, "note", r1, true);
  await recordAnon(db, B, "nonote", "impression", [r1, "33333333-3333-4333-8333-333333333333"]);

  const report = await experimentReport(db);
  expect(report).toEqual([
    { variant: "nonote", visitors: 1, returning: 0, shown: 1, opened: 0, worth: 0, notWorth: 0 },
    { variant: "note", visitors: 1, returning: 0, shown: 2, opened: 1, worth: 1, notWorth: 0 },
  ]);
});

it("counts a browser seen on two days as returning, and prunes after 90 days", async () => {
  const r = await fx.resource(db, { title: "Old" });
  const C = "44444444-4444-4444-8444-444444444402";
  await recordAnon(db, C, "note", "impression", [r]);
  await db.query("update anon_events set created_at = now() - interval '2 days' where anon_id = $1", [C]);
  await recordAnon(db, C, "note", "open", [r]);
  expect((await experimentReport(db)).find((x) => x.variant === "note")!.returning).toBe(1);

  await db.query("update anon_events set created_at = now() - interval '91 days' where anon_id = $1", [C]);
  expect(await pruneAnonEvents(db)).toBe(2);
});
