import { beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openPglite, type Db } from "@/lib/db";
import { ensureProfile } from "./profile";
let db: Db;
beforeAll(async () => { db = await openPglite(); });
it("creates one profile and signup event across concurrent callback retries", async () => {
  const identity = { id: randomUUID(), user_metadata: { full_name: "Alex" } };
  const users = await Promise.all([ensureProfile(db, identity), ensureProfile(db, identity)]);
  expect(users[0].id).toBe(users[1].id);
  expect(await db.query("select 1 from events where user_id = $1 and name = 'signup'", [users[0].id])).toHaveLength(1);
});
it("never links a provider identity to an existing account by name", async () => {
  const first = await ensureProfile(db, { id: randomUUID(), user_metadata: { name: "Alex" } });
  const second = await ensureProfile(db, { id: randomUUID(), user_metadata: { name: "Alex" } });
  expect(first.id).not.toBe(second.id);
});
