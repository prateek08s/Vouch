import { Pool } from "pg";
import { postgresDb } from "../lib/db/postgres";
import { migrate } from "../lib/db";

// Use a direct/session database connection for migrations, not a transaction pooler.
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before running migrations.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const db = postgresDb(pool);
  const applied = await db.transaction(async tx => {
    await tx.query("select pg_advisory_xact_lock(78682401)");
    return migrate(tx);
  });
  console.log("Applied migrations", applied);
} finally { await pool.end(); }
