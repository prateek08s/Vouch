// Steps 3 and 4 of the Hacker News import: aggregate verdicts and write them into Vouch.
//
//   npx tsx --env-file=.env.local scripts/hn/import.mts --year 2025
//   npx tsx --env-file=.env.local scripts/hn/import.mts --all        # every year with verdicts
//   npx tsx --env-file=.env.local scripts/hn/import.mts --months 2025-01 --dry-run
//
// Reads verdicts from .data/hn/verdicts/ (your own classify runs) or, failing that, the committed
// data/hn/verdicts/, and writes to the same database as `npm run dev`:
// Postgres when DATABASE_URL is set (run scripts/migrate.mts against it first), otherwise the
// local PGlite directory (VOUCH_DATA_DIR, default .data/pglite). For PGlite, stop the dev
// server first: it allows one process.
// YOUTUBE_API_KEY (in .env.local) gives video lengths; without it, oEmbed is used.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { openPglite, type Db } from "@/lib/db";
import { postgresDb } from "@/lib/db/postgres";
import { aggregate, planLists, type TopicInfo } from "@/lib/hn/aggregate";
import type { CommentVerdict } from "@/lib/hn/classify";
import { importHn } from "@/lib/hn/import";
import { monthEnded } from "@/lib/hn/months";
import { defaultMetadataProvider } from "@/lib/youtube/metadata";

const { values: args } = parseArgs({
  options: {
    months: { type: "string" },
    year: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    concurrency: { type: "string", default: "6" },
    "data-dir": { type: "string" },
    all: { type: "boolean", default: false },
  },
});

// Where a month's verdicts live: an explicit --data-dir, else local runs, else the committed copy.
const verdictFile = (m: string) =>
  [args["data-dir"], path.join(".data", "hn"), path.join("data", "hn")]
    .filter((d): d is string => Boolean(d))
    .map((d) => path.join(d, "verdicts", `${m}.jsonl`))
    .find((f) => existsSync(f));

const verdictDirs = [args["data-dir"], path.join(".data", "hn"), path.join("data", "hn")]
  .filter((d): d is string => Boolean(d))
  .map((d) => path.join(d, "verdicts"))
  .filter((d) => existsSync(d));
const yearsWithVerdicts = [...new Set(verdictDirs.flatMap((d) =>
  readdirSync(d).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 4))))].sort();

const asked = (args.all ? yearsWithVerdicts.join(",") || null : null)?.split(",").map((y) => `${y}-01`) ??
  args.months?.split(",").map((m) => m.trim()) ??
  args.year?.split(",").flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y.trim()}-${String(i + 1).padStart(2, "0")}`)) ??
  null;
if (!asked?.length || asked.some((m) => !/^\d{4}-\d{2}$/.test(m))) {
  console.error("Pass --all, --year YYYY[,YYYY...] or --months YYYY-MM[,YYYY-MM...]");
  process.exit(2);
}
// The Hacker News lists are rebuilt from what is imported, so importing one month alone would
// replace a full year's lists with that month. Always import whole years: re-importing a month
// that is already in is cheap (fresh metadata is skipped) and keeps the lists complete.
const years = [...new Set(asked.map((m) => m.slice(0, 4)))].sort();
const months = years.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`));
// A month still in progress may have no verdicts yet; only finished months must be complete.
const missing = months.filter((m) => !verdictFile(m) && monthEnded(m, new Date()));
if (missing.length) {
  console.error(`No verdicts for ${missing.join(", ")}. Run scripts/hn/classify.mts for them first; nothing was imported.`);
  process.exit(1);
}

const verdicts: CommentVerdict[] = [];
for (const m of months) {
  const file = verdictFile(m);
  if (!file) continue; // a month still in the future
  for (const line of (await readFile(file, "utf8")).split("\n")) if (line) verdicts.push(JSON.parse(line));
}
if (!verdicts.length) {
  console.error(`No verdicts found for ${years.join(", ")}; nothing was imported.`);
  process.exit(1);
}
const period = years.length === 1 ? years[0] : `${years[0]} to ${years.at(-1)}`;

const aggs = aggregate(verdicts);
const recs = verdicts.flatMap((v) => v.videos).filter((v) => v.recommends);
console.log(
  `${verdicts.length} comments, ${recs.length} recommendations of ${aggs.length} videos; ` +
    `${aggs.filter((a) => a.topics.length).length} have a Vouch topic, ${aggs.filter((a) => a.recommenders > 1).length} were recommended by 2+ people.`,
);

const dir = process.env.VOUCH_DATA_DIR ?? path.join(".data", "pglite");
const usePostgres = Boolean(process.env.DATABASE_URL) && !args["dry-run"];
async function openTarget(): Promise<Db & { close(): Promise<void> }> {
  if (usePostgres) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(args.concurrency) + 1 });
    return Object.assign(postgresDb(pool), { close: () => pool.end() });
  }
  if (args["dry-run"]) return openPglite();
  await mkdir(path.dirname(dir), { recursive: true });
  return openPglite(dir);
}
const db = await openTarget();
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

console.log(`Importing into ${usePostgres ? "Postgres (DATABASE_URL)" : dir} (${process.env.YOUTUBE_API_KEY ? "YouTube Data API" : "oEmbed, no video lengths"})...`);
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
// Flush and let Node exit: an open PGlite or pool keeps the process alive indefinitely.
await db.close();
process.exit(0);
