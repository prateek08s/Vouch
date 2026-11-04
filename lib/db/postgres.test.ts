import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { postgresDb } from "./postgres";

function fixture() {
  const query = vi.fn(async (sql: string) => { void sql; return { rows: [] }; });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })), query: vi.fn() };
  return { query, release, pool, db: postgresDb(pool as unknown as Pool) };
}
it("uses a single connection for nested transactions and commits once", async () => {
  const f = fixture();
  await f.db.transaction(async tx => { await tx.query("first"); await tx.transaction(inner => inner.exec("second")); });
  expect(f.query.mock.calls.map(c => c[0])).toEqual(["BEGIN", "first", "second", "COMMIT"]);
  expect(f.pool.query).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledExactlyOnceWith(false);
});
it("rolls back a failed operation and releases the connection", async () => {
  const f = fixture();
  await expect(f.db.transaction(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect(f.query.mock.calls.map(c => c[0])).toEqual(["BEGIN", "ROLLBACK"]);
  expect(f.release).toHaveBeenCalledExactlyOnceWith(false);
});
it("destroys a connection if rollback fails while preserving the original error", async () => {
  const f = fixture();
  f.query.mockImplementation(async sql => { if (sql === "ROLLBACK") throw new Error("connection lost"); return { rows: [] }; });
  await expect(f.db.transaction(async () => { throw new Error("original"); })).rejects.toThrow("original");
  expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
});
