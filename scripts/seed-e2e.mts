// A small, fixed catalogue for browser tests: one system curator, three videos, one public list.
// No network: metadata is written directly. Uses DATABASE_URL when set (run db:migrate first),
// otherwise the local PGlite directory.
//   npx tsx scripts/seed-e2e.mts
import { Pool } from "pg";
import { openPglite, type Db } from "@/lib/db";
import { postgresDb } from "@/lib/db/postgres";
import { savePath } from "@/lib/paths";
import { addLessonResource } from "@/lib/lesson-resources";

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 }) : null;
const db: Db & { close?: () => Promise<void> } = pool ? postgresDb(pool) : await openPglite(process.env.VOUCH_DATA_DIR ?? ".data/pglite");

const videos = [
  { id: "aircAruvnKk", title: "But what is a neural network?", channel: "3Blue1Brown", topic: "ai", note: "The clearest first hour on neural networks." },
  { id: "spUNpyF58BY", title: "But what is the Fourier Transform? A visual introduction.", channel: "3Blue1Brown", topic: "pure-math", note: "The winding machine makes it obvious." },
  { id: "8aGhZQkoFbQ", title: "What the heck is the event loop anyway?", channel: "JSConf", topic: "web", note: null },
];

await db.transaction(async (tx) => {
  const [hn] = await tx.query<{ id: string }>(
    `insert into users (username, display_name, bio, is_system, trust_tier)
     values ('e2e_curator', 'E2E Curator', 'Fixed picks for browser tests.', true, 'founding')
     on conflict (username) do update set display_name = excluded.display_name returning id`,
  );
  const ids: string[] = [];
  for (const v of videos) {
    const [r] = await tx.query<{ id: string }>(
      `insert into resources (source, external_id, canonical_url, title, creator_name, duration_s, thumbnail_url, metadata_status, metadata_refreshed_at)
       values ('youtube', $1, $2, $3, $4, 1000, $5, 'ok', now())
       on conflict (source, external_id) do update set title = excluded.title returning id`,
      [v.id, `https://www.youtube.com/watch?v=${v.id}`, v.title, v.channel, `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`],
    );
    ids.push(r.id);
    const [vouch] = await tx.query<{ id: string }>(
      `insert into vouches (user_id, resource_id, note) values ($1, $2, $3)
       on conflict (user_id, resource_id) do update set note = excluded.note returning id`,
      [hn.id, r.id, v.note],
    );
    await tx.query(
      "insert into vouch_topics (vouch_id, topic_id) select $1, id from topics where slug = $2 on conflict do nothing",
      [vouch.id, v.topic],
    );
  }
  const [list] = await tx.query<{ id: string }>(
    `insert into lists (owner_id, title, description, is_public, system_key) values ($1, 'E2E Starter List', 'Three videos, in order.', true, 'e2e')
     on conflict (system_key) where system_key is not null do update set title = excluded.title returning id`,
    [hn.id],
  );
  await tx.query("delete from list_items where list_id = $1", [list.id]);
  for (const [i, rid] of ids.entries()) {
    await tx.query("insert into list_items (list_id, resource_id, position) values ($1, $2, $3)", [list.id, rid, i]);
  }
});
const [pathList] = await db.query<{ id: string; owner_id: string }>("select id, owner_id from lists where system_key = 'e2e'");
const pathResult = await savePath(db, pathList.owner_id, pathList.id, {
  enabled: true, level: "beginner", prerequisites: "Basic algebra",
  outcomes: "Explain a neural network\nConnect a visual model with its underlying idea",
});
if (!pathResult.ok) throw new Error(pathResult.error);
const [firstLesson] = await db.query<{ resource_id: string }>("select resource_id from list_items where list_id = $1 order by position limit 1", [pathList.id]);
for (const kind of ["code", "notebook", "paper"]) {
  const result = await addLessonResource(db, pathList.owner_id, pathList.id, firstLesson.resource_id, {
    kind, title: `Lesson example ${kind}`, url: `https://example.org/lesson-${kind}`,
  });
  if (!result.ok) throw new Error(result.error);
}
console.log("Seeded browser-test catalogue: 3 videos, 1 learning path, 3 resource links.");
await (pool ? pool.end() : db.close?.());
process.exit(0);
