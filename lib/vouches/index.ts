import type { Db } from "@/lib/db";
import type { TrustTier } from "@/lib/users";

/**
 * A Vouch means "I believe this is worth your time." Scarcity gives it weight,
 * so the daily limit is enforced atomically, not just checked.
 */

export const NOTE_MAX = 280;
export const MAX_TOPICS = 3;
export const DAILY_LIMIT: Record<TrustTier, number> = { new: 5, standard: 10, founding: 10 };
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type Vouch = {
  id: string;
  user_id: string;
  resource_id: string;
  note: string | null;
  is_own_content: boolean;
  is_daily_vouch: boolean;
  created_at: Date;
  updated_at: Date;
};

export type VouchError =
  | "user_not_found"
  | "resource_not_found"
  | "resource_unavailable"
  | "already_vouched"
  | "daily_limit_reached"
  | "note_too_long"
  | "topics_required"
  | "too_many_topics"
  | "unknown_topic"
  | "vouch_not_found";

export const VOUCH_ERROR_MESSAGES: Record<VouchError, string> = {
  user_not_found: "Sign in to vouch.",
  resource_not_found: "That video isn't in Vouch yet.",
  resource_unavailable: "That video is no longer available on YouTube.",
  already_vouched: "You've already vouched for this. You can edit your note instead.",
  daily_limit_reached: "You've used today's vouches. Scarcity is what makes them mean something.",
  note_too_long: `Keep your note under ${NOTE_MAX} characters.`,
  topics_required: "Pick at least one topic.",
  too_many_topics: `Pick up to ${MAX_TOPICS} topics.`,
  unknown_topic: "One of those topics doesn't exist.",
  vouch_not_found: "That vouch doesn't exist.",
};

export type VouchInput = {
  userId: string;
  resourceId: string;
  note?: string | null;
  topicSlugs: string[];
  isOwnContent?: boolean;
};

type Deps = { db: Db; now?: () => Date };
type Result<T> = { ok: true } & T | { ok: false; error: VouchError };

function cleanNote(note: string | null | undefined): string | null {
  const n = note?.trim().replace(/\s+\n/g, "\n") ?? "";
  return n.length ? n : null;
}

async function resolveTopics(db: Db, slugs: string[]): Promise<Result<{ topicIds: number[] }>> {
  const unique = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "topics_required" };
  if (unique.length > MAX_TOPICS) return { ok: false, error: "too_many_topics" };
  const rows = await db.query<{ id: number }>("select id from topics where slug = any($1::text[])", [unique]);
  if (rows.length !== unique.length) return { ok: false, error: "unknown_topic" };
  return { ok: true, topicIds: rows.map((r) => r.id) };
}

async function setTopics(tx: Db, vouchId: string, resourceId: string, topicIds: number[]) {
  await tx.query("delete from vouch_topics where vouch_id = $1", [vouchId]);
  await tx.query(
    "insert into vouch_topics (vouch_id, topic_id) select $1, unnest($2::int[])",
    [vouchId, topicIds],
  );
  // Vouch tags also describe the resource, for search and topic trust.
  await tx.query(
    `insert into resource_topics (resource_id, topic_id, source)
     select $1, unnest($2::int[]), 'vouch'
     on conflict (resource_id, topic_id) do nothing`,
    [resourceId, topicIds],
  );
}

export async function remainingVouchesToday(db: Db, userId: string, now = new Date()): Promise<number> {
  const rows = await db.query<{ tier: TrustTier; used: number }>(
    `select u.trust_tier as tier,
            (select count(*)::int from vouches v where v.user_id = u.id and v.created_at > $2) as used
     from users u where u.id = $1`,
    [userId, new Date(now.getTime() - WINDOW_MS)],
  );
  if (!rows[0]) return 0;
  return Math.max(0, DAILY_LIMIT[rows[0].tier] - rows[0].used);
}

