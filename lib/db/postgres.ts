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

export function openPostgres(connectionString: string): Db {
  return postgresDb(new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  }));
}
