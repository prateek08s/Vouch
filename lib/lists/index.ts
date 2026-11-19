import type { Db } from "@/lib/db";
import { applyRules, listRules } from "@/lib/rules";
import { loadTopics } from "@/lib/topics";

/** An ordered human collection (plan 5.6). Followable. */

export const LIST_MAX_ITEMS = 100;
export const LIST_TITLE_MAX = 120;
export const LIST_DESC_MAX = 500;

export type List = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  created_at: Date;
};

export type ListItem = {
  resource_id: string;
  position: number;
  note: string | null;
  title: string;
  creator_name: string | null;
  duration_s: number | null;
  thumbnail_url: string | null;
  metadata_status: string;
  rated: boolean | null;
};

export type ListError =
  | "invalid_title"
  | "description_too_long"
  | "note_too_long"
  | "list_not_found"
  | "resource_not_found"
  | "already_in_list"
  | "list_full"
  | "not_in_list"
  | "own_list";

export const LIST_ERROR_MESSAGES: Record<ListError, string> = {
  invalid_title: `Give the list a title (up to ${LIST_TITLE_MAX} characters).`,
  description_too_long: `Keep the description under ${LIST_DESC_MAX} characters.`,
  note_too_long: "Keep the note under 280 characters.",
  list_not_found: "That list doesn't exist.",
  resource_not_found: "That video isn't in Vouch.",
  already_in_list: "That video is already in this list.",
  list_full: `Lists hold up to ${LIST_MAX_ITEMS} videos.`,
  not_in_list: "That video isn't in this list.",
  own_list: "This is your list.",
};

type R<T = object> = ({ ok: true } & T) | { ok: false; error: ListError };

export async function createList(
  db: Db,
  ownerId: string,
  input: { title: string; description?: string | null; isPublic?: boolean },
): Promise<R<{ list: List }>> {
  const title = input.title.trim().replace(/\s+/g, " ");
  const description = input.description?.trim() || null;
  if (!title || title.length > LIST_TITLE_MAX) return { ok: false, error: "invalid_title" };
  if (description && description.length > LIST_DESC_MAX) return { ok: false, error: "description_too_long" };
  const [list] = await db.query<List>(
    "insert into lists (owner_id, title, description, is_public) values ($1, $2, $3, $4) returning *",
    [ownerId, title, description, input.isPublic ?? true],
  );
  return { ok: true, list };
}

/** Owner-only lookup with a row lock, so concurrent edits to one list serialize. */
async function ownedList(tx: Db, ownerId: string, listId: string): Promise<List | null> {
  const [l] = await tx.query<List>("select * from lists where id = $1 and owner_id = $2 for update", [listId, ownerId]);
  return l ?? null;
}

export async function addToList(
  db: Db,
  ownerId: string,
  listId: string,
  resourceId: string,
  note?: string | null,
): Promise<R<{ position: number }>> {
  const n = note?.trim() || null;
  if (n && n.length > 280) return { ok: false, error: "note_too_long" };
  return db.transaction(async (tx) => {
    if (!(await ownedList(tx, ownerId, listId))) return { ok: false, error: "list_not_found" } as const;
    const [res] = await tx.query("select 1 from resources where id = $1", [resourceId]);
    if (!res) return { ok: false, error: "resource_not_found" } as const;
    const [{ count, max }] = await tx.query<{ count: number; max: number | null }>(
      "select count(*)::int as count, max(position) as max from list_items where list_id = $1",
      [listId],
    );
    if (count >= LIST_MAX_ITEMS) return { ok: false, error: "list_full" } as const;
    const position = (max ?? -1) + 1;
    const inserted = await tx.query(
      `insert into list_items (list_id, resource_id, position, note) values ($1, $2, $3, $4)
       on conflict (list_id, resource_id) do nothing returning 1`,
      [listId, resourceId, position, n],
    );
    if (!inserted.length) return { ok: false, error: "already_in_list" } as const;
    return { ok: true, position } as const;
  });
}

/** Rewrites positions as 0..n-1 in the given order. The unique(list, position) check is deferred. */
async function writeOrder(tx: Db, listId: string, resourceIds: string[]) {
  await tx.query(
    `update list_items li set position = o.pos - 1
     from unnest($2::uuid[]) with ordinality as o(resource_id, pos)
     where li.list_id = $1 and li.resource_id = o.resource_id`,
    [listId, resourceIds],
  );
}

