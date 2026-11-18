// Removes accounts that can't sign in: every non-system user without a Supabase Auth identity.
// That covers the old demo curators (Alex, Priya, Arjun, Maya, James) and anyone created with the
// removed name-only sign-up. Their vouches, ratings, follows, lists and trust edges go with them
// (foreign keys cascade). System curators such as "Hacker News" are kept.
//
//   node scripts/remove-local-accounts.mjs --dry-run      list what would be removed
//   node scripts/remove-local-accounts.mjs                remove (local PGlite: stop the dev server first)
//
// Uses DATABASE_URL when set, otherwise the local PGlite directory (VOUCH_DATA_DIR, default .data/pglite).
// For PGlite, a copy of the directory is saved next to it before anything is deleted.
import { cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const FIND = `select u.id, u.username, u.display_name,
  (select count(*)::int from vouches v where v.user_id = u.id) as vouches,
  (select count(*)::int from ratings r where r.user_id = u.id) as ratings
  from users u where u.auth_user_id is null and not u.is_system order by u.display_name`;

let query, transaction, close, label;
if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  label = "Postgres (DATABASE_URL)";
  query = async (sql, params) => (await pool.query(sql, params)).rows;
  transaction = async (fn) => {
    const c = await pool.connect();
    try { await c.query("BEGIN"); const r = await fn((sql, p) => c.query(sql, p).then((x) => x.rows)); await c.query("COMMIT"); return r; }
    catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  };
  close = () => pool.end();
} else {
  const dir = process.env.VOUCH_DATA_DIR ?? path.join(".data", "pglite");
  if (!existsSync(dir)) { console.error(`No database at ${dir}.`); process.exit(1); }
  if (!dryRun) {
    const backup = `${dir}-backup-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
    await cp(dir, backup, { recursive: true });
    console.log(`Backed up ${dir} to ${backup}`);
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dir);
  await db.waitReady;
  label = dir;
  query = async (sql, params) => (await db.query(sql, params)).rows;
  transaction = (fn) => db.transaction((tx) => fn((sql, p) => tx.query(sql, p).then((x) => x.rows)));
  close = () => db.close();
}

const users = await query(FIND);
console.log(`${label}: ${users.length} account(s) without a sign-in identity.`);
for (const u of users) console.log(`  ${u.display_name} (@${u.username}): ${u.vouches} vouches, ${u.ratings} ratings`);

if (users.length && !dryRun) {
  const removed = await transaction(async (q) => {
    const rows = await q("delete from users where auth_user_id is null and not is_system returning id");
    return rows.length;
  });
  const [{ n }] = await query("select count(*)::int as n from users");
  console.log(`Removed ${removed} account(s). ${n} account(s) remain.`);
} else if (dryRun) {
  console.log("Dry run: nothing was changed.");
}
await close();
process.exit(0);
