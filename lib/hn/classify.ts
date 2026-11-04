import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { extractYouTubeLinks, hnHtmlToText, isVerbatimExcerpt } from "./text";

/**
 * Step 2 of the Hacker News import: decide which YouTube links in a comment are real
 * recommendations, quote the commenter's reason, and tag Vouch topics.
 *
 * The model's answer is treated as untrusted input. validateVerdicts() keeps an excerpt
 * only if it appears word for word in the comment, keeps only known topics, and ignores
 * video IDs the comment does not contain.
 */

export const HN_MODEL = "claude-haiku-5-5";
/** Haiku 5.5 list prices, USD per million tokens (prompts under 100K tokens). */
export const PRICE_PER_MTOK = { input: 0.1, output: 0.5 };
export const EXCERPT_MAX = 240;
export const MAX_TOPICS_PER_VIDEO = 3;
export const MAX_VIDEOS_PER_COMMENT = 8;

/** One line of .data/hn/candidates/*.jsonl, as written by scripts/hn/extract_candidates.py. */
export type RawComment = { id: number; by: string; time: string; parent: number; text: string };

export type Candidate = { commentId: number; author: string; postedAt: string; text: string; videoIds: string[] };

export type VideoVerdict = { videoId: string; recommends: boolean; excerpt: string | null; topics: string[] };
export type CommentVerdict = { commentId: number; author: string; postedAt: string; videos: VideoVerdict[] };

export type TopicForPrompt = { slug: string; name: string; parent: string | null };

/** Null when the comment links no real YouTube video, so it never costs a model call. */
export function toCandidate(raw: RawComment): Candidate | null {
  const text = hnHtmlToText(raw.text);
  const links = extractYouTubeLinks(text, { isHtml: false }).slice(0, MAX_VIDEOS_PER_COMMENT);
  if (!links.length) return null;
  return { commentId: raw.id, author: raw.by, postedAt: raw.time, text, videoIds: links.map((l) => l.videoId) };
}

export function verdictSchema(topicSlugs: string[]) {
  return z.object({
    results: z.array(
      z.object({
        comment_id: z.number().int(),
        videos: z.array(
          z.object({
            video_id: z.string(),
            recommends: z.boolean(),
            excerpt: z.string().nullable(),
            topics: z.array(z.enum(topicSlugs as [string, ...string[]])),
          }),
        ),
      }),
    ),
  });
}
export type RawVerdicts = z.infer<ReturnType<typeof verdictSchema>>;

export function systemPrompt(topics: TopicForPrompt[]): string {
  const list = topics.map((t) => `- ${t.slug}: ${t.name}${t.parent ? ` (under ${t.parent})` : ""}`).join("\n");
  return `You review Hacker News comments for Vouch, a site where people recommend YouTube videos worth watching. Each recommendation shows the recommender's own words, so accuracy matters more than coverage.

For every comment you receive, and for every video ID listed with it, decide:

recommends: true only if the commenter is pointing readers to that video because it is worth watching: it explains something well, is a great talk, lecture or documentary, or is the best source on the topic. Use false when the video is mentioned as evidence of something bad, as a joke or meme, as a news clip or a single quote, as background music, as an example of a problem, as the commenter's own video or channel, or without any sign that the commenter values it. When unsure, use false.

excerpt: when recommends is true, copy the commenter's words that best say why the video is worth watching, exactly as written, up to ${EXCERPT_MAX} characters. Copy a continuous span of the comment: do not rephrase, fix typos, join separate sentences, or add words. Leave out URLs. Use null if the comment gives no reason in words, or when recommends is false.

topics: when recommends is true, up to ${MAX_TOPICS_PER_VIDEO} topic slugs from the list below that describe the video, most specific first (for example "gpu" rather than "hardware"). Use an empty list if no topic fits, for example for music, sport, comedy or politics. Use an empty list when recommends is false.

Topics:
${list}

Return one result per comment, with one entry per listed video ID, using the IDs exactly as given.`;
}

export function userPrompt(batch: Candidate[]): string {
  const items = batch.map((c) => ({ comment_id: c.commentId, video_ids: c.videoIds, text: c.text }));
  return `Comments:\n${JSON.stringify(items, null, 1)}`;
}

