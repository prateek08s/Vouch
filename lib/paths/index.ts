import type { Db } from "@/lib/db";

export const PATH_LEVELS = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" } as const;
export type PathLevel = keyof typeof PATH_LEVELS;
export type PathMetadata = { level: PathLevel; prerequisites: string[]; outcomes: string[] };
export type PathResult = { ok: true } | { ok: false; error: string };

function lines(raw: string): string[] {
  return [...new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

/** Only the collection's owner can change its path metadata. Disabling preserves all lessons. */
export async function savePath(
  db: Db, ownerId: string, listId: string,
  input: { enabled: boolean; level: string; prerequisites: string; outcomes: string },
): Promise<PathResult> {
  const prerequisites = lines(input.prerequisites), outcomes = lines(input.outcomes);
  if (input.enabled && (!Object.hasOwn(PATH_LEVELS, input.level) || !outcomes.length ||
      outcomes.length > 8 || prerequisites.length > 8 ||
      [...outcomes, ...prerequisites].some((line) => line.length > 240))) {
    return { ok: false, error: "Choose a level and add 1 to 8 outcomes. Use up to 8 prerequisites, with at most 240 characters per line." };
  }
  return db.transaction(async (tx) => {
    const [owner] = await tx.query("select 1 from lists where id = $1 and owner_id = $2 for update", [listId, ownerId]);
    if (!owner) return { ok: false, error: "That collection is unavailable or belongs to someone else." };
    if (!input.enabled) {
      await tx.query("delete from learning_paths where list_id = $1", [listId]);
      return { ok: true };
    }
    await tx.query(
      `insert into learning_paths (list_id, level, prerequisites, outcomes) values ($1, $2, $3, $4)
       on conflict (list_id) do update set level = excluded.level, prerequisites = excluded.prerequisites,
         outcomes = excluded.outcomes, updated_at = now()`,
      [listId, input.level, prerequisites, outcomes],
    );
    return { ok: true };
  });
}

export async function pathMetadata(db: Db, viewerId: string | null, listId: string): Promise<PathMetadata | null> {
  const [row] = await db.query<PathMetadata>(
    `select p.level, p.prerequisites, p.outcomes from learning_paths p join lists l on l.id = p.list_id
     where p.list_id = $1 and (l.is_public or l.owner_id = $2)`, [listId, viewerId],
  );
  return row ?? null;
}

export type PathSummary = PathMetadata & {
  id: string; title: string; description: string | null; owner_name: string; lesson_count: number;
  duration_s: number; unknown_runtime: number;
};

export async function publicPaths(db: Db): Promise<PathSummary[]> {
  return db.query<PathSummary>(
    `select l.id, l.title, l.description, u.display_name as owner_name, p.level, p.prerequisites, p.outcomes,
       count(*)::int as lesson_count, coalesce(sum(r.duration_s), 0)::int as duration_s,
       count(*) filter (where r.duration_s is null)::int as unknown_runtime
     from learning_paths p join lists l on l.id = p.list_id join users u on u.id = l.owner_id
     join list_items li on li.list_id = l.id join resources r on r.id = li.resource_id
     where l.is_public and r.metadata_status <> 'unavailable'
     group by l.id, u.display_name, p.list_id
     order by p.updated_at desc, l.id limit 100`,
  );
}
