import { openPostgres } from "@/lib/db/postgres";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { openPglite, type Db } from "@/lib/db";

/**
 * One database per server process. With DATABASE_URL (Supabase Postgres) it uses that;
 * otherwise, in development only, a local PGlite directory under .data/.
 */
const globalForDb = globalThis as unknown as { __vouchDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__vouchDb) {
    globalForDb.__vouchDb = (async () => {
      if (process.env.DATABASE_URL) return openPostgres(process.env.DATABASE_URL);
      if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production.");
      const dir = process.env.VOUCH_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
      // PGlite creates only the last path segment, not missing parents.
      await mkdir(path.dirname(dir), { recursive: true });
      return openPglite(dir);
    })().catch((err) => {
      globalForDb.__vouchDb = undefined; // allow a retry on the next request
      throw err;
    });
  }
  return globalForDb.__vouchDb;
}
