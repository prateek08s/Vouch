import { expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import { user } from "@/lib/test/fixtures";
import { createRule, listRules } from "./index";

it("rejects conflicting duration rules submitted concurrently", async () => {
  const db = await openPglite();
  const id = await user(db);
  const results = await Promise.all([
    createRule(db, id, "min_duration", "30"),
    createRule(db, id, "max_duration", "10"),
  ]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(results.find(r => !r.ok)).toEqual({ ok: false, error: "min_exceeds_max" });
  expect(await listRules(db, id)).toHaveLength(1);
});
