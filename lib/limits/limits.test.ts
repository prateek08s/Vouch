import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import { LIMITS, allow } from ".";

let db: Db;
beforeAll(async () => { db = await openPglite(); });

it("allows up to the limit in a window, then refuses, and resets in the next window", async () => {
  const t = new Date("2026-11-19T10:00:05Z");
  for (let i = 0; i < LIMITS.ingest.max; i++) expect(await allow(db, "ingest", "u1", t)).toBe(true);
  expect(await allow(db, "ingest", "u1", t)).toBe(false);
  expect(await allow(db, "ingest", "u2", t)).toBe(true);
  expect(await allow(db, "ingest", "u1", new Date("2026-11-19T11:00:05Z"))).toBe(true);
});

it("counts concurrent hits exactly once each", async () => {
  const t = new Date("2026-11-19T12:00:00Z");
  const results = await Promise.all(Array.from({ length: LIMITS.ingest.max + 5 }, () => allow(db, "ingest", "burst", t)));
  expect(results.filter(Boolean)).toHaveLength(LIMITS.ingest.max);
});
