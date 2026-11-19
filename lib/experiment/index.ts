import type { Db } from "@/lib/db";

/** First-party cookie holding a random browser ID. Never linked to an account. */
export const ANON_COOKIE = "vouch_aid";
export const ANON_MAX_AGE_S = 365 * 86_400;
export const ANON_RETENTION_DAYS = 90;

export type Variant = "note" | "nonote";
export type AnonKind = "impression" | "open" | "worth" | "not";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isAnonId = (v: string | undefined | null): v is string => !!v && UUID.test(v);

/** Whether the note experiment is running (VOUCH_NOTE_EXPERIMENT=1). Off: everyone sees the note. */
export const experimentOn = (env: Record<string, string | undefined> = process.env) => env.VOUCH_NOTE_EXPERIMENT === "1";

/** While the experiment runs, half of browsers see the Hacker News reason on cards, half don't. Stable per browser. */
export function variantFor(anonId: string): Variant {
  return parseInt(anonId.replace(/-/g, "").slice(-2), 16) % 2 === 0 ? "note" : "nonote";
}

/** Impressions and opens count once per browser and video. */
export async function recordAnon(
  db: Db, anonId: string, variant: Variant, kind: "impression" | "open", resourceIds: string[],
): Promise<void> {
  if (!resourceIds.length) return;
  await db.query(
    `insert into anon_events (anon_id, variant, kind, resource_id)
     select $1, $2, $3, r.id from resources r where r.id = any($4::uuid[])
     on conflict (anon_id, kind, resource_id) do nothing`,
    [anonId, variant, kind, resourceIds],
  );
}

/** A signed-out Worth it / Not worth it. The latest answer replaces the earlier one. */
export async function recordAnonRating(db: Db, anonId: string, variant: Variant, resourceId: string, worth: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      "delete from anon_events where anon_id = $1 and resource_id = $2 and kind in ('worth', 'not')",
      [anonId, resourceId],
    );
    await tx.query(
      `insert into anon_events (anon_id, variant, kind, resource_id)
       select $1, $2, $3, r.id from resources r where r.id = $4
       on conflict (anon_id, kind, resource_id) do nothing`,
      [anonId, variant, worth ? "worth" : "not", resourceId],
    );
  });
}

export type VariantReport = {
  variant: Variant;
  visitors: number;
  /** Browsers active on at least two different days. */
  returning: number;
  shown: number;
  opened: number;
  worth: number;
  notWorth: number;
};

/** Totals per variant, for the Insights page. No per-browser rows leave this query. */
export async function experimentReport(db: Db): Promise<VariantReport[]> {
  const rows = await db.query<{
    variant: Variant; visitors: number; returning: number; shown: number; opened: number; worth: number; not_worth: number;
  }>(
    `with days as (
       select variant, anon_id, count(distinct (created_at at time zone 'utc')::date) as d
       from anon_events group by variant, anon_id
     )
     select v.variant,
            (select count(*)::int from days where days.variant = v.variant) as visitors,
            (select count(*)::int from days where days.variant = v.variant and d >= 2) as returning,
            count(*) filter (where e.kind = 'impression')::int as shown,
            count(*) filter (where e.kind = 'open')::int as opened,
            count(*) filter (where e.kind = 'worth')::int as worth,
            count(*) filter (where e.kind = 'not')::int as not_worth
     from (values ('note'), ('nonote')) as v(variant)
     left join anon_events e on e.variant = v.variant
     group by v.variant
     order by v.variant`,
  );
  return rows.map((r) => ({
    variant: r.variant, visitors: r.visitors, returning: r.returning, shown: r.shown, opened: r.opened,
    worth: r.worth, notWorth: r.not_worth,
  }));
}

/** Deletes browser events past the retention window. Run daily. */
export async function pruneAnonEvents(db: Db, now = new Date()): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "delete from anon_events where created_at < $1 returning id",
    [new Date(now.getTime() - ANON_RETENTION_DAYS * 86_400_000)],
  );
  return rows.length;
}
