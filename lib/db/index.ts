import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

/**
 * The only database surface the app depends on. PGlite implements it for local
 * dev and tests; a Supabase/postgres adapter can implement it in production.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** Runs fn atomically. Nested calls reuse the outer transaction. */
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;
}

type PgLike = PGlite | Transaction;

function wrap(pg: PgLike, inTx: boolean): Db {
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pg.query<T>(sql, params);
      return res.rows;
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async transaction<R>(fn: (tx: Db) => Promise<R>) {
      if (inTx) return fn(db);
      return (pg as PGlite).transaction((tx) => fn(wrap(tx, true)));
    },
  };
  return db;
}

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** Applies pending .sql migrations in filename order. Safe to call repeatedly. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )`);
  const done = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name),
  );
  const listing =
    dir === MIGRATIONS_DIR
      ? await readdir(path.join(process.cwd(), "supabase", "migrations"))
      : await readdir(/*turbopackIgnore: true*/ dir);
  const files = listing.filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    // Statically scoped default path, so the bundler traces only supabase/migrations.
    const full =
      dir === MIGRATIONS_DIR
        ? path.join(process.cwd(), "supabase", "migrations", file)
        : path.join(/*turbopackIgnore: true*/ dir, file);
    const sql = await readFile(full, "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

/**
 * Opens a PGlite database. Omit dataDir for an in-memory database.
 * Scripts must call close(): it flushes to disk, and an open PGlite keeps Node from exiting.
 */
export async function openPglite(dataDir?: string): Promise<Db & { close(): Promise<void> }> {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const db = wrap(pg, false);
  await migrate(db);
  return Object.assign(db, { close: () => pg.close() });
}
