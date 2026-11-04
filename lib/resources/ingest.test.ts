import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import type { MetadataProvider, MetadataResult, VideoMetadata } from "@/lib/youtube/metadata";
import { ingestYouTubeUrl, METADATA_MAX_AGE_MS } from "./ingest";

const ID = "dQw4w9WgXcQ";
const DAY = 24 * 60 * 60 * 1000;

let db: Db;

/** A provider whose answer the test controls, counting calls. */
function fakeProvider(answer: (id: string) => MetadataResult) {
  const p: MetadataProvider & { calls: string[] } = {
    calls: [],
    async fetch(id) {
      p.calls.push(id);
      return answer(id);
    },
  };
  return p;
}

const meta = (over: Partial<VideoMetadata> = {}): MetadataResult => ({
  ok: true,
  metadata: {
    videoId: ID,
    title: "How GPUs Schedule Work",
    channelId: "UC123",
    channelName: "Chips Explained",
    durationSeconds: 2292,
    thumbnailUrl: "https://i.ytimg.com/x.jpg",
    publishedAt: new Date("2024-05-01T00:00:00Z"),
    completeness: "ok",
    ...over,
  },
});

beforeAll(async () => {
  db = await openPglite();
});
beforeEach(async () => {
  await db.exec("truncate resources cascade");
});

describe("ingestYouTubeUrl", () => {
  it("creates a resource from a pasted URL", async () => {
    const r = await ingestYouTubeUrl(`https://youtu.be/${ID}?t=90`, { db, metadata: fakeProvider(() => meta()) });
    expect(r).toMatchObject({
      ok: true,
      created: true,
      startSeconds: 90,
      resource: {
        source: "youtube",
        external_id: ID,
        canonical_url: `https://www.youtube.com/watch?v=${ID}`,
        title: "How GPUs Schedule Work",
        duration_s: 2292,
        metadata_status: "ok",
        is_short: false,
      },
    });
  });

  it("maps every URL shape of one video to a single row and fetches once", async () => {
    const p = fakeProvider(() => meta());
    const urls = [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://m.youtube.com/watch?v=${ID}&t=5`,
      `https://www.youtube.com/embed/${ID}`,
    ];
    const results = [];
    for (const u of urls) results.push(await ingestYouTubeUrl(u, { db, metadata: p }));

    const ids = new Set(results.map((r) => r.ok && r.resource.id));
    expect(ids.size).toBe(1);
    expect(results.map((r) => r.ok && r.created)).toEqual([true, false, false, false]);
    expect(p.calls).toHaveLength(1);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from resources");
    expect(n).toBe(1);
  });

  it("survives concurrent pastes of the same video", async () => {
    const p = fakeProvider(() => meta());
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: p })),
    );
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(new Set(rs.map((r) => r.ok && r.resource.id)).size).toBe(1);
    expect(rs.filter((r) => r.ok && r.created)).toHaveLength(1);
  });

  it("rejects invalid URLs without calling YouTube", async () => {
    const p = fakeProvider(() => meta());
    expect(await ingestYouTubeUrl("https://vimeo.com/123", { db, metadata: p })).toEqual({ ok: false, error: "not_youtube" });
    expect(p.calls).toHaveLength(0);
  });

  it.each(["video_not_found", "not_embeddable", "metadata_unavailable"] as const)(
    "stores nothing when a new video fails with %s",
    async (error) => {
      const r = await ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: fakeProvider(() => ({ ok: false, error })) });
      expect(r).toEqual({ ok: false, error });
      expect(await db.query("select 1 from resources")).toHaveLength(0);
    },
  );

  it("flags Shorts", async () => {
    const r = await ingestYouTubeUrl(`https://www.youtube.com/shorts/${ID}`, { db, metadata: fakeProvider(() => meta()) });
    expect(r.ok && r.resource.is_short).toBe(true);
  });

  it("stores oEmbed-only results as partial", async () => {
    const r = await ingestYouTubeUrl(`https://youtu.be/${ID}`, {
      db,
      metadata: fakeProvider(() => meta({ durationSeconds: null, completeness: "partial" })),
    });
    expect(r.ok && r.resource).toMatchObject({ duration_s: null, metadata_status: "partial" });
  });

  describe("30-day metadata refresh", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const at = (ms: number) => () => new Date(t0.getTime() + ms);

    beforeEach(async () => {
      await ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: fakeProvider(() => meta()), now: at(0) });
    });

    it("does not refetch fresh metadata", async () => {
      const p = fakeProvider(() => meta({ title: "Renamed" }));
      const r = await ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: p, now: at(29 * DAY) });
      expect(p.calls).toHaveLength(0);
      expect(r.ok && r.resource.title).toBe("How GPUs Schedule Work");
    });

    it("refreshes stale metadata in place", async () => {
      const p = fakeProvider(() => meta({ title: "Renamed" }));
      const r = await ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: p, now: at(METADATA_MAX_AGE_MS + 1) });
      expect(p.calls).toHaveLength(1);
      expect(r).toMatchObject({ ok: true, created: false, resource: { title: "Renamed" } });
      expect(r.ok && r.resource.metadata_refreshed_at.getTime()).toBe(t0.getTime() + METADATA_MAX_AGE_MS + 1);
    });

    it("never downgrades known duration during an oEmbed-only refresh", async () => {
      const p = fakeProvider(() => meta({ durationSeconds: null, completeness: "partial", channelId: null }));
      const r = await ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: p, now: at(31 * DAY) });
      expect(r.ok && r.resource).toMatchObject({ duration_s: 2292, metadata_status: "ok", creator_external_id: "UC123" });
    });

    it("serves the stale record when YouTube is temporarily down", async () => {
      const p = fakeProvider(() => ({ ok: false, error: "metadata_unavailable" }));
      const r = await ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: p, now: at(31 * DAY) });
      expect(r).toMatchObject({ ok: true, created: false, resource: { title: "How GPUs Schedule Work" } });
    });

    it("marks the record unavailable when the video was removed", async () => {
      const p = fakeProvider(() => ({ ok: false, error: "video_not_found" }));
      const r = await ingestYouTubeUrl(`https://youtu.be/${ID}`, { db, metadata: p, now: at(31 * DAY) });
      expect(r).toEqual({ ok: false, error: "video_not_found" });
      const [row] = await db.query<{ metadata_status: string }>("select metadata_status from resources");
      expect(row.metadata_status).toBe("unavailable");
    });
  });
});
