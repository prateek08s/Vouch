// Step 2 of the Hacker News import: classify candidate comments with Claude.
//
//   npx tsx scripts/hn/classify.mts --months 2025-01 --dry-run   # counts and cost estimate, no calls
//   npx tsx scripts/hn/classify.mts --months 2025-01              # uses Claude Code (no API key needed)
//   npx tsx scripts/hn/classify.mts --year 2025 --limit 200       # first 200 new candidates only
//   npx tsx scripts/hn/classify.mts --months 2025-01 --via api    # Claude API, needs ANTHROPIC_API_KEY
//
// --via claude-code (the default without an API key) runs `claude -p` with Haiku on your Claude Code
// login: on a subscription that uses plan limits instead of money.
//
// Reads .data/hn/candidates/YYYY-MM.jsonl and appends to .data/hn/verdicts/YYYY-MM.jsonl.
// Comments that already have a verdict are skipped, so re-running only pays for what is missing.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { openPglite } from "@/lib/db";
import {
  ClaudeClassifier,
  classifyAll,
  costUsd,
  PRICE_PER_MTOK,
  systemPrompt,
  toCandidate,
  userPrompt,
  type Candidate,
  type CommentVerdict,
  type RawComment,
  type TopicForPrompt,
} from "@/lib/hn/classify";
import { ClaudeCodeClassifier } from "@/lib/hn/claude-code";

const { values: args } = parseArgs({
  options: {
    months: { type: "string" },
    year: { type: "string" },
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    via: { type: "string" },
    // Claude Code model alias: haiku (default, lightest on plan limits) or sonnet (better judgement).
    model: { type: "string", default: "haiku" },
    // Bigger batches mean fewer CLI starts; each `claude -p` process has a few seconds of overhead.
    batch: { type: "string", default: "20" },
    concurrency: { type: "string", default: "3" },
    "data-dir": { type: "string", default: path.join(".data", "hn") },
  },
});

const months = args.months?.split(",").map((m) => m.trim()) ??
  (args.year ? Array.from({ length: 12 }, (_, i) => `${args.year}-${String(i + 1).padStart(2, "0")}`) : null);
if (!months?.length || months.some((m) => !/^\d{4}-\d{2}$/.test(m))) {
  console.error("Pass --months YYYY-MM[,YYYY-MM...] or --year YYYY");
  process.exit(2);
}
const dataDir = args["data-dir"]!;
const limit = args.limit ? Number(args.limit) : Infinity;

async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

// Topics come from the migrations, so the prompt always matches the database.
const db = await openPglite();
const topics = await db.query<TopicForPrompt>(
  `select t.slug, t.name, p.name as parent from topics t left join topics p on p.id = t.parent_topic_id order by t.id`,
);
const topicSlugs = new Set(topics.map((t) => t.slug));
await db.close();

const work: { month: string; candidates: Candidate[] }[] = [];
let budget = limit;
let skippedNoVideo = 0;
let alreadyDone = 0;
for (const month of months) {
  const raw = await readJsonl<RawComment>(path.join(dataDir, "candidates", `${month}.jsonl`));
  if (!raw.length) {
    console.warn(`${month}: no candidates file, run scripts/hn/extract_candidates.py first`);
    continue;
  }
  const done = new Set((await readJsonl<CommentVerdict>(path.join(dataDir, "verdicts", `${month}.jsonl`))).map((v) => v.commentId));
  const candidates: Candidate[] = [];
  for (const r of raw) {
    if (budget <= 0) break;
    if (done.has(r.id)) { alreadyDone++; continue; }
    const c = toCandidate(r);
    if (!c) { skippedNoVideo++; continue; }
    candidates.push(c);
    budget--;
  }
  work.push({ month, candidates });
}

