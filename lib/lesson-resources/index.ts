import type { Db } from "@/lib/db";
import { LESSON_RESOURCE_MAX, RESOURCE_KINDS, resourceUrl, type LessonResource } from "./model";
export * from "./model";
type Result = { ok: true } | { ok: false; error: string };

export async function addLessonResource(db: Db, ownerId: string, listId: string, resourceId: string,
  input: { kind: string; title: string; url: string }): Promise<Result> {
  const title = input.title.trim().replace(/\s+/g, " "), url = resourceUrl(input.url);
  if (!title || title.length > 120 || !url || !Object.hasOwn(RESOURCE_KINDS, input.kind)) {
    return { ok: false, error: "Choose a resource type, a title up to 120 characters, and an HTTPS link without login credentials." };
  }
  return db.transaction(async (tx) => {
    const [owner] = await tx.query("select 1 from lists where id = $1 and owner_id = $2 for update", [listId, ownerId]);
    if (!owner) return { ok: false, error: "That collection is unavailable or belongs to someone else." };
    const [lesson] = await tx.query("select 1 from list_items where list_id = $1 and resource_id = $2", [listId, resourceId]);
    if (!lesson) return { ok: false, error: "That video is not in this collection." };
    const [existing] = await tx.query("select 1 from lesson_resources where list_id = $1 and resource_id = $2 and url = $3", [listId, resourceId, url]);
    if (existing) return { ok: false, error: "That link is already attached to this lesson." };
    const [{ count }] = await tx.query<{count: number}>("select count(*)::int as count from lesson_resources where list_id = $1 and resource_id = $2", [listId, resourceId]);
    if (count >= LESSON_RESOURCE_MAX) return { ok: false, error: "A lesson can have up to 8 resources." };
    await tx.query("insert into lesson_resources (list_id, resource_id, kind, title, url) values ($1, $2, $3, $4, $5)", [listId, resourceId, input.kind, title, url]);
    return { ok: true };
  });
}

export async function removeLessonResource(db: Db, ownerId: string, listId: string, resourceId: string, attachmentId: string): Promise<Result> {
  return db.transaction(async (tx) => {
    const [owner] = await tx.query("select 1 from lists where id = $1 and owner_id = $2 for update", [listId, ownerId]);
    if (!owner) return { ok: false, error: "That collection is unavailable or belongs to someone else." };
    const removed = await tx.query("delete from lesson_resources where id = $1 and list_id = $2 and resource_id = $3 returning 1", [attachmentId, listId, resourceId]);
    return removed.length ? { ok: true } : { ok: false, error: "That lesson resource is no longer available." };
  });
}

/** Visibility is inherited from the collection, including when opened from a watch-page URL. */
export async function lessonResources(db: Db, viewerId: string | null, listId: string, resourceId: string | null = null): Promise<LessonResource[]> {
  return db.query<LessonResource>(
    `select a.id, a.list_id, a.resource_id, a.kind, a.title, a.url from lesson_resources a
     join lists l on l.id = a.list_id
     where a.list_id = $1 and (l.is_public or l.owner_id = $2) and ($3::uuid is null or a.resource_id = $3)
     order by a.created_at, a.id`, [listId, viewerId, resourceId],
  );
}
