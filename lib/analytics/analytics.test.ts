import { beforeEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import { rate } from "@/lib/ratings";
import { resource, user } from "@/lib/test/fixtures";
import { impressionReport, markOpened, recordImpressions } from ".";

let db: Db;
const H = 3_600_000;
const t0 = new Date("2026-11-04T10:00:00Z");
const at = (hours: number) => new Date(t0.getTime() + hours * H);

beforeEach(async () => {
  db = await openPglite();
});

async function count(userId: string) {
  const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from recommendation_impressions where user_id = $1", [userId]);
  return n;
}

describe("recordImpressions", () => {
  it("records each shown video with its source and explanation", async () => {
    const me = await user(db);
    const [a, b] = [await resource(db), await resource(db)];
    expect(await recordImpressions(db, me, "circle", [
      { resourceId: a, explanationCode: "circle_topic_trust" },
      { resourceId: b, explanationCode: "circle_follow" },
    ], t0)).toBe(2);
    const rows = await db.query<{ source_type: string; explanation_code: string }>(
      "select source_type, explanation_code from recommendation_impressions order by explanation_code",
    );
    expect(rows).toEqual([
      { source_type: "circle", explanation_code: "circle_follow" },
      { source_type: "circle", explanation_code: "circle_topic_trust" },
    ]);
  });

  it("counts a reload within 6 hours once, but a later visit again", async () => {
    const me = await user(db);
    const a = await resource(db);
    const item = [{ resourceId: a, explanationCode: "circle_follow" }];
    await recordImpressions(db, me, "circle", item, at(0));
    expect(await recordImpressions(db, me, "circle", item, at(5))).toBe(0);
    expect(await recordImpressions(db, me, "circle", item, at(7))).toBe(1);
    expect(await count(me)).toBe(2);
  });

  it("keeps sources apart: the same video in search and the Circle is two impressions", async () => {
    const me = await user(db);
    const a = await resource(db);
    await recordImpressions(db, me, "circle", [{ resourceId: a, explanationCode: "circle_follow" }], t0);
    expect(await recordImpressions(db, me, "search", [{ resourceId: a, explanationCode: "search_match" }], t0)).toBe(1);
  });

  it("ignores duplicates in one call and videos that no longer exist", async () => {
    const me = await user(db);
    const a = await resource(db);
    const gone = "00000000-0000-4000-8000-000000000000";
    expect(await recordImpressions(db, me, "list", [
      { resourceId: a, explanationCode: "list_next" },
      { resourceId: a, explanationCode: "list_next" },
      { resourceId: gone, explanationCode: "list_next" },
    ], t0)).toBe(1);
  });

  it("does nothing for an empty page", async () => {
    expect(await recordImpressions(db, await user(db), "circle", [], t0)).toBe(0);
  });
});

describe("markOpened", () => {
  it("marks the latest impression of that video as opened, once", async () => {
    const me = await user(db);
    const a = await resource(db);
    await recordImpressions(db, me, "circle", [{ resourceId: a, explanationCode: "circle_follow" }], at(0));
    await recordImpressions(db, me, "search", [{ resourceId: a, explanationCode: "search_match" }], at(1));
    expect(await markOpened(db, me, a, at(2))).toBe(true);
    expect(await markOpened(db, me, a, at(3))).toBe(true); // the remaining, older one
    expect(await markOpened(db, me, a, at(4))).toBe(false); // nothing left to open
    const rows = await db.query<{ source_type: string; opened_at: Date }>(
      "select source_type, opened_at from recommendation_impressions order by shown_at",
    );
    expect(rows.map((r) => [r.source_type, r.opened_at.toISOString()])).toEqual([
      ["circle", at(3).toISOString()],
      ["search", at(2).toISOString()],
    ]);
  });

  it("does not credit an impression from more than a week ago, or another person's", async () => {
    const me = await user(db);
    const other = await user(db);
    const a = await resource(db);
    await recordImpressions(db, me, "circle", [{ resourceId: a, explanationCode: "circle_follow" }], at(0));
    expect(await markOpened(db, other, a, at(1))).toBe(false);
    expect(await markOpened(db, me, a, at(24 * 8))).toBe(false);
  });
});

describe("impressionReport", () => {
  it("shows shown, opened, rated and Worth It per source and explanation", async () => {
    const [me, you] = [await user(db), await user(db)];
    const [a, b, c] = [await resource(db), await resource(db), await resource(db)];
    await recordImpressions(db, me, "circle", [
      { resourceId: a, explanationCode: "circle_topic_trust" },
      { resourceId: b, explanationCode: "circle_follow" },
    ], at(0));
    await recordImpressions(db, you, "circle", [{ resourceId: a, explanationCode: "circle_topic_trust" }], at(0));
    await recordImpressions(db, me, "list", [{ resourceId: c, explanationCode: "list_next" }], at(0));

    await markOpened(db, me, a, at(1));
    await rate({ userId: me, resourceId: a, worthIt: true }, { db, now: () => at(2) });
    await markOpened(db, you, a, at(1));
    await rate({ userId: you, resourceId: a, worthIt: false }, { db, now: () => at(2) });
    // A rating from before the video was shown does not count toward the impression.
    await rate({ userId: me, resourceId: b, worthIt: true }, { db, now: () => at(-1) });

    expect(await impressionReport(db)).toEqual([
      { source: "circle", explanation: "circle_topic_trust", shown: 2, opened: 2, rated: 2, worthIt: 1 },
      { source: "circle", explanation: "circle_follow", shown: 1, opened: 0, rated: 0, worthIt: 0 },
      { source: "list", explanation: "list_next", shown: 1, opened: 0, rated: 0, worthIt: 0 },
    ]);
  });
});