function cleanExcerpt(e: string | null): string | null {
  if (!e) return null;
  // Models often wrap quotes in quotation marks; the comment itself does not contain them.
  const t = e.trim().replace(/^["“']+|["”']+$/g, "").trim();
  return t || null;
}

/**
 * Turns the model's answer into verdicts we can trust. Comments the model skipped are left out
 * (and reported), so a later run retries them instead of recording them as "not a recommendation".
 */
export function validateVerdicts(
  batch: Candidate[],
  raw: RawVerdicts,
  topicSlugs: ReadonlySet<string>,
): { verdicts: CommentVerdict[]; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map<number, RawVerdicts["results"][number]>();
  for (const r of raw.results) if (!byId.has(r.comment_id)) byId.set(r.comment_id, r);

  const verdicts: CommentVerdict[] = [];
  for (const c of batch) {
    const r = byId.get(c.commentId);
    if (!r) {
      problems.push(`${c.commentId}: no answer`);
      continue;
    }
    const answered = new Map(r.videos.map((v) => [v.video_id, v]));
    const videos: VideoVerdict[] = [];
    for (const videoId of c.videoIds) {
      const v = answered.get(videoId);
      if (!v) {
        problems.push(`${c.commentId}/${videoId}: no answer`);
        continue;
      }
      if (!v.recommends) {
        videos.push({ videoId, recommends: false, excerpt: null, topics: [] });
        continue;
      }
      let excerpt = cleanExcerpt(v.excerpt);
      if (excerpt && (excerpt.length > EXCERPT_MAX || /https?:\/\/|youtu\.?be/i.test(excerpt))) {
        problems.push(`${c.commentId}/${videoId}: excerpt too long or contains a link`);
        excerpt = null;
      }
      if (excerpt && !isVerbatimExcerpt(excerpt, c.text)) {
        problems.push(`${c.commentId}/${videoId}: excerpt is not a verbatim quote`);
        excerpt = null;
      }
      const topics = [...new Set(v.topics)].filter((t) => topicSlugs.has(t)).slice(0, MAX_TOPICS_PER_VIDEO);
      videos.push({ videoId, recommends: true, excerpt, topics });
    }
    for (const id of answered.keys()) {
      if (!c.videoIds.includes(id)) problems.push(`${c.commentId}/${id}: video not in comment, ignored`);
    }
    // Partial answers are retried later rather than saved incomplete.
    if (videos.length === c.videoIds.length) {
      verdicts.push({ commentId: c.commentId, author: c.author, postedAt: c.postedAt, videos });
    }
  }
  return { verdicts, problems };
}

export type Usage = { inputTokens: number; outputTokens: number };

export interface Classifier {
  classify(batch: Candidate[]): Promise<{ raw: RawVerdicts; usage: Usage }>;
}

export class ClassifierRefusal extends Error {}
export class ClassifierTruncated extends Error {}
/** A setup problem (bad flags, not signed in) that will fail every batch: stop instead of retrying. */
export class ClassifierFatal extends Error {}

export class ClaudeClassifier implements Classifier {
  private readonly system: string;
  private readonly format: ReturnType<typeof zodOutputFormat<ReturnType<typeof verdictSchema>>>;

  constructor(
    private readonly client: Anthropic,
    topics: TopicForPrompt[],
    private readonly model = HN_MODEL,
  ) {
    this.system = systemPrompt(topics);
    this.format = zodOutputFormat(verdictSchema(topics.map((t) => t.slug)));
  }

  async classify(batch: Candidate[]) {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      // Classification: low effort is enough and keeps cost down.
      output_config: { effort: "low", format: this.format },
      system: this.system,
      messages: [{ role: "user", content: userPrompt(batch) }],
    });
    if (response.stop_reason === "refusal") throw new ClassifierRefusal(response.stop_details?.category ?? "refusal");
    if (response.stop_reason === "max_tokens") throw new ClassifierTruncated("answer cut off");
    if (!response.parsed_output) throw new ClassifierTruncated("answer did not match the schema");
    return {
      raw: response.parsed_output,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}

export function costUsd(u: Usage): number {
  return (u.inputTokens * PRICE_PER_MTOK.input + u.outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
}

export type RunStats = Usage & { batches: number; failedBatches: number; verdicts: number; problems: string[] };

/**
 * Classifies candidates in batches with bounded concurrency. A failed batch is split in half and
 * each half retried, down to single comments, so one bad comment cannot sink its neighbours and a
 * batch of 20 costs at most a few extra calls rather than 20. Whatever still fails is reported
 * (as it happens, through onProblem) and left for the next run.
 */
export async function classifyAll(
  candidates: Candidate[],
  classifier: Classifier,
  topicSlugs: ReadonlySet<string>,
  opts: {
    batchSize?: number;
    concurrency?: number;
    onVerdicts: (v: CommentVerdict[]) => Promise<void> | void;
    onProblem?: (p: string) => void;
  },
): Promise<RunStats> {
  const batchSize = opts.batchSize ?? 12;
  const concurrency = opts.concurrency ?? 4;
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += batchSize) batches.push(candidates.slice(i, i + batchSize));

  const stats: RunStats = { inputTokens: 0, outputTokens: 0, batches: 0, failedBatches: 0, verdicts: 0, problems: [] };
  const problem = (p: string) => {
    stats.problems.push(p);
    opts.onProblem?.(p);
  };

  async function run(batch: Candidate[]): Promise<boolean> {
    try {
      const { raw, usage } = await classifier.classify(batch);
      stats.inputTokens += usage.inputTokens;
      stats.outputTokens += usage.outputTokens;
      const { verdicts, problems } = validateVerdicts(batch, raw, topicSlugs);
      problems.forEach(problem);
      stats.verdicts += verdicts.length;
      await opts.onVerdicts(verdicts);
      return true;
    } catch (err) {
      // Authentication and permission errors will fail every batch: stop instead of retrying.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof ClassifierFatal) throw err;
      // Keep the reason short: CLI errors can echo the whole command line.
      const why = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
      problem(`batch of ${batch.length} (comments ${batch[0].commentId}..${batch.at(-1)!.commentId}) failed: ${why}`);
      return false;
    }
  }

  /** Halves until it works or a single comment fails on its own. */
  async function runSplitting(batch: Candidate[]): Promise<void> {
    if (await run(batch)) return;
    if (batch.length === 1) return;
    const mid = Math.ceil(batch.length / 2);
    await runSplitting(batch.slice(0, mid));
    await runSplitting(batch.slice(mid));
  }

  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      stats.batches++;
      if (await run(batch)) continue;
      stats.failedBatches++;
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await runSplitting(batch.slice(0, mid));
        await runSplitting(batch.slice(mid));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return stats;
}
