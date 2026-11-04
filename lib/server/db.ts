import { openPostgres } from "@/lib/db/postgres";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { openPglite, type Db } from "@/lib/db";
import { seedDemo } from "@/lib/seed/demo";

/**
 * One database per server process. Local dev uses a PGlite directory under .data/;
 * production will swap this for a Supabase adapter implementing the same Db interface.
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
      const db = await openPglite(dir);
      if (process.env.VOUCH_SEED !== "0") {
        await seedDemo(db);
      }
      return db;
    })().catch((err) => {
      globalForDb.__vouchDb = undefined; // allow a retry on the next request
      throw err;
    });
  }
  return globalForDb.__vouchDb;
}
