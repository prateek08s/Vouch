import type { Db } from "@/lib/db";
import { applyRules, listRules } from "@/lib/rules";
import { loadTopics } from "@/lib/topics";
import { EMPTY_LEARNING, hasFinished, MAX_POSITION_S, playbackPosition, type LearningEntry, type LearningState, type LearningStatus } from "./model";

export * from "./model";

export async function learningState(db: Db, userId: string, resourceId: string): Promise<LearningState> {
  const [row] = await db.query<{ saved: boolean; status: LearningStatus | null; position_s: number | null }>(
    `select exists(select 1 from saved_resources where user_id = $1 and resource_id = $2) as saved,
       p.status, p.position_s
     from resources r left join watch_progress p on p.resource_id = r.id and p.user_id = $1
     where r.id = $2`, [userId, resourceId],
  );
  return row ? { saved: row.saved, status: row.status, positionS: row.position_s ?? 0 } : { ...EMPTY_LEARNING };
}

export async function setSaved(db: Db, userId: string, resourceId: string, saved: boolean): Promise<boolean> {
  if (!saved) {
    await db.query("delete from saved_resources where user_id = $1 and resource_id = $2", [userId, resourceId]);
    return true;
  }
  const rows = await db.query(
    `insert into saved_resources (user_id, resource_id)
     select $1, id from resources where id = $2 and metadata_status <> 'unavailable'
     on conflict (user_id, resource_id) do update set resource_id = excluded.resource_id returning 1`,
    [userId, resourceId],
  );
  return rows.length > 0;
}

export async function setLearningStatus(
  db: Db, userId: string, resourceId: string, status: LearningStatus, now = new Date(),
): Promise<boolean> {
  const rows = await db.query(
    `insert into watch_progress (user_id, resource_id, position_s, status, updated_at, sampled_at)
     select $1, id, 0, $3, $4, $4 from resources where id = $2
     on conflict (user_id, resource_id) do update set
       status = excluded.status,
       position_s = case when excluded.status = 'in_progress' then 0 else watch_progress.position_s end,
       updated_at = excluded.updated_at, sampled_at = excluded.sampled_at returning 1`,
    [userId, resourceId, status, now],
  );
  return rows.length > 0;
}

export async function savePlayback(
  db: Db, userId: string, resourceId: string,
  input: { positionS: number; observedAt: number; ended?: boolean }, now = new Date(),
): Promise<boolean> {
  // Bound timestamps and positions before any SQL. A delayed tab cannot overwrite a newer sample.
  if (!Number.isFinite(input.positionS) || input.positionS < 0 || input.positionS > MAX_POSITION_S ||
      !Number.isFinite(input.observedAt) || input.observedAt > now.getTime() + 5000 ||
      input.observedAt < now.getTime() - 120_000) return false;
  const [resource] = await db.query<{ duration_s: number | null }>(
    "select duration_s from resources where id = $1 and metadata_status <> 'unavailable'", [resourceId],
  );
  if (!resource) return false;
  const position = playbackPosition(input.positionS, resource.duration_s);
  const status = hasFinished(position, resource.duration_s, input.ended) ? "watched" : "in_progress";
  const rows = await db.query(
    `insert into watch_progress (user_id, resource_id, position_s, status, updated_at, sampled_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, resource_id) do update set
       position_s = excluded.position_s,
       status = case when watch_progress.status in ('watched', 'skipped')
                     then watch_progress.status else excluded.status end,
       updated_at = excluded.updated_at, sampled_at = excluded.sampled_at
     where watch_progress.sampled_at < excluded.sampled_at returning 1`,
    [userId, resourceId, position, status, now, new Date(input.observedAt)],
  );
  return rows.length > 0;
}

export async function learningLibrary(db: Db, userId: string): Promise<LearningEntry[]> {
  const rows = await db.query<{
    id: string; external_id: string; title: string; creator_name: string | null;
    thumbnail_url: string | null; duration_s: number | null; creator_external_id: string | null;
    is_short: boolean; topic_ids: number[]; saved: boolean; status: LearningStatus | null;
    position_s: number; activity_at: Date;
  }>(
    `select r.id, r.external_id, r.title, r.creator_name, r.thumbnail_url, r.duration_s,
            r.creator_external_id, r.is_short,
            array(select topic_id from resource_topics where resource_id = r.id) as topic_ids,
            s.resource_id is not null as saved, p.status, coalesce(p.position_s, 0) as position_s,
            greatest(p.updated_at, s.saved_at) as activity_at
     from resources r
     left join watch_progress p on p.resource_id = r.id and p.user_id = $1
     left join saved_resources s on s.resource_id = r.id and s.user_id = $1
     where (p.resource_id is not null or s.resource_id is not null) and r.metadata_status <> 'unavailable'
     order by activity_at desc, r.id limit 500`, [userId],
  );
  const [rules, topics] = await Promise.all([listRules(db, userId), loadTopics(db)]);
  const { kept } = applyRules(rows.map((r) => ({
    ...r, resourceId: r.id, creatorId: r.creator_external_id, creatorName: r.creator_name,
    durationS: r.duration_s, isShort: r.is_short,
    topicSlugs: [...new Set(r.topic_ids.flatMap((id) => topics.lineage(id)))],
  })), rules);
  return kept.map((r) => ({
    id: r.id, videoId: r.external_id, title: r.title, creatorName: r.creator_name,
    thumbnailUrl: r.thumbnail_url, durationS: r.duration_s, saved: r.saved,
    status: r.status, positionS: r.position_s, updatedAt: r.activity_at.toISOString(),
  }));
}
