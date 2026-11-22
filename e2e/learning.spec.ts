import { expect, test } from "@playwright/test";

test("guest learning keeps saved, watched and skipped states independent", async ({ page }) => {
  await page.goto("/discover");
  const href = await page.locator('a[href^="/watch/"]').first().getAttribute("href");
  await page.goto(href!);
  await expect(page).toHaveURL(/\/watch\//);
  const watch = page.url();
  await page.getByRole("button", { name: "Save for later", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark watched", exact: true })).toBeVisible();
  await page.goto("/learning?view=saved");
  await expect(page.locator(".learning-row")).toHaveCount(1);
  await page.goto(watch);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Undo skip", exact: true })).toBeVisible();
  await page.goto("/learning?view=history");
  await expect(page.locator(".learning-row")).toContainText("Skipped");
  await page.getByRole("button", { name: "Undo skip", exact: true }).click();
  await page.getByRole("button", { name: "Mark watched", exact: true }).click();
  await expect(page.locator(".learning-row")).toContainText("Watched");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.goto("/learning?view=saved");
  await expect(page.locator(".learning-row")).toHaveCount(0);
});

test("guest playback is saved on pause and restored without autoplay", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.YT={Player:function(element,options){
      const player={position:0,getCurrentTime(){return this.position},getDuration(){return 1000},
        getPlayerState(){return 2},seekTo(p){this.position=p},
        cueVideoById(o){this.position=o.startSeconds;window.__resumed=o.startSeconds},
        destroy(){}};
      window.__pause=(p)=>{player.position=p;options.events.onStateChange({data:2,target:player})};
      setTimeout(()=>options.events.onReady({target:player}),20);return player;
    }};window.onYouTubeIframeAPIReady?.();`,
  }));
  await page.goto("/discover");
  const href = await page.locator('a[href^="/watch/"]').first().getAttribute("href");
  await page.goto(href!);
  await page.waitForFunction(() => "__pause" in window);
  await page.evaluate(() => (window as unknown as {__pause(p:number):void}).__pause(125));
  await expect(page.getByText("Resume point saved at 2:05.", { exact: false })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => (window as unknown as {__resumed:number}).__resumed === 125);
  await page.goto("/learning");
  await expect(page.locator(".learning-row")).toHaveCount(1);
  await expect(page.getByText("Resume at 2:05", { exact: true })).toBeVisible();
});

test("manual completion works when automatic playback tracking is blocked", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
  await page.goto("/discover");
  const href = await page.locator('a[href^="/watch/"]').first().getAttribute("href");
  await page.goto(href!);
  await expect(page.getByText("Automatic progress is unavailable.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Mark watched", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark unwatched", exact: true })).toBeVisible();
});

test("leaving or resetting before the player is ready does not throw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.YT={Player:function(){window.__playerConstructed=true;return {destroy(){}}}};window.onYouTubeIframeAPIReady?.();",
  }));
  await page.goto("/discover");
  const href = await page.locator('a[href^="/watch/"]').first().getAttribute("href");
  await page.goto(href!);
  await page.waitForFunction(() => "__playerConstructed" in window);
  await page.getByRole("button", { name: "Mark watched", exact: true }).click();
  await page.getByRole("button", { name: "Mark unwatched", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark watched", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