export async function createVouch(input: VouchInput, deps: Deps): Promise<Result<{ vouch: Vouch }>> {
  const now = deps.now?.() ?? new Date();
  const note = cleanNote(input.note);
  if (note && note.length > NOTE_MAX) return { ok: false, error: "note_too_long" };
  const topics = await resolveTopics(deps.db, input.topicSlugs);
  if (!topics.ok) return topics;

  return deps.db.transaction(async (tx) => {
    // Lock the user row so concurrent vouches from one account serialize on the limit check.
    const [user] = await tx.query<{ trust_tier: TrustTier; is_system: boolean }>(
      "select trust_tier, is_system from users where id = $1 for update",
      [input.userId],
    );
    if (!user) return { ok: false, error: "user_not_found" } as const;

    const [resource] = await tx.query<{ metadata_status: string }>(
      "select metadata_status from resources where id = $1",
      [input.resourceId],
    );
    if (!resource) return { ok: false, error: "resource_not_found" } as const;
    if (resource.metadata_status === "unavailable") return { ok: false, error: "resource_unavailable" } as const;

    const existing = await tx.query("select 1 from vouches where user_id = $1 and resource_id = $2", [
      input.userId,
      input.resourceId,
    ]);
    if (existing.length) return { ok: false, error: "already_vouched" } as const;

    // Scarcity is for people. System curators (importers) vouch on behalf of a whole community.
    if (!user.is_system) {
      const [{ used }] = await tx.query<{ used: number }>(
        "select count(*)::int as used from vouches where user_id = $1 and created_at > $2",
        [input.userId, new Date(now.getTime() - WINDOW_MS)],
      );
      if (used >= DAILY_LIMIT[user.trust_tier]) return { ok: false, error: "daily_limit_reached" } as const;
    }

    const [vouch] = await tx.query<Vouch>(
      `insert into vouches (user_id, resource_id, note, is_own_content, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $5) returning *`,
      [input.userId, input.resourceId, note, input.isOwnContent ?? false, now],
    );
    await setTopics(tx, vouch.id, input.resourceId, topics.topicIds);
    // Analytics measure people. Imported vouches would swamp the vouch_created counts.
    if (!user.is_system) {
      await tx.query(
        "insert into events (user_id, name, props, created_at) values ($1, 'vouch_created', $2, $3)",
        [input.userId, JSON.stringify({ resource_id: input.resourceId, own: vouch.is_own_content }), now],
      );
    }
    return { ok: true, vouch } as const;
  });
}

/** Editing a note or topics never costs a vouch and never resets its age. */
export async function updateVouch(
  input: { userId: string; vouchId: string; note?: string | null; topicSlugs?: string[]; isOwnContent?: boolean },
  deps: Deps,
): Promise<Result<{ vouch: Vouch }>> {
  const now = deps.now?.() ?? new Date();
  const note = input.note === undefined ? undefined : cleanNote(input.note);
  if (note && note.length > NOTE_MAX) return { ok: false, error: "note_too_long" };
  let topicIds: number[] | null = null;
  if (input.topicSlugs) {
    const t = await resolveTopics(deps.db, input.topicSlugs);
    if (!t.ok) return t;
    topicIds = t.topicIds;
  }

  return deps.db.transaction(async (tx) => {
    const [vouch] = await tx.query<Vouch>(
      `update vouches set
         note = case when $3::boolean then $4 else note end,
         is_own_content = coalesce($5, is_own_content),
         updated_at = $6
       where id = $1 and user_id = $2
       returning *`,
      [input.vouchId, input.userId, note !== undefined, note ?? null, input.isOwnContent ?? null, now],
    );
    if (!vouch) return { ok: false, error: "vouch_not_found" } as const;
    if (topicIds) await setTopics(tx, vouch.id, vouch.resource_id, topicIds);
    return { ok: true, vouch } as const;
  });
}

export async function deleteVouch(db: Db, userId: string, vouchId: string): Promise<boolean> {
  const rows = await db.query("delete from vouches where id = $1 and user_id = $2 returning id", [vouchId, userId]);
  return rows.length > 0;
}
