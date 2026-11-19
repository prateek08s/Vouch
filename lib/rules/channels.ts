import type { Db } from "@/lib/db";

/** Display names for channel rule values (channel IDs or URLs), from the videos we know. */
export async function channelNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.query<{ id: string; name: string }>(
    `select distinct on (creator_external_id) creator_external_id as id, creator_name as name
     from resources where creator_external_id = any($1::text[]) and creator_name is not null`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}
