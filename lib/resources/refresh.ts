import type { Db } from "@/lib/db";
import type { MetadataProvider } from "@/lib/youtube/metadata";
import { upsert, METADATA_MAX_AGE_MS } from "./ingest";

/** Refresh a little before the 30-day limit, so a skipped day never breaks it. */
export const REFRESH_AFTER_MS = METADATA_MAX_AGE_MS - 5 * 86_400_000;

export type RefreshStats = { checked: number; refreshed: number; unavailable: number; failed: number };

/**
 * YouTube's API terms: stored API data must be refreshed (or deleted) within 30 days.
 * Refreshes the oldest records first, a batch per run, so a daily job covers the whole catalogue.
 * A video YouTube says is gone or no longer embeddable is marked unavailable and drops out of
 * every surface; a transient failure leaves the record as it is for the next run.
 */
export async function refreshStaleMetadata(
  db: Db,
  metadata: MetadataProvider,
  opts: { limit?: number; now?: Date; concurrency?: number } = {},
): Promise<RefreshStats> {
  const now = opts.now ?? new Date();
  const due = await db.query<{ id: string; external_id: string; is_short: boolean }>(
    `select id, external_id, is_short from resources
     where source = 'youtube' and metadata_status <> 'unavailable' and metadata_refreshed_at < $1
     order by metadata_refreshed_at limit $2`,
    [new Date(now.getTime() - REFRESH_AFTER_MS), opts.limit ?? 300],
  );
  const stats: RefreshStats = { checked: due.length, refreshed: 0, unavailable: 0, failed: 0 };
  const queue = [...due];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const result = await metadata.fetch(r.external_id);
      if (result.ok) {
        await upsert(db, result.metadata, r.is_short, now);
        stats.refreshed++;
      } else if (result.error === "metadata_unavailable") {
        stats.failed++;
      } else {
        await db.query("update resources set metadata_status = 'unavailable', metadata_refreshed_at = $2 where id = $1", [r.id, now]);
        stats.unavailable++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return stats;
}
