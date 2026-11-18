import type { Db } from "@/lib/db";

/**
 * Fixed-window limits, kept in Postgres so they hold across serverless instances.
 * Generous on purpose: they stop loops and scripts, not ordinary use.
 */
export const LIMITS = {
  /** Pasting links: each new video costs a YouTube API call. */
  ingest: { max: 30, windowS: 3600 },
  /** Full-text search is the most expensive read. */
  search: { max: 120, windowS: 600 },
  /** Follows, ratings, rules, list edits. */
  write: { max: 400, windowS: 3600 },
} as const;

export type Bucket = keyof typeof LIMITS;

/** Counts one hit. True when it is within the limit. */
export async function allow(db: Db, bucket: Bucket, key: string, now = new Date()): Promise<boolean> {
  const { max, windowS } = LIMITS[bucket];
  const start = new Date(Math.floor(now.getTime() / (windowS * 1000)) * windowS * 1000);
  const [row] = await db.query<{ hits: number }>(
    `insert into rate_limits (bucket, key, window_start, hits) values ($1, $2, $3, 1)
     on conflict (bucket, key, window_start) do update set hits = rate_limits.hits + 1
     returning hits`,
    [bucket, key, start],
  );
  // Prune finished windows now and then, so the table stays small without a job.
  if (row.hits === 1 && Math.random() < 0.02) {
    await db.query("delete from rate_limits where window_start < $1", [new Date(now.getTime() - 86_400_000)]);
  }
  return row.hits <= max;
}

export const LIMIT_MESSAGE = "You're doing that a lot. Wait a few minutes and try again.";