const all = work.flatMap((w) => w.candidates);
const videos = new Set(all.flatMap((c) => c.videoIds));
// Rough estimate: ~4 characters per token, the system prompt once per batch, ~45 output tokens per video.
const batchSize = Number(args.batch);
const batches = Math.ceil(all.length / batchSize);
const estIn = Math.round((all.reduce((s, c) => s + userPrompt([c]).length, 0) + batches * systemPrompt(topics).length) / 4);
const estOut = all.reduce((s, c) => s + c.videoIds.length, 0) * 45 + batches * 30;
console.log(
  `${all.length} comments to classify (${videos.size} distinct videos) in ${batches} requests; ` +
    `${alreadyDone} already done, ${skippedNoVideo} skipped (no video link).`,
);
console.log(
  `Estimated ${(estIn / 1e6).toFixed(2)}M input + ${(estOut / 1e6).toFixed(2)}M output tokens, about $${costUsd({ inputTokens: estIn, outputTokens: estOut }).toFixed(2)} ` +
    `at $${PRICE_PER_MTOK.input}/$${PRICE_PER_MTOK.output} per million (thinking tokens not included).`,
);
if (args["dry-run"] || !all.length) process.exit(0);

const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const via = args.via ?? (hasKey ? "api" : "claude-code");
if (via !== "api" && via !== "claude-code") {
  console.error("--via must be api or claude-code");
  process.exit(2);
}
if (via === "api" && !hasKey) {
  console.error("--via api needs ANTHROPIC_API_KEY. Without one, leave out --via to use Claude Code.");
  process.exit(2);
}
console.log(via === "api" ? "Using the Claude API (billed per token)." : `Using Claude Code (claude -p, ${args.model}). This counts against your plan's usage limits.`);
const classifier = via === "api" ? new ClaudeClassifier(new Anthropic(), topics) : new ClaudeCodeClassifier(topics, undefined, args.model);
await mkdir(path.join(dataDir, "verdicts"), { recursive: true });
let totalIn = 0, totalOut = 0, saved = 0;
for (const { month, candidates } of work) {
  if (!candidates.length) continue;
  const out = path.join(dataDir, "verdicts", `${month}.jsonl`);
  const started = Date.now();
  let monthSaved = 0;
  let lastReport = 0;
  const stats = await classifyAll(candidates, classifier, topicSlugs, {
    batchSize,
    concurrency: Number(args.concurrency),
    onVerdicts: async (v) => {
      if (!v.length) return;
      await appendFile(out, v.map((x) => JSON.stringify(x)).join("\n") + "\n");
      saved += v.length;
      monthSaved += v.length;
      if (monthSaved - lastReport >= 200) {
        lastReport = monthSaved;
        console.log(`  ${month}: ${monthSaved}/${candidates.length} after ${((Date.now() - started) / 1000).toFixed(0)}s`);
      }
    },
    // Failed calls show up immediately, so a stall is visible while it happens.
    onProblem: (p) => {
      if (p.includes("failed")) console.log(`  ${month}: ${p}`);
    },
  });
  totalIn += stats.inputTokens;
  totalOut += stats.outputTokens;
  const recs = (await readJsonl<CommentVerdict>(out)).flatMap((v) => v.videos).filter((v) => v.recommends);
  console.log(
    `${month}: ${stats.verdicts}/${candidates.length} classified in ${((Date.now() - started) / 1000).toFixed(0)}s, ` +
      `${stats.failedBatches} failed batches, ${stats.problems.length} problems; ${recs.length} recommendations so far this month.`,
  );
  for (const p of stats.problems.slice(0, 15)) console.log(`  - ${p}`);
  if (stats.problems.length > 15) console.log(`  ... and ${stats.problems.length - 15} more`);
}
if (classifier instanceof ClaudeCodeClassifier) await classifier.dispose();
console.log(
  `Saved ${saved} verdicts. ${totalIn} input and ${totalOut} output tokens` +
    (via === "api" ? `, cost $${costUsd({ inputTokens: totalIn, outputTokens: totalOut }).toFixed(3)}.` : " (on your Claude Code plan, not billed per token)."),
);
