import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests of the public journey. CI runs them against a production build on real
 * Postgres (see .github/workflows/verify.yml). Locally: start the app, then
 *   E2E_BASE_URL=http://localhost:3000 npx playwright test
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    ...(process.env.E2E_CHROME ? { launchOptions: { executablePath: process.env.E2E_CHROME } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
