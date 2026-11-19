// Classify Hacker News candidates without an API key: a Claude session (for example a scheduled
// task) reads the prepared batches, answers them itself, and this script validates and saves them.
//
//   npx tsx scripts/hn/session-classify.mts prepare --data-dir data/hn --work .data/hn/session --limit 1000
//   ... answer every batch-NNN.json as answer-NNN.json (format in INSTRUCTIONS.md) ...
//   npx tsx scripts/hn/session-classify.mts apply --data-dir data/hn --work .data/hn/session
//
// prepare: every candidates/YYYY-MM.jsonl month, oldest first, comments without a verdict yet,
// up to --limit, in batches of --batch. Writes INSTRUCTIONS.md (the same rules the API classifier
// gets) and batch-NNN.json files.
// apply: checks each answer against the schema and its batch (IDs, verbatim quotes, known topics)
// with the same validation as the API path, then appends verdicts to verdicts/YYYY-MM.jsonl.
// Comments without a valid answer stay pending for the next run.
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { openPglite } from "@/lib/db";
import {
  systemPrompt,
  toCandidate,
  validateVerdicts,
  verdictSchema,
  type Candidate,
  type CommentVerdict,
  type RawComment,
  type TopicForPrompt,
} from "@/lib/hn/classify";

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    "data-dir": { type: "string", default: path.join("data", "hn") },
    work: { type: "string", default: path.join(".data", "hn", "session") },
    limit: { type: "string", default: "1000" },
    batch: { type: "string", default: "40" },
  },
});
const mode = positionals[0];
if (mode !== "prepare" && mode !== "apply") {
  console.error("Usage: session-classify.mts prepare|apply [--data-dir data/hn] [--work dir] [--limit N] [--batch N]");
  process.exit(2);
}
const dataDir = args["data-dir"]!;
const work = args.work!;

async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

const db = await openPglite();
const topics = await db.query<TopicForPrompt>(
  `select t.slug, t.name, p.name as parent from topics t left join topics p on p.id = t.parent_topic_id order by t.id`,
);
await db.close();
const topicSlugs = new Set(topics.map((t) => t.slug));

type BatchFile = { batch: number; month: string; candidates: Candidate[] };

if (mode === "prepare") {
  const candDir = path.join(dataDir, "candidates");
  const months = existsSync(candDir)
    ? (await readdir(candDir)).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 7)).sort()
    : [];
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const size = Number(args.batch);
  let budget = Number(args.limit);
  let n = 0;
  let pending = 0;
  const perMonth: Record<string, number> = {};
  for (const month of months) {
    const done = new Set((await readJsonl<CommentVerdict>(path.join(dataDir, "verdicts", `${month}.jsonl`))).map((v) => v.commentId));
    const todo: Candidate[] = [];
    for (const raw of await readJsonl<RawComment>(path.join(candDir, `${month}.jsonl`))) {
      if (done.has(raw.id)) continue;
      const c = toCandidate(raw);
      if (!c) continue;
      pending++;
      if (budget > 0) { todo.push(c); budget--; }
    }
    if (todo.length) perMonth[month] = todo.length;
    for (let i = 0; i < todo.length; i += size) {
      n++;
      const file: BatchFile = { batch: n, month, candidates: todo.slice(i, i + size) };
      await writeFile(path.join(work, `batch-${String(n).padStart(3, "0")}.json`), JSON.stringify(file, null, 1));
    }
  }
  await writeFile(path.join(work, "INSTRUCTIONS.md"), `${systemPrompt(topics)}

## How to answer

Each batch-NNN.json holds a month and a list of candidates (comment_id = candidates[i].commentId,
video ids = candidates[i].videoIds, text = candidates[i].text). For each batch-NNN.json, write
answer-NNN.json in the same folder, containing exactly this JSON shape and nothing else:

{"results":[{"comment_id":123,"videos":[{"video_id":"abc123def45","recommends":true,"excerpt":"exact words","topics":["gpu"]}]}]}

One result per candidate, one video entry per listed video id. Excerpts must be copied character for
character from that comment's text; anything else is discarded. Topic slugs must come from the list above.
`);
  const queued = Object.values(perMonth).reduce((a, b) => a + b, 0);
  console.log(`${pending} comments pending; queued ${queued} in ${n} batches of up to ${size} in ${work}.`);
  for (const [m, c] of Object.entries(perMonth)) console.log(`  ${m}: ${c}`);
  console.log(`${pending - queued} left for a later run.`);
} else {
  const schema = verdictSchema([...topicSlugs]);
  const files = existsSync(work) ? (await readdir(work)).filter((f) => /^batch-\d+\.json$/.test(f)).sort() : [];
  let saved = 0, missing = 0, invalid = 0;
  const problems: string[] = [];
  for (const f of files) {
    const b = JSON.parse(await readFile(path.join(work, f), "utf8")) as BatchFile;
    const answerFile = path.join(work, f.replace("batch-", "answer-"));
    if (!existsSync(answerFile)) { missing++; continue; }
    let raw: unknown;
    try {
      raw = JSON.parse((await readFile(answerFile, "utf8")).trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      invalid++; problems.push(`${f}: answer is not JSON`); continue;
    }
    // Unknown topics would fail the whole batch; drop them per video instead, then check the rest.
    if (raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)) {
      for (const r of (raw as { results: { videos?: { topics?: unknown }[] }[] }).results) {
        for (const v of r.videos ?? []) if (Array.isArray(v.topics)) v.topics = v.topics.filter((t) => typeof t === "string" && topicSlugs.has(t));
      }
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) { invalid++; problems.push(`${f}: ${parsed.error.issues[0]?.message ?? "does not match the schema"}`); continue; }
    const { verdicts, problems: p } = validateVerdicts(b.candidates, parsed.data, topicSlugs);
    problems.push(...p.map((x) => `${f}: ${x}`));
    const out = path.join(dataDir, "verdicts", `${b.month}.jsonl`);
    await mkdir(path.dirname(out), { recursive: true });
    // Skip anything already saved, so applying twice is harmless.
    const done = new Set((await readJsonl<CommentVerdict>(out)).map((v) => v.commentId));
    const fresh = verdicts.filter((v) => !done.has(v.commentId));
    if (fresh.length) await appendFile(out, fresh.map((v) => JSON.stringify(v)).join("\n") + "\n");
    saved += fresh.length;
  }
  console.log(`Saved ${saved} verdicts from ${files.length - missing - invalid} answered batches; ${missing} batches unanswered, ${invalid} invalid.`);
  for (const p of problems.slice(0, 25)) console.log(`  - ${p}`);
  if (problems.length > 25) console.log(`  ... and ${problems.length - 25} more`);
}
