import type { Db } from "@/lib/db";
import { TRUST_DEFAULT, trustFromCounts, type TrustStats } from "./model";

export * from "./model";

/**
 * Recomputes trust(user -> curator) overall and per topic from the ratings table.
 *
 * Evidence = the user's ratings of resources the curator vouched for *before* the user rated.
 * Derived, not incremented, so changed ratings and deleted vouches can never leave drift.
 */
export async function recomputeTrust(db: Db, userId: string, curatorIds: string[], now = new Date()) {
  const curators = curatorIds.filter((c) => c !== userId);
  if (!curators.length) return;

  await db.transaction(async (tx) => {
    const topicRows = await tx.query<{ curator_id: string; topic_id: number; n: number; w: number }>(
      `select v.user_id as curator_id, vt.topic_id,
              count(*)::int as n, (count(*) filter (where r.worth_it))::int as w
       from ratings r
       join vouches v on v.resource_id = r.resource_id and v.created_at <= r.created_at
       join vouch_topics vt on vt.vouch_id = v.id
       where r.user_id = $1 and v.user_id = any($2::uuid[])
       group by v.user_id, vt.topic_id`,
      [userId, curators],
    );
    const baseRows = await tx.query<{ curator_id: string; n: number; w: number }>(
      `select v.user_id as curator_id,
              count(*)::int as n, (count(*) filter (where r.worth_it))::int as w
       from ratings r
       join vouches v on v.resource_id = r.resource_id and v.created_at <= r.created_at
       where r.user_id = $1 and v.user_id = any($2::uuid[])
       group by v.user_id`,
      [userId, curators],
    );

    await tx.query(
      "delete from topic_trust_edges where user_id = $1 and curator_id = any($2::uuid[])",
      [userId, curators],
    );
    for (const r of topicRows) {
      const s = trustFromCounts(r.w, r.n);
      await tx.query(
        `insert into topic_trust_edges
           (user_id, curator_id, topic_id, weight, sample_count, worth_count, confidence, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, r.curator_id, r.topic_id, s.weight, s.sampleCount, s.worthCount, s.confidence, now],
      );
    }

    const base = new Map(baseRows.map((r) => [r.curator_id, trustFromCounts(r.w, r.n)]));
    for (const c of curators) {
      const s = base.get(c) ?? trustFromCounts(0, 0);
      await tx.query(
        `insert into trust_edges (user_id, curator_id, base_weight, updated_at) values ($1, $2, $3, $4)
         on conflict (user_id, curator_id) do update set base_weight = excluded.base_weight, updated_at = excluded.updated_at`,
        [userId, c, s.weight, now],
      );
    }
  });
}

export type CuratorTrust = {
  curatorId: string;
  base: TrustStats;
  byTopic: Map<number, TrustStats>;
};

/** Trust lookups for ranking and explanations. Unknown curators get the default. */
export async function loadTrust(db: Db, userId: string, curatorIds: string[]): Promise<Map<string, CuratorTrust>> {
  const out = new Map<string, CuratorTrust>();
  for (const c of curatorIds) out.set(c, { curatorId: c, base: trustFromCounts(0, 0), byTopic: new Map() });
  if (!curatorIds.length) return out;

  const topic = await db.query<{ curator_id: string; topic_id: number; weight: number; sample_count: number; worth_count: number; confidence: number }>(
    "select * from topic_trust_edges where user_id = $1 and curator_id = any($2::uuid[])",
    [userId, curatorIds],
  );
  // Base stats come from distinct rated resources; reuse the stored weight for consistency.
  const base = await db.query<{ curator_id: string; base_weight: number; n: number; w: number }>(
    `select te.curator_id, te.base_weight,
            coalesce(c.n, 0)::int as n, coalesce(c.w, 0)::int as w
     from trust_edges te
     left join lateral (
       select count(*) as n, count(*) filter (where r.worth_it) as w
       from ratings r join vouches v on v.resource_id = r.resource_id and v.created_at <= r.created_at
       where r.user_id = te.user_id and v.user_id = te.curator_id
     ) c on true
     where te.user_id = $1 and te.curator_id = any($2::uuid[])`,
    [userId, curatorIds],
  );
  for (const b of base) {
    const s = trustFromCounts(b.w, b.n);
    out.get(b.curator_id)!.base = { ...s, weight: b.base_weight ?? TRUST_DEFAULT };
  }
  for (const t of topic) {
    out.get(t.curator_id)!.byTopic.set(t.topic_id, {
      weight: t.weight,
      sampleCount: t.sample_count,
      worthCount: t.worth_count,
      confidence: t.confidence,
    });
  }
  return out;
}

/**
 * trust(u, c, topics): the best-evidenced topic edge among the vouch's topics,
 * falling back to base trust (plan 6.2: topic trust inherits base trust).
 */
export function trustFor(t: CuratorTrust | undefined, topicIds: number[]): TrustStats & { topicId: number | null } {
  if (!t) return { ...trustFromCounts(0, 0), topicId: null };
  let best: (TrustStats & { topicId: number }) | null = null;
  for (const id of topicIds) {
    const s = t.byTopic.get(id);
    if (s && (!best || s.sampleCount > best.sampleCount)) best = { ...s, topicId: id };
  }
  return best ?? { ...t.base, topicId: null };
}
