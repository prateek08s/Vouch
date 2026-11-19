import { expect, test } from "@playwright/test";

// Relies on scripts/seed-e2e.mts. Signed-out journey only: OAuth can't run in CI.

test("home is Discover: what Vouch is, then real picks, with no sign-up first", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Long videos Hacker News recommends");
  await expect(page.getByRole("heading", { name: "But what is a neural network?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Filter by length" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Build your Circle" })).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("signed out, a viewer can rate, save and hide what they watched", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "But what is a neural network?" }).first().click();
  await expect(page).toHaveURL(/\/watch\//);
  await page.getByRole("button", { name: "Worth it", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Marked Worth it");
  await page.getByRole("button", { name: "Save for later" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByRole("link", { name: "But what is a neural network?" })).toBeVisible();
  await expect(page.getByText("Watched").first()).toBeVisible();

  await page.goto("/");
  await page.getByLabel(/Hide watched/).check();
  await expect(page.getByRole("heading", { name: "But what is a neural network?" })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "But what is a neural network?" })).toBeHidden();
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
  await expect(page.getByRole("button", { name: "Worth it", exact: true })).toBeVisible();
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

test("signed-in pages send visitors to sign-in; hidden social pages are not found", async ({ page }) => {
  for (const path of ["/vouch", "/settings/profile"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin/);
  }
  for (const path of ["/people", "/passport", "/onboarding"]) {
    await page.goto(path);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  }
  await page.goto("/lists");
  await expect(page.getByRole("heading", { level: 1, name: "Collections" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Starter List" })).toBeVisible();
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
