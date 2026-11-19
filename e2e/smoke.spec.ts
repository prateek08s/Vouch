import { expect, test } from "@playwright/test";

// Relies on scripts/seed-e2e.mts. Signed-out journey only: OAuth can't run in CI.

test("landing shows a real vouch and leads to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Videos worth your time");
  await expect(page.getByLabel("An example vouch")).toContainText("E2E Curator");
  await page.getByRole("link", { name: "Build your Circle" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("Discover lists picks, filters by topic, and opens a public watch page", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "But what is a neural network?" })).toBeVisible();
  await page.getByRole("navigation", { name: "Filter by topic" }).getByRole("link", { name: "Mathematics" }).click();
  await expect(page).toHaveURL(/topic=/);
  await expect(page.getByRole("heading", { name: /Fourier Transform/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "But what is a neural network?" })).toHaveCount(0);

  await page.getByRole("link", { name: /Fourier Transform/ }).first().click();
  await expect(page).toHaveURL(/\/watch\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fourier Transform");
  await expect(page.locator("iframe[src*='youtube-nocookie.com']")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Sign in to rate" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "About this pick" }).getByText("The winding machine makes it obvious.")).toBeVisible();
});

test("public curator page and legal pages render", async ({ page }) => {
  await page.goto("/u/e2e_curator");
  await expect(page.getByRole("heading", { name: "E2E Curator" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Starter List" })).toBeVisible();
  for (const [path, title] of [["/privacy", "Privacy"], ["/terms", "Terms"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  }
});

test("signed-in pages send visitors to sign-in", async ({ page }) => {
  for (const path of ["/people", "/lists", "/vouch", "/settings/profile"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin/);
  }
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("frame-src https://www.youtube-nocookie.com");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

// A page found missing after streaming starts keeps HTTP 200 (a Next.js streaming limit), so check
// what crawlers and people get: the not-found page, marked noindex.
test("unknown curators show the not-found page, marked noindex", async ({ page }) => {
  await page.goto("/u/nobody_here");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  expect(await page.locator("meta[name='robots'][content*='noindex']").count()).toBeGreaterThan(0);
});
