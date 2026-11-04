import type { Db } from "@/lib/db";

/**
 * What was shown, what was opened, and whether it was worth it: the data the MVP hypotheses
 * need (H1 to H4, plan 26). Per source (Circle, list "Up next", search) and per explanation
 * code, so "Why this?" variants can be compared by Worth-It rate.
 *
 * Behavioral counts only (plan 31): nothing here is shown to other users.
 */

export type ImpressionSource = "circle" | "list" | "search";
export type Impression = { resourceId: string; explanationCode: string };

/** Reloading a page should not count as seeing the same thing again. */
export const DEDUPE_HOURS = 6;
/** An open counts toward the most recent impression from the past week. */
export const OPEN_WINDOW_DAYS = 7;

export async function recordImpressions(
  db: Db,
  userId: string,
  source: ImpressionSource,
  items: Impression[],
  now = new Date(),
): Promise<number> {
  if (!items.length) return 0;
  const since = new Date(now.getTime() - DEDUPE_HOURS * 3_600_000);
  const rows = await db.query(
    `insert into recommendation_impressions (user_id, resource_id, source_type, explanation_code, shown_at)
     select $1, x.resource_id, $2, x.code, $5
     from (select distinct on (resource_id) resource_id, code
           from unnest($3::uuid[], $4::text[]) as u(resource_id, code)) x
     where exists (select 1 from resources r where r.id = x.resource_id)
       and not exists (
         select 1 from recommendation_impressions i
         where i.user_id = $1 and i.resource_id = x.resource_id and i.source_type = $2 and i.shown_at > $6)
     returning 1`,
    [userId, source, items.map((i) => i.resourceId), items.map((i) => i.explanationCode), now, since],
  );
  return rows.length;
}

/** Marks the latest recent impression of this video as opened. False when it was never shown. */
export async function markOpened(db: Db, userId: string, resourceId: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - OPEN_WINDOW_DAYS * 86_400_000);
  const rows = await db.query(
    `update recommendation_impressions set opened_at = $3
     where id = (select id from recommendation_impressions
                 where user_id = $1 and resource_id = $2 and shown_at > $4 and shown_at <= $3 and opened_at is null
                 order by shown_at desc limit 1)
     returning 1`,
    [userId, resourceId, now, since],
  );
  return rows.length > 0;
}

export type ImpressionReportRow = {
  source: string;
  explanation: string;
  shown: number;
  opened: number;
  rated: number;
  worthIt: number;
};

/**
 * Shown, opened, rated and Worth It per source and explanation. A rating counts when it was
 * given after the impression, by the same person, for the same video.
 */
export async function impressionReport(db: Db, since = new Date(0)): Promise<ImpressionReportRow[]> {
  return db.query<ImpressionReportRow>(
    `select i.source_type as source, i.explanation_code as explanation,
            count(*)::int as shown,
            count(i.opened_at)::int as opened,
            count(r.user_id)::int as rated,
            (count(*) filter (where r.worth_it))::int as "worthIt"
     from recommendation_impressions i
     left join ratings r on r.user_id = i.user_id and r.resource_id = i.resource_id and r.updated_at >= i.shown_at
     where i.shown_at >= $1
     group by i.source_type, i.explanation_code
     order by i.source_type, count(*) desc`,
    [since],
  );
}
