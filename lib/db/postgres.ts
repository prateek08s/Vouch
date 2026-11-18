import { Pool, type PoolClient } from "pg";
import type { Db } from "./index";

function transactionDb(client: PoolClient): Db {
  const db: Db = {
    async query<T>(sql: string, params?: unknown[]) {
      return (await client.query(sql, params)).rows as T[];
    },
    async exec(sql) { await client.query(sql); },
    async transaction(fn) { return fn(db); },
  };
  return db;
}

/** Every transaction uses one checked-out connection, including nested calls. */
export function postgresDb(pool: Pool): Db {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql) { await pool.query(sql); },
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        const result = await fn(transactionDb(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); }
        catch { broken = true; }
        throw error;
      } finally {
        client.release(broken);
      }
    },
  };
}

/**
 * Production pool. On serverless hosting every instance has its own pool, so keep it small and
 * point DATABASE_URL at Supabase's transaction pooler (port 6543), which shares connections across
 * instances. Migrations use a direct or session connection instead (scripts/migrate.mts).
 */
export function openPostgres(connectionString: string, env = process.env): Db {
  const pool = new Pool({
    connectionString,
    max: Math.max(1, Number(env.PG_POOL_MAX) || 2),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  // An idle client can be dropped by the pooler; without a listener that error crashes the process.
  pool.on("error", (err) => console.error("[db] idle client error", err.message));
  return postgresDb(pool);
}
