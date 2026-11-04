import type { Db } from "@/lib/db";
import { canonicalYouTubeUrl, parseYouTubeUrl, type ParseError } from "@/lib/youtube/parse";
import type { MetadataProvider, VideoMetadata } from "@/lib/youtube/metadata";

/** YouTube API policy: stored API data must be refreshed (or deleted) within 30 days. */
export const METADATA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type Resource = {
  id: string;
  source: "youtube";
  external_id: string;
  canonical_url: string;
  title: string;
  creator_external_id: string | null;
  creator_name: string | null;
  duration_s: number | null;
  thumbnail_url: string | null;
  is_short: boolean;
  published_at: Date | null;
  metadata_status: "ok" | "partial" | "unavailable";
  metadata_refreshed_at: Date;
};

export type IngestError = ParseError | "video_not_found" | "not_embeddable" | "metadata_unavailable";

export type IngestResult =
  | { ok: true; resource: Resource; created: boolean; startSeconds: number | null }
  | { ok: false; error: IngestError };

export const INGEST_ERROR_MESSAGES: Record<IngestError, string> = {
  empty: "Paste a YouTube link.",
  not_youtube: "That doesn't look like a YouTube link.",
  no_video_id: "That link points to YouTube, but not to a single video.",
  invalid_video_id: "That video link looks malformed.",
  video_not_found: "We couldn't find that video. It may be private or removed.",
  not_embeddable: "The creator doesn't allow this video to be played outside YouTube.",
  metadata_unavailable: "YouTube didn't respond. Try again in a moment.",
};

export type IngestDeps = { db: Db; metadata: MetadataProvider; now?: () => Date };

/**
 * Paste a URL, get a resource. The same video pasted in any URL shape maps to one row.
 * Metadata is fetched only for new resources or stale ones.
 */
export async function ingestYouTubeUrl(input: string, deps: IngestDeps): Promise<IngestResult> {
  const parsed = parseYouTubeUrl(input);
  if (!parsed.ok) return parsed;
  const now = deps.now?.() ?? new Date();

  let existing = await findByExternalId(deps.db, parsed.videoId);
  if (existing && parsed.isShort && !existing.is_short) {
    const rows = await deps.db.query<Resource>(
      "update resources set is_short = true where id = $1 returning *",
      [existing.id],
    );
    existing = rows[0] ?? null;
  }
  if (existing && existing.metadata_status !== "unavailable" &&
      now.getTime() - existing.metadata_refreshed_at.getTime() < METADATA_MAX_AGE_MS) {
    return { ok: true, resource: existing, created: false, startSeconds: parsed.startSeconds };
  }

  const result = await deps.metadata.fetch(parsed.videoId);
  if (!result.ok) {
    // A stale record is still better than nothing when YouTube is merely slow.
    if (existing && existing.metadata_status !== "unavailable" && result.error === "metadata_unavailable") {
      return { ok: true, resource: existing, created: false, startSeconds: parsed.startSeconds };
    }
    if (existing) await markUnavailable(deps.db, existing.id, now);
    return { ok: false, error: result.error };
  }

  const { resource, created } = await upsert(deps.db, result.metadata, parsed.isShort, now);
  return { ok: true, resource, created, startSeconds: parsed.startSeconds };
}

async function findByExternalId(db: Db, videoId: string): Promise<Resource | null> {
  const rows = await db.query<Resource>(
    "select * from resources where source = 'youtube' and external_id = $1",
    [videoId],
  );
  return rows[0] ?? null;
}

async function markUnavailable(db: Db, id: string, now: Date) {
  await db.query(
    "update resources set metadata_status = 'unavailable', metadata_refreshed_at = $2 where id = $1",
    [id, now],
  );
}

async function upsert(
  db: Db,
  m: VideoMetadata,
  isShort: boolean,
  now: Date,
): Promise<{ resource: Resource; created: boolean }> {
  // xmax = 0 identifies a freshly inserted row versus an updated one.
  // A refresh never downgrades known fields to null (oEmbed lacks duration).
  const rows = await db.query<Resource & { inserted: boolean }>(
    `insert into resources (
        source, external_id, canonical_url, title, creator_external_id, creator_name,
        duration_s, thumbnail_url, is_short, published_at, metadata_status, metadata_refreshed_at)
     values ('youtube', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (source, external_id) do update set
        title                 = excluded.title,
        creator_external_id   = coalesce(excluded.creator_external_id, resources.creator_external_id),
        creator_name          = coalesce(excluded.creator_name, resources.creator_name),
        duration_s            = coalesce(excluded.duration_s, resources.duration_s),
        thumbnail_url         = coalesce(excluded.thumbnail_url, resources.thumbnail_url),
        is_short              = resources.is_short or excluded.is_short,
        published_at          = coalesce(excluded.published_at, resources.published_at),
        metadata_status       = case when coalesce(excluded.duration_s, resources.duration_s) is null
                                     then 'partial' else 'ok' end,
        metadata_refreshed_at = excluded.metadata_refreshed_at
     returning *, (xmax = 0) as inserted`,
    [
      m.videoId,
      canonicalYouTubeUrl(m.videoId),
      m.title,
      m.channelId,
      m.channelName,
      m.durationSeconds,
      m.thumbnailUrl,
      isShort,
      m.publishedAt,
      m.completeness,
      now,
    ],
  );
  const { inserted, ...resource } = rows[0];
  return { resource, created: inserted };
}
