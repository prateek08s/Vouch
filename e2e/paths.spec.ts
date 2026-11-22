import { expect, test } from "@playwright/test";

test("public paths show prerequisites, outcomes, ordered lessons and guest completion", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/paths");
  await page.getByRole("link", { name: "E2E Starter List", exact: true }).click();
  await expect(page).toHaveURL(/\/lists\//, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Before you start", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Basic algebra", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "About this learning path", exact: true }).getByText("Explain a neural network", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Lessons watched", exact: true })).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByText("Edit learning path", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Start learning", exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/.*list=/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Mark watched", exact: true }).click();
  await page.locator(".learning-next").getByRole("link", { name: "E2E Starter List", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Lessons watched", exact: true })).toHaveAttribute("aria-valuenow", "33");
  await expect(page.getByText("1 of 3 available lessons watched.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue learning", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fourier Transform");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.locator(".learning-next").getByRole("link", { name: "E2E Starter List", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Lessons watched", exact: true })).toHaveAttribute("aria-valuenow", "33");
  await expect(page.getByText("1 of 3 available lessons watched, 1 skipped.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Continue learning", exact: true })).toBeVisible();
});
