import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openPglite, type Db } from "./index";

let db: Db;

async function makeUser(username: string): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    "insert into users (username, display_name) values ($1, $1) returning id",
    [username],
  );
  return row.id;
}

async function makeResource(externalId: string): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into resources (source, external_id, canonical_url, title)
     values ('youtube', $1, 'https://www.youtube.com/watch?v=' || $1, 'T') returning id`,
    [externalId],
  );
  return row.id;
}

/** Asserts a statement is rejected by the database itself. */
async function rejects(sql: string, params: unknown[] = []) {
  await expect(db.query(sql, params)).rejects.toThrow();
}

beforeAll(async () => {
  db = await openPglite();
});

describe("migrations", () => {
  it("records every migration once", async () => {
    const rows = await db.query<{ name: string }>("select name from schema_migrations order by name");
    expect(rows.map((r) => r.name)).toEqual(["0001_core_schema.sql", "0002_seed_topics.sql", "0003_nest_topics.sql", "0004_list_items_added.sql", "0005_hn_import.sql", "0006_onboarding.sql", "0007_hn_mentions_per_video.sql", "0008_managed_auth.sql"]);
  });

  it("is idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it("seeds a launch taxonomy of 30 to 50 topics, nested as in the plan", async () => {
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from topics");
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(50);
    const [gpu] = await db.query<{ parent: string }>(
      `select p.slug as parent from topics t join topics p on p.id = t.parent_topic_id where t.slug = 'gpu'`,
    );
    expect(gpu.parent).toBe("hardware");
  });

  it("refuses to make a topic its own ancestor", async () => {
    await expect(
      db.query("update topics set parent_topic_id = (select id from topics where slug = 'gpu') where slug = 'technology'"),
    ).rejects.toThrow(/own ancestor/);
    await expect(
      db.query("update topics set parent_topic_id = id where slug = 'ai'"),
    ).rejects.toThrow(/own ancestor/);
  });
});

describe("schema invariants", () => {
  it("allows one resource per (source, external_id)", async () => {
    await makeResource("aaaaaaaaaaa");
    await expect(makeResource("aaaaaaaaaaa")).rejects.toThrow(/unique|duplicate/i);
  });

  it("allows one vouch per user per resource", async () => {
    const u = await makeUser("dup_voucher");
    const r = await makeResource("bbbbbbbbbbb");
    const sql = "insert into vouches (user_id, resource_id) values ($1, $2)";
    await db.query(sql, [u, r]);
    await rejects(sql, [u, r]);
  });

  it("caps vouch notes at 280 characters", async () => {
    const u = await makeUser("long_note");
    const r = await makeResource("ccccccccccc");
    const sql = "insert into vouches (user_id, resource_id, note) values ($1, $2, $3)";
    await rejects(sql, [u, r, "x".repeat(281)]);
    await db.query(sql, [u, r, "x".repeat(280)]);
  });

  it("rejects self-follows", async () => {
    const u = await makeUser("narcissus");
    await rejects("insert into follows (follower_id, followee_id) values ($1, $1)", [u]);
  });

  it("keeps trust within 0.2 and 3.0", async () => {
    const a = await makeUser("truster");
    const b = await makeUser("trustee");
    const sql = "insert into trust_edges (user_id, curator_id, base_weight) values ($1, $2, $3)";
    await rejects(sql, [a, b, 3.01]);
    await rejects(sql, [a, b, 0.19]);
    await db.query(sql, [a, b, 3.0]);
  });

  it("enforces username format and uniqueness", async () => {
    await makeUser("priya");
    await expect(makeUser("priya")).rejects.toThrow();
    await expect(makeUser("Priya")).rejects.toThrow(); // must be lowercase
    await expect(makeUser("a")).rejects.toThrow(); // too short
  });

  it("only accepts known analytics events", async () => {
    await rejects("insert into events (name) values ('time_on_site')");
    await db.query("insert into events (name) values ('vouch_created')");
  });

  it("deletes a user's private data with the account", async () => {
    const u = await makeUser("leaving");
    const c = await makeUser("curator_x");
    const r = await makeResource("ddddddddddd");
    await db.query("insert into follows (follower_id, followee_id) values ($1, $2)", [u, c]);
    await db.query("insert into ratings (user_id, resource_id, worth_it) values ($1, $2, true)", [u, r]);
    await db.query("insert into vouches (user_id, resource_id) values ($1, $2)", [u, r]);

    await db.query("delete from users where id = $1", [u]);

    for (const t of ["follows where follower_id", "ratings where user_id", "vouches where user_id"]) {
      const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from ${t} = $1`, [u]);
      expect(n, t).toBe(0);
    }
    // The shared resource and the other user survive.
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from resources where id = $1", [r]);
    expect(n).toBe(1);
  });

  it("rolls back a failed transaction completely", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("insert into users (username, display_name) values ('ghost', 'Ghost')");
        await tx.query("insert into users (username, display_name) values ('ghost', 'Ghost')");
      }),
    ).rejects.toThrow();
    const rows = await db.query("select 1 from users where username = 'ghost'");
    expect(rows).toHaveLength(0);
  });
});
