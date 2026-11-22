import { expect, test } from "@playwright/test";
test("combined filters survive sorting, reload, and clearing", async ({page}) => {
  await page.goto("/discover?topic=ai&topic=pure-math&channel=3blue1brown&maxMinutes=20");
  await expect(page.getByLabel("Channel name",{exact:false})).toHaveValue("3blue1brown");
  await expect(page.getByLabel("Time available in minutes",{exact:false})).toHaveValue("20");
  await page.getByRole("navigation",{name:"Sort",exact:true}).getByRole("link",{name:"Shortest first"}).click();
  await expect(page).toHaveURL(/sort=shortest/);
  const q=new URL(page.url()).searchParams;
  expect(q.getAll("topic")).toEqual(["ai","pure-math"]);
  expect(q.get("channel")).toBe("3blue1brown");
  expect(q.get("maxMinutes")).toBe("20");
  await page.reload();
  await expect(page.getByLabel("Channel name",{exact:false})).toHaveValue("3blue1brown");
  await page.getByRole("link",{name:"Clear filters",exact:true}).first().click();
  await expect(page).toHaveURL(/\/discover$/);
});
test("the form submits multiple topics and a channel", async ({page}) => {
  await page.goto("/discover");
  await page.getByText("More filters",{exact:true}).click();
  await page.getByRole("listbox",{name:"Topics",exact:true}).selectOption(["ai","pure-math"]);
  await page.getByLabel("Channel name",{exact:false}).fill("3Blue1Brown");
  await page.getByLabel("Time available in minutes",{exact:false}).fill("20");
  await page.getByRole("button",{name:"Apply filters",exact:true}).click();
  await expect(page).toHaveURL(/maxMinutes=20/);
  expect(new URL(page.url()).searchParams.getAll("topic")).toEqual(["ai","pure-math"]);
  await expect(page.locator(".rec").first()).toBeVisible();
  for(const row of await page.locator(".rec").all()) await expect(row).toContainText("3Blue1Brown");
});
