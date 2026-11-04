import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    // PGlite boots a WASM Postgres per test file; give it room on slow disks.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
