import type { Db } from "@/lib/db";
import { recomputeTrust } from "@/lib/trust";

type Deps = { db: Db; now?: () => Date };

/**
 * Records which vouch carried a resource to this user (provenance / Vouch Chain).
 * The first attribution wins: the person who actually brought you there.
 */
export async function recordOpen(
  db: Db,
  input: { userId: string; resourceId: string; vouchId: string | null; source?: string },
) {
  await db.transaction(async (tx) => {
    // Keep the resource alive until provenance and the open event commit together.
    const [resource] = await tx.query(
      "select id from resources where id = $1 for key share",
      [input.resourceId],
    );
    if (!resource) return;
    let curatorId: string | null = null;
    if (input.vouchId) {
      const [v] = await tx.query<{ user_id: string }>(
        "select user_id from vouches where id = $1 and resource_id = $2",
        [input.vouchId, input.resourceId],
      );
      curatorId = v?.user_id ?? null;
    }
    await tx.query(
      `insert into vouch_attribution (user_id, resource_id, source_vouch_id, source_curator_id)
       values ($1, $2, $3, $4) on conflict (user_id, resource_id) do nothing`,
      [input.userId, input.resourceId, curatorId ? input.vouchId : null, curatorId],
    );
    await tx.query("insert into events (user_id, name, props) values ($1, 'recommendation_opened', $2)", [
      input.userId,
      JSON.stringify({ resource_id: input.resourceId, source: input.source ?? "circle" }),
    ]);
  });
}

export type RateError = "resource_not_found";

/**
 * Worth It / Not Worth It. Updates trust for every curator in the user's circle who vouched
 * for it before the rating, plus whoever the user came through.
 * Re-rating replaces the earlier answer; the rating keeps its original time for attribution.
 */
export async function rate(
  input: { userId: string; resourceId: string; worthIt: boolean },
  deps: Deps,
): Promise<{ ok: true; updatedCurators: string[]; changed: boolean } | { ok: false; error: RateError }> {
  const now = deps.now?.() ?? new Date();
  const db = deps.db;

  const [res] = await db.query("select 1 from resources where id = $1", [input.resourceId]);
  if (!res) return { ok: false, error: "resource_not_found" };

  const result = await db.transaction(async (tx) => {
    const [attr] = await tx.query<{ source_vouch_id: string | null; source_curator_id: string | null }>(
      "select source_vouch_id, source_curator_id from vouch_attribution where user_id = $1 and resource_id = $2",
      [input.userId, input.resourceId],
    );
    const [prev] = await tx.query<{ worth_it: boolean }>(
      "select worth_it from ratings where user_id = $1 and resource_id = $2",
      [input.userId, input.resourceId],
    );
    await tx.query(
      `insert into ratings (user_id, resource_id, worth_it, attribution_vouch_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $5)
       on conflict (user_id, resource_id) do update set worth_it = excluded.worth_it, updated_at = excluded.updated_at`,
      [input.userId, input.resourceId, input.worthIt, attr?.source_vouch_id ?? null, now],
    );
    const curators = await tx.query<{ user_id: string }>(
      `select distinct v.user_id
       from vouches v
       join ratings r on r.user_id = $1 and r.resource_id = v.resource_id
       where v.resource_id = $2 and v.user_id <> $1 and v.created_at <= r.created_at
         and (v.user_id in (select followee_id from follows where follower_id = $1) or v.user_id = $3)`,
      [input.userId, input.resourceId, attr?.source_curator_id ?? null],
    );
    const changed = prev?.worth_it !== input.worthIt;
    if (changed) {
      await tx.query("insert into events (user_id, name, props, created_at) values ($1, $2, $3, $4)", [
        input.userId,
        input.worthIt ? "worth_it" : "not_worth_it",
        JSON.stringify({ resource_id: input.resourceId, attributed: attr?.source_curator_id ?? null }),
        now,
      ]);
    }
    const ids = curators.map((c) => c.user_id);
    await recomputeTrust(tx, input.userId, ids, now);
    return { ids, changed };
  });

  return { ok: true, updatedCurators: result.ids, changed: result.changed };
}
