import { expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import { circleFeed } from "@/lib/feed/circle";
import type { MetadataProvider } from "@/lib/youtube/metadata";
import { seedDemo } from "./demo";

const offline: MetadataProvider = { async fetch() { return { ok: false, error: "metadata_unavailable" }; } };
const NOW = new Date("2026-11-03T12:00:00Z");

it("seeds a usable Circle offline, and only once", async () => {
  const db = await openPglite();
  const first = await seedDemo(db, { metadata: offline, now: NOW });
  expect(first.seeded).toBe(true);
  expect(await seedDemo(db, { metadata: offline, now: NOW })).toEqual({ seeded: false });

  const page = await circleFeed(db, first.seeded ? first.viewerId : "", { now: NOW });
  expect(page.items.length).toBe(5);
  expect(page.nextCursor).toBeNull();
  // Already-rated history never reappears in the feed.
  expect(page.items.map((i) => i.title)).not.toContain("But what is a neural network?");
  // The GPT card leads with Priya and cites the AI history the viewer rated.
  const gpt = page.items.find((i) => i.title.startsWith("Let's build GPT"))!;
  expect(gpt.explanation.leadCurator.name).toBe("Priya Nair");
  expect(gpt.explanation.whyThis).toBe("You rated 3 of Priya Nair's 3 AI picks Worth It. 1 other person you follow vouched too.");
  expect(page.items[0].resourceId).toBe(gpt.resourceId);
});

it("skips videos YouTube reports as missing instead of inventing them", async () => {
  const db = await openPglite();
  const missing: MetadataProvider = { async fetch() { return { ok: false, error: "video_not_found" }; } };
  const r = await seedDemo(db, { metadata: missing, now: NOW });
  expect(r.seeded && r.skipped.length).toBe(9);
  expect(await db.query("select 1 from resources")).toHaveLength(0);
});
