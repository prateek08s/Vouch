import type { Db } from "@/lib/db";

export type Topic = { id: number; slug: string; name: string; parentId: number | null };

export type TopicIndex = {
  byId: Map<number, Topic>;
  bySlug: Map<string, Topic>;
  /** Slugs of a topic and all its ancestors, nearest first. */
  lineage(id: number): string[];
};

export async function loadTopics(db: Db): Promise<TopicIndex> {
  const rows = await db.query<{ id: number; slug: string; name: string; parent_topic_id: number | null }>(
    "select id, slug, name, parent_topic_id from topics order by id",
  );
  const byId = new Map<number, Topic>();
  for (const r of rows) byId.set(r.id, { id: r.id, slug: r.slug, name: r.name, parentId: r.parent_topic_id });
  const bySlug = new Map([...byId.values()].map((t) => [t.slug, t]));
  const cache = new Map<number, string[]>();

  function lineage(id: number): string[] {
    const hit = cache.get(id);
    if (hit) return hit;
    const out: string[] = [];
    const seen = new Set<number>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.push(cur.slug);
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
    cache.set(id, out);
    return out;
  }
  return { byId, bySlug, lineage };
}

export type TopicGroup = { root: Topic; topics: (Topic & { depth: number; label: string })[] };

/**
 * Topics as a readable tree per root: the root first, then each branch followed by its leaves,
 * alphabetical at every level. Used wherever people pick a topic.
 */
export function groupedTopics(index: TopicIndex): TopicGroup[] {
  const all = [...index.byId.values()];
  const byName = (a: Topic, b: Topic) => a.name.localeCompare(b.name);
  const children = (id: number) => all.filter((t) => t.parentId === id).sort(byName);
  return all
    .filter((t) => t.parentId === null)
    .sort((a, b) => a.id - b.id)
    .map((root) => {
      const out: TopicGroup["topics"] = [{ ...root, depth: 0, label: root.name }];
      const walk = (id: number, depth: number) => {
        for (const c of children(id)) {
          out.push({ ...c, depth, label: c.name });
          walk(c.id, depth + 1);
        }
      };
      walk(root.id, 1);
      return { root, topics: out };
    });
}
