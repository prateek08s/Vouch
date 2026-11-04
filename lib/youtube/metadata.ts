/**
 * Fetching permitted YouTube metadata.
 *
 * Two providers:
 *  - Data API v3 (needs YOUTUBE_API_KEY): full metadata including duration and embeddability.
 *  - oEmbed (no key): title, channel, thumbnail. No duration, so results are "partial".
 */

export type VideoMetadata = {
  videoId: string;
  title: string;
  channelId: string | null;
  channelName: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  /** "partial" when a field the product relies on (duration) is missing. */
  completeness: "ok" | "partial";
};

export type MetadataResult =
  | { ok: true; metadata: VideoMetadata }
  | { ok: false; error: "video_not_found" | "not_embeddable" | "metadata_unavailable" };

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface MetadataProvider {
  fetch(videoId: string): Promise<MetadataResult>;
}

const TIMEOUT_MS = 8_000;

async function getJson(fetchFn: FetchFn, url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON bodies (HTML error pages) are treated as empty.
  }
  return { status: res.status, body };
}

/** ISO 8601 duration ("PT1H2M3S", "P1DT2H") to seconds. Null for live/unknown ("P0D" counts as 0). */
export function parseIsoDuration(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Math.round(Number(s ?? 0));
}

type DataApiItem = {
  id: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    liveBroadcastContent?: string;
    thumbnails?: Record<string, { url: string; width?: number }>;
  };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
};

function bestThumbnail(thumbs: Record<string, { url: string }> | undefined): string | null {
  if (!thumbs) return null;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    if (thumbs[key]?.url) return thumbs[key].url;
  }
  return null;
}

export class DataApiProvider implements MetadataProvider {
  constructor(
    private apiKey: string,
    private fetchFn: FetchFn = fetch,
  ) {}

  async fetch(videoId: string): Promise<MetadataResult> {
    const url =
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status" +
      `&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(this.apiKey)}`;
    let status: number;
    let body: unknown;
    try {
      ({ status, body } = await getJson(this.fetchFn, url));
    } catch {
      return { ok: false, error: "metadata_unavailable" };
    }
    if (status !== 200) return { ok: false, error: "metadata_unavailable" };

    const item = (body as { items?: DataApiItem[] })?.items?.[0];
    if (!item || item.status?.privacyStatus === "private") return { ok: false, error: "video_not_found" };
    if (item.status?.embeddable === false) return { ok: false, error: "not_embeddable" };

    const sn = item.snippet ?? {};
    if (!sn.title) return { ok: false, error: "metadata_unavailable" };
    const isLive = sn.liveBroadcastContent === "live" || sn.liveBroadcastContent === "upcoming";
    const durationSeconds = isLive ? null : parseIsoDuration(item.contentDetails?.duration);

    return {
      ok: true,
      metadata: {
        videoId,
        title: sn.title,
        channelId: sn.channelId ?? null,
        channelName: sn.channelTitle ?? null,
        durationSeconds,
        thumbnailUrl: bestThumbnail(sn.thumbnails),
        publishedAt: sn.publishedAt ? new Date(sn.publishedAt) : null,
        completeness: durationSeconds === null ? "partial" : "ok",
      },
    };
  }
}

export class OEmbedProvider implements MetadataProvider {
  constructor(private fetchFn: FetchFn = fetch) {}

  async fetch(videoId: string): Promise<MetadataResult> {
    const target = `https://www.youtube.com/watch?v=${videoId}`;
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`;
    let status: number;
    let body: unknown;
    try {
      ({ status, body } = await getJson(this.fetchFn, url));
    } catch {
      return { ok: false, error: "metadata_unavailable" };
    }
    // oEmbed answers 401 for videos whose owner disabled embedding, 400/404 for missing ones.
    if (status === 401 || status === 403) return { ok: false, error: "not_embeddable" };
    if (status === 400 || status === 404) return { ok: false, error: "video_not_found" };
    if (status !== 200) return { ok: false, error: "metadata_unavailable" };

    const b = body as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
    if (!b?.title) return { ok: false, error: "metadata_unavailable" };

    return {
      ok: true,
      metadata: {
        videoId,
        title: b.title,
        // oEmbed gives a channel URL (often /@handle), not a channel ID. Use it as a stable key.
        channelId: b.author_url ?? null,
        channelName: b.author_name ?? null,
        durationSeconds: null,
        thumbnailUrl: b.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        publishedAt: null,
        completeness: "partial",
      },
    };
  }
}

/** Tries the Data API first, then oEmbed for transient failures. Definitive answers are not retried. */
export class FallbackProvider implements MetadataProvider {
  constructor(private providers: MetadataProvider[]) {}

  async fetch(videoId: string): Promise<MetadataResult> {
    let last: MetadataResult = { ok: false, error: "metadata_unavailable" };
    for (const p of this.providers) {
      last = await p.fetch(videoId);
      if (last.ok || last.error !== "metadata_unavailable") return last;
    }
    return last;
  }
}

export function defaultMetadataProvider(
  env: Record<string, string | undefined> = process.env,
  fetchFn: FetchFn = fetch,
): MetadataProvider {
  const providers: MetadataProvider[] = [];
  if (env.YOUTUBE_API_KEY) providers.push(new DataApiProvider(env.YOUTUBE_API_KEY, fetchFn));
  providers.push(new OEmbedProvider(fetchFn));
  return new FallbackProvider(providers);
}
