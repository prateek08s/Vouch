import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { updateProfile } from ".";

let db: Db;
beforeAll(async () => { db = await openPglite(); });

it("updates name, username and bio, and normalises the username", async () => {
  const id = await fx.user(db);
  const r = await updateProfile(db, id, { username: "@Prateek_S", displayName: "  Prateek   Sachan ", bio: "Talks over tutorials." });
  expect(r.ok && [r.user.username, r.user.display_name, r.user.bio]).toEqual(["prateek_s", "Prateek Sachan", "Talks over tutorials."]);
});

it("refuses a taken or malformed username and leaves the profile unchanged", async () => {
  await fx.user(db, "taken_name");
  const id = await fx.user(db, "mine_name");
  expect(await updateProfile(db, id, { username: "taken_name", displayName: "X", bio: "" })).toEqual({ ok: false, error: "username_taken" });
  expect(await updateProfile(db, id, { username: "no spaces", displayName: "X", bio: "" })).toEqual({ ok: false, error: "invalid_username" });
  const [u] = await db.query<{ username: string }>("select username from users where id = $1", [id]);
  expect(u.username).toBe("mine_name");
});

it("never edits a system account", async () => {
  const id = await fx.user(db, "hackernews_x");
  await db.query("update users set is_system = true where id = $1", [id]);
  expect((await updateProfile(db, id, { username: "hijacked", displayName: "X", bio: "" })).ok).toBe(false);
});
