// Steps 3 and 4 of the Hacker News import: aggregate verdicts and write them into Vouch.
//
//   npx tsx --env-file=.env.local scripts/hn/import.mts --year 2025
//   npx tsx --env-file=.env.local scripts/hn/import.mts --months 2025-01 --dry-run
//
// Reads .data/hn/verdicts/*.jsonl and writes to the same local database as `npm run dev`
// (VOUCH_DATA_DIR, default .data/pglite). Stop the dev server first: PGlite allows one process.
// YOUTUBE_API_KEY (in .env.local) gives video lengths; without it, oEmbed is used.
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { openPglite } from "@/lib/db";
import { aggregate, planLists, type TopicInfo } from "@/lib/hn/aggregate";
import type { CommentVerdict } from "@/lib/hn/classify";
import { importHn } from "@/lib/hn/import";
import { defaultMetadataProvider } from "@/lib/youtube/metadata";

const { values: args } = parseArgs({
  options: {
    months: { type: "string" },
    year: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    concurrency: { type: "string", default: "6" },
    "data-dir": { type: "string", default: path.join(".data", "hn") },
  },
});

const months = args.months?.split(",").map((m) => m.trim()) ??
  (args.year ? Array.from({ length: 12 }, (_, i) => `${args.year}-${String(i + 1).padStart(2, "0")}`) : null);
if (!months?.length || months.some((m) => !/^\d{4}-\d{2}$/.test(m))) {
  console.error("Pass --months YYYY-MM[,YYYY-MM...] or --year YYYY");
  process.exit(2);
}

const verdicts: CommentVerdict[] = [];
for (const m of months) {
  const file = path.join(args["data-dir"]!, "verdicts", `${m}.jsonl`);
  if (!existsSync(file)) {
    console.warn(`${m}: no verdicts yet, run scripts/hn/classify.mts first`);
    continue;
  }
  for (const line of (await readFile(file, "utf8")).split("\n")) if (line) verdicts.push(JSON.parse(line));
}
const years = [...new Set(months.map((m) => m.slice(0, 4)))];
const period = years.length === 1 ? years[0] : `${years[0]} to ${years.at(-1)}`;

const aggs = aggregate(verdicts);
const recs = verdicts.flatMap((v) => v.videos).filter((v) => v.recommends);
console.log(
  `${verdicts.length} comments, ${recs.length} recommendations of ${aggs.length} videos; ` +
    `${aggs.filter((a) => a.topics.length).length} have a Vouch topic, ${aggs.filter((a) => a.recommenders > 1).length} were recommended by 2+ people.`,
);

const dir = process.env.VOUCH_DATA_DIR ?? path.join(".data", "pglite");
await mkdir(path.dirname(dir), { recursive: true });
const db = args["dry-run"] ? await openPglite() : await openPglite(dir);
const topics = await db.query<TopicInfo>(`select t.slug, t.name, p.slug as "parentSlug" from topics t left join topics p on p.id = t.parent_topic_id`);

if (args["dry-run"]) {
  for (const l of planLists(aggs, topics, period)) console.log(`  list "${l.title}": ${l.videoIds.length} videos`);
  console.log("Top 10:");
  for (const a of aggs.filter((x) => x.topics.length).slice(0, 10)) {
    console.log(`  ${a.recommenders}x ${a.videoId} [${a.topics.join(", ")}] ${a.featured ? `"${a.featured.excerpt}"` : ""}`);
  }
  await db.close();
  process.exit(0);
}

console.log(`Importing into ${dir} (${process.env.YOUTUBE_API_KEY ? "YouTube Data API" : "oEmbed, no video lengths"})...`);
let lastPct = -1;
const stats = await importHn(aggs, topics, { period }, {
  db,
  metadata: defaultMetadataProvider(),
  concurrency: Number(args.concurrency),
  onProgress: (done, total) => {
    const pct = Math.floor((done / total) * 10) * 10;
    if (pct === lastPct) return;
    lastPct = pct;
    console.log(`  YouTube lookups: ${done}/${total}`);
  },
});
console.log(`Imported ${stats.imported} new and updated ${stats.updated} videos, ${stats.mentions} comments recorded.`);
console.log(`Skipped: ${JSON.stringify(stats.skipped)}`);
for (const l of stats.lists) console.log(`  list "${l.title}": ${l.items} videos`);
// Flush to disk and let Node exit: an open PGlite keeps the process alive indefinitely.
await db.close();
process.exit(0);