async function currentOrder(tx: Db, listId: string): Promise<string[]> {
  const rows = await tx.query<{ resource_id: string }>(
    "select resource_id from list_items where list_id = $1 order by position, resource_id",
    [listId],
  );
  return rows.map((r) => r.resource_id);
}

export async function removeFromList(db: Db, ownerId: string, listId: string, resourceId: string): Promise<R> {
  return db.transaction(async (tx) => {
    if (!(await ownedList(tx, ownerId, listId))) return { ok: false, error: "list_not_found" } as const;
    const del = await tx.query("delete from list_items where list_id = $1 and resource_id = $2 returning 1", [listId, resourceId]);
    if (!del.length) return { ok: false, error: "not_in_list" } as const;
    await writeOrder(tx, listId, await currentOrder(tx, listId));
    return { ok: true } as const;
  });
}

/** Moves an item to a new 0-based index (clamped). Accessible up/down buttons call this with index +/- 1. */
export async function moveItem(db: Db, ownerId: string, listId: string, resourceId: string, toIndex: number): Promise<R> {
  return db.transaction(async (tx) => {
    if (!(await ownedList(tx, ownerId, listId))) return { ok: false, error: "list_not_found" } as const;
    const order = await currentOrder(tx, listId);
    const from = order.indexOf(resourceId);
    if (from === -1) return { ok: false, error: "not_in_list" } as const;
    const to = Math.max(0, Math.min(order.length - 1, Math.trunc(toIndex)));
    order.splice(to, 0, ...order.splice(from, 1));
    await writeOrder(tx, listId, order);
    return { ok: true } as const;
  });
}

export async function deleteList(db: Db, ownerId: string, listId: string): Promise<boolean> {
  return (await db.query("delete from lists where id = $1 and owner_id = $2 returning 1", [listId, ownerId])).length > 0;
}

/** Visible lists only: public ones, or your own. */
async function visibleList(db: Db, viewerId: string, listId: string): Promise<List | null> {
  const [l] = await db.query<List>("select * from lists where id = $1 and (is_public or owner_id = $2)", [listId, viewerId]);
  return l ?? null;
}

export async function followList(db: Db, userId: string, listId: string): Promise<R> {
  const l = await visibleList(db, userId, listId);
  if (!l) return { ok: false, error: "list_not_found" };
  if (l.owner_id === userId) return { ok: false, error: "own_list" };
  await db.query("insert into list_follows (user_id, list_id) values ($1, $2) on conflict do nothing", [userId, listId]);
  return { ok: true };
}

export async function unfollowList(db: Db, userId: string, listId: string): Promise<boolean> {
  return (await db.query("delete from list_follows where user_id = $1 and list_id = $2 returning 1", [userId, listId])).length > 0;
}

export type ListView = {
  list: List;
  owner: { id: string; username: string; display_name: string };
  items: ListItem[];
  followerCount: number;
  isFollowing: boolean;
  isOwner: boolean;
};

export async function getList(db: Db, viewerId: string, listId: string): Promise<ListView | null> {
  const list = await visibleList(db, viewerId, listId);
  if (!list) return null;
  const [owner] = await db.query<ListView["owner"]>("select id, username, display_name from users where id = $1", [list.owner_id]);
  const items = await db.query<ListItem>(
    `select li.resource_id, li.position, li.note, r.title, r.creator_name, r.duration_s, r.thumbnail_url,
            r.metadata_status, rt.worth_it as rated
     from list_items li join resources r on r.id = li.resource_id
     left join ratings rt on rt.user_id = $2 and rt.resource_id = li.resource_id
     where li.list_id = $1 order by li.position`,
    [listId, viewerId],
  );
  const [{ n, following }] = await db.query<{ n: number; following: boolean }>(
    `select count(*)::int as n, coalesce(bool_or(user_id = $2), false) as following
     from list_follows where list_id = $1`,
    [listId, viewerId],
  );
  return { list, owner, items, followerCount: n, isFollowing: following, isOwner: list.owner_id === viewerId };
}

export type ListSummary = List & { item_count: number; owner_name: string; follower_count: number; following: boolean };

