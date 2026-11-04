import { describe, expect, it, vi } from "vitest";
import {
  DataApiProvider,
  FallbackProvider,
  OEmbedProvider,
  defaultMetadataProvider,
  parseIsoDuration,
  type FetchFn,
  type MetadataProvider,
} from "./metadata";

const ID = "dQw4w9WgXcQ";

function respond(status: number, body: unknown): FetchFn {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

const apiItem = (over: Record<string, unknown> = {}) => ({
  items: [
    {
      id: ID,
      snippet: {
        title: "How GPUs Schedule Work",
        channelId: "UC123",
        channelTitle: "Chips Explained",
        publishedAt: "2024-05-01T10:00:00Z",
        liveBroadcastContent: "none",
        thumbnails: { high: { url: "https://i.ytimg.com/high.jpg" }, maxres: { url: "https://i.ytimg.com/max.jpg" } },
      },
      contentDetails: { duration: "PT38M12S" },
      status: { embeddable: true, privacyStatus: "public" },
      ...over,
    },
  ],
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT38M12S", 2292],
    ["PT1H", 3600],
    ["PT45S", 45],
    ["P1DT2H", 93600],
    ["P0D", 0],
    ["PT1M30.6S", 91],
  ])("%s -> %i", (iso, s) => expect(parseIsoDuration(iso)).toBe(s));

  it.each([[""], [null], [undefined], ["garbage"], ["1H"]])("%s -> null", (v) =>
    expect(parseIsoDuration(v as string)).toBeNull(),
  );
});

describe("DataApiProvider", () => {
  it("maps a full response", async () => {
    const r = await new DataApiProvider("KEY", respond(200, apiItem())).fetch(ID);
    expect(r).toEqual({
      ok: true,
      metadata: {
        videoId: ID,
        title: "How GPUs Schedule Work",
        channelId: "UC123",
        channelName: "Chips Explained",
        durationSeconds: 2292,
        thumbnailUrl: "https://i.ytimg.com/max.jpg",
        publishedAt: new Date("2024-05-01T10:00:00Z"),
        completeness: "ok",
      },
    });
  });

  it("does not leak the key into anything but the request URL", async () => {
    const f = respond(200, apiItem());
    const r = await new DataApiProvider("SECRET", f).fetch(ID);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(vi.mocked(f).mock.calls[0][0]).toContain("key=SECRET");
  });

  it("reports missing videos", async () => {
    expect(await new DataApiProvider("K", respond(200, { items: [] })).fetch(ID)).toEqual({
      ok: false,
      error: "video_not_found",
    });
  });

  it("treats private videos as not found", async () => {
    const r = await new DataApiProvider("K", respond(200, apiItem({ status: { privacyStatus: "private" } }))).fetch(ID);
    expect(r).toEqual({ ok: false, error: "video_not_found" });
  });

  it("rejects videos that cannot be embedded", async () => {
    const r = await new DataApiProvider("K", respond(200, apiItem({ status: { embeddable: false } }))).fetch(ID);
    expect(r).toEqual({ ok: false, error: "not_embeddable" });
  });

  it("marks live streams as partial (no duration yet)", async () => {
    const body = apiItem();
    body.items[0].snippet.liveBroadcastContent = "live";
    const r = await new DataApiProvider("K", respond(200, body)).fetch(ID);
    expect(r.ok && r.metadata).toMatchObject({ durationSeconds: null, completeness: "partial" });
  });

  it.each([
    ["quota exceeded", respond(403, { error: { code: 403 } })],
    ["server error", respond(500, "<html>oops</html>")],
    ["network failure", vi.fn(async () => { throw new TypeError("fetch failed"); }) as FetchFn],
  ])("is unavailable on %s", async (_l, f) => {
    expect(await new DataApiProvider("K", f).fetch(ID)).toEqual({ ok: false, error: "metadata_unavailable" });
  });
});

describe("OEmbedProvider", () => {
  it("maps a response as partial metadata", async () => {
    const f = respond(200, {
      title: "Why Bridges Move",
      author_name: "Practical Engineering",
      author_url: "https://www.youtube.com/@PracticalEngineeringChannel",
      thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg",
    });
    const r = await new OEmbedProvider(f).fetch(ID);
    expect(r).toMatchObject({
      ok: true,
      metadata: {
        title: "Why Bridges Move",
        channelName: "Practical Engineering",
        channelId: "https://www.youtube.com/@PracticalEngineeringChannel",
        durationSeconds: null,
        completeness: "partial",
      },
    });
  });

  it.each([
    [401, "not_embeddable"],
    [403, "not_embeddable"],
    [404, "video_not_found"],
    [400, "video_not_found"],
    [500, "metadata_unavailable"],
  ])("maps HTTP %i to %s", async (status, error) => {
    expect(await new OEmbedProvider(respond(status, "Not Found")).fetch(ID)).toEqual({ ok: false, error });
  });

  it("is unavailable when the body has no title", async () => {
    expect(await new OEmbedProvider(respond(200, {})).fetch(ID)).toEqual({ ok: false, error: "metadata_unavailable" });
  });
});

describe("FallbackProvider", () => {
  const fixed = (r: Awaited<ReturnType<MetadataProvider["fetch"]>>): MetadataProvider & { calls: number } => {
    const p = { calls: 0, fetch: async () => { p.calls++; return r; } };
    return p;
  };
  const okMeta = { ok: true as const, metadata: { videoId: ID, title: "t", channelId: null, channelName: null, durationSeconds: 1, thumbnailUrl: null, publishedAt: null, completeness: "ok" as const } };

  it("falls back only on transient failures", async () => {
    const second = fixed(okMeta);
    expect(await new FallbackProvider([fixed({ ok: false, error: "metadata_unavailable" }), second]).fetch(ID)).toBe(okMeta);
    expect(second.calls).toBe(1);
  });

  it("trusts a definitive not-found from the first provider", async () => {
    const second = fixed(okMeta);
    const r = await new FallbackProvider([fixed({ ok: false, error: "video_not_found" }), second]).fetch(ID);
    expect(r).toEqual({ ok: false, error: "video_not_found" });
    expect(second.calls).toBe(0);
  });

  it("uses only oEmbed when no API key is configured", async () => {
    const f = respond(200, { title: "x" });
    await defaultMetadataProvider({}, f).fetch(ID);
    expect(vi.mocked(f).mock.calls[0][0]).toContain("youtube.com/oembed");
  });
});
