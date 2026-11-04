import { expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import { ingestYouTubeUrl, METADATA_MAX_AGE_MS } from "./ingest";
import type { MetadataProvider } from "@/lib/youtube/metadata";

const url = "https://youtu.be/dQw4w9WgXcQ";
const available: MetadataProvider = {
  async fetch(videoId) {
    return { ok: true, metadata: {
      videoId, title: "Example", channelId: null, channelName: null,
      durationSeconds: 45, thumbnailUrl: null, publishedAt: null, completeness: "ok",
    }};
  },
};

it("keeps unavailable resources rejected through retries and a provider outage", async () => {
  const db = await openPglite();
  const start = new Date("2026-01-01");
  await ingestYouTubeUrl(url, { db, metadata: available, now: () => start });
  const now = () => new Date(start.getTime() + METADATA_MAX_AGE_MS + 1);
  const removed: MetadataProvider = { async fetch() { return { ok: false, error: "video_not_found" }; } };
  expect((await ingestYouTubeUrl(url, { db, metadata: removed, now })).ok).toBe(false);
  expect((await ingestYouTubeUrl(url, { db, metadata: removed, now })).ok).toBe(false);
  const outage: MetadataProvider = { async fetch() { return { ok: false, error: "metadata_unavailable" }; } };
  expect((await ingestYouTubeUrl(url, { db, metadata: outage, now })).ok).toBe(false);
  expect((await ingestYouTubeUrl(url, { db, metadata: available, now })).ok).toBe(true);
});

it("promotes a cached watch URL to a Short and keeps that classification", async () => {
  const db = await openPglite();
  await ingestYouTubeUrl(url, { db, metadata: available });
  const short = await ingestYouTubeUrl("https://youtube.com/shorts/dQw4w9WgXcQ", { db, metadata: available });
  expect(short.ok && short.resource.is_short).toBe(true);
  const watch = await ingestYouTubeUrl(url, { db, metadata: available });
  expect(watch.ok && watch.resource.is_short).toBe(true);
});