/** Your lists, then lists you follow, then other public lists. */
export async function listsFor(db: Db, viewerId: string): Promise<{ mine: ListSummary[]; following: ListSummary[]; discover: ListSummary[] }> {
  const rows = await db.query<ListSummary>(
    `select l.*, u.display_name as owner_name,
            (select count(*)::int from list_items li where li.list_id = l.id) as item_count,
            (select count(*)::int from list_follows f where f.list_id = l.id) as follower_count,
            exists (select 1 from list_follows f where f.list_id = l.id and f.user_id = $1) as following
     from lists l join users u on u.id = l.owner_id
     where l.is_public or l.owner_id = $1
     order by l.created_at desc`,
    [viewerId],
  );
  return {
    mine: rows.filter((l) => l.owner_id === viewerId),
    following: rows.filter((l) => l.owner_id !== viewerId && l.following),
    discover: rows.filter((l) => l.owner_id !== viewerId && !l.following && l.item_count > 0),
  };
}

export type UpNext = {
  listId: string;
  listTitle: string;
  ownerName: string;
  item: ListItem;
  index: number;
  total: number;
  hiddenByRules: number;
};

/**
 * For each followed list, the first video the viewer has not rated that their rules allow.
 * Lists are paths, so "next" beats re-ranking. Finished lists are omitted.
 */
export async function upNextFromLists(db: Db, viewerId: string): Promise<UpNext[]> {
  const rows = await db.query<ListItem & { list_id: string; list_title: string; owner_name: string; creator_external_id: string | null; is_short: boolean; topic_ids: number[] }>(
    `select l.id as list_id, l.title as list_title, u.display_name as owner_name,
            li.resource_id, li.position, li.note, r.title, r.creator_name, r.creator_external_id, r.duration_s,
            r.thumbnail_url, r.metadata_status, r.is_short, rt.worth_it as rated,
            coalesce((select array_agg(topic_id) from resource_topics x where x.resource_id = r.id), '{}') as topic_ids
     from list_follows f
     join lists l on l.id = f.list_id and (l.is_public or l.owner_id = $1)
     join users u on u.id = l.owner_id
     join list_items li on li.list_id = l.id
     join resources r on r.id = li.resource_id
     left join ratings rt on rt.user_id = $1 and rt.resource_id = r.id
     where f.user_id = $1
     order by f.created_at, l.id, li.position`,
    [viewerId],
  );
  if (!rows.length) return [];
  const [rules, topics] = await Promise.all([listRules(db, viewerId), loadTopics(db)]);

  const byList = new Map<string, typeof rows>();
  for (const r of rows) byList.set(r.list_id, [...(byList.get(r.list_id) ?? []), r]);

  const out: UpNext[] = [];
  for (const items of byList.values()) {
    const candidates = items
      .filter((i) => i.rated === null && i.metadata_status !== "unavailable")
      .map((i) => ({
        ...i,
        resourceId: i.resource_id,
        creatorId: i.creator_external_id,
        creatorName: i.creator_name,
        durationS: i.duration_s,
        isShort: i.is_short,
        topicSlugs: [...new Set(i.topic_ids.flatMap((id) => topics.lineage(id)))],
      }));
    const { kept, removed } = applyRules(candidates, rules);
    const next = kept[0];
    if (!next) continue;
    const item: ListItem = {
      resource_id: next.resource_id,
      position: next.position,
      note: next.note,
      title: next.title,
      creator_name: next.creator_name,
      duration_s: next.duration_s,
      thumbnail_url: next.thumbnail_url,
      metadata_status: next.metadata_status,
      rated: next.rated,
    };
    out.push({
      listId: next.list_id,
      listTitle: next.list_title,
      ownerName: next.owner_name,
      item,
      index: items.findIndex((i) => i.resource_id === next.resource_id),
      total: items.length,
      hiddenByRules: removed.length,
    });
  }
  return out;
}

/** The viewer's own lists, and whether a video is already in each (the watch page's "Add to list"). */
export async function myListsFor(db: Db, userId: string, resourceId: string) {
  return db.query<{ id: string; title: string; has: boolean }>(
    `select l.id, l.title, exists (select 1 from list_items li where li.list_id = l.id and li.resource_id = $2) as has
     from lists l where l.owner_id = $1 order by l.created_at desc`,
    [userId, resourceId],
  );
}
