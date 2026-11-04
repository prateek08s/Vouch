import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  classifyAll,
  costUsd,
  systemPrompt,
  toCandidate,
  userPrompt,
  validateVerdicts,
  verdictSchema,
  type Candidate,
  type Classifier,
  type RawVerdicts,
} from "./classify";

const TOPICS = new Set(["ai", "llms", "gpu", "hardware", "pure-math"]);

function cand(id: number, videoIds: string[], text = "Watch this, it is the clearest explanation of backprop I know."): Candidate {
  return { commentId: id, author: `user${id}`, postedAt: "2025-01-02T03:04:05Z", text, videoIds };
}

function answer(...results: RawVerdicts["results"]): RawVerdicts {
  return { results };
}

describe("toCandidate", () => {
  it("parses HN html and lists the linked videos", () => {
    const c = toCandidate({
      id: 1, by: "pg", time: "2025-01-01T00:00:00Z", parent: 0,
      text: 'Best intro I know:<p><a href="https:&#x2F;&#x2F;www.youtube.com&#x2F;watch?v=aircAruvnKk">https:&#x2F;&#x2F;www.youtube.com&#x2F;watch?v=aircAruvnKk</a>',
    });
    expect(c).toEqual({
      commentId: 1, author: "pg", postedAt: "2025-01-01T00:00:00Z",
      text: "Best intro I know:\n\nhttps://www.youtube.com/watch?v=aircAruvnKk", videoIds: ["aircAruvnKk"],
    });
  });
  it("skips comments that mention YouTube without linking a video", () => {
    expect(toCandidate({ id: 2, by: "x", time: "2025-01-01T00:00:00Z", parent: 0, text: "youtube is bad now" })).toBeNull();
    expect(toCandidate({ id: 3, by: "x", time: "2025-01-01T00:00:00Z", parent: 0, text: "https://www.youtube.com/@channel" })).toBeNull();
  });
  it("caps the number of videos per comment", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `abcdefghi${String(i).padStart(2, "0")}`);
    const c = toCandidate({ id: 4, by: "x", time: "2025-01-01T00:00:00Z", parent: 0, text: ids.map((i) => `https://youtu.be/${i}`).join(" ") });
    expect(c?.videoIds).toHaveLength(8);
  });
});

describe("prompts", () => {
  it("lists every topic with its parent", () => {
    const p = systemPrompt([{ slug: "hardware", name: "Hardware", parent: "Technology" }, { slug: "gpu", name: "GPU", parent: "Hardware" }]);
    expect(p).toContain("- hardware: Hardware (under Technology)");
    expect(p).toContain("- gpu: GPU (under Hardware)");
  });
  it("sends comment IDs, video IDs and text", () => {
    const parsed = JSON.parse(userPrompt([cand(7, ["aircAruvnKk"])]).replace(/^Comments:\n/, ""));
    expect(parsed).toEqual([{ comment_id: 7, video_ids: ["aircAruvnKk"], text: cand(7, []).text }]);
  });
  it("schema only accepts known topic slugs", () => {
    const schema = verdictSchema([...TOPICS]);
    const ok = { results: [{ comment_id: 1, videos: [{ video_id: "x", recommends: true, excerpt: null, topics: ["gpu"] }] }] };
    expect(schema.safeParse(ok).success).toBe(true);
    const bad = { results: [{ comment_id: 1, videos: [{ video_id: "x", recommends: true, excerpt: null, topics: ["cooking"] }] }] };
    expect(schema.safeParse(bad).success).toBe(false);
  });
});

describe("validateVerdicts", () => {
  const c = cand(1, ["aircAruvnKk"]);
  const rec = (over: Partial<RawVerdicts["results"][number]["videos"][number]> = {}) => ({
    video_id: "aircAruvnKk", recommends: true, excerpt: "the clearest explanation of backprop I know", topics: ["ai"], ...over,
  });

  it("keeps a verbatim excerpt and known topics", () => {
    const { verdicts, problems } = validateVerdicts([c], answer({ comment_id: 1, videos: [rec()] }), TOPICS);
    expect(problems).toEqual([]);
    expect(verdicts).toEqual([{
      commentId: 1, author: "user1", postedAt: c.postedAt,
      videos: [{ videoId: "aircAruvnKk", recommends: true, excerpt: "the clearest explanation of backprop I know", topics: ["ai"] }],
    }]);
  });

  it("drops a paraphrased excerpt but keeps the recommendation", () => {
    const { verdicts, problems } = validateVerdicts([c], answer({ comment_id: 1, videos: [rec({ excerpt: "A very clear explanation of backpropagation." })] }), TOPICS);
    expect(verdicts[0].videos[0]).toMatchObject({ recommends: true, excerpt: null });
    expect(problems).toEqual(["1/aircAruvnKk: excerpt is not a verbatim quote"]);
  });

  it("strips quotation marks the model wrapped around a real quote", () => {
    const { verdicts } = validateVerdicts([c], answer({ comment_id: 1, videos: [rec({ excerpt: "“the clearest explanation of backprop I know”" })] }), TOPICS);
    expect(verdicts[0].videos[0].excerpt).toBe("the clearest explanation of backprop I know");
  });

  it("rejects excerpts that are too long or contain a link", () => {
    const long = cand(2, ["aircAruvnKk"], "x".repeat(300));
    const r1 = validateVerdicts([long], answer({ comment_id: 2, videos: [rec({ excerpt: "x".repeat(300) })] }), TOPICS);
    expect(r1.verdicts[0].videos[0].excerpt).toBeNull();
    const linky = cand(3, ["aircAruvnKk"], "Great talk https://youtu.be/aircAruvnKk");
    const r2 = validateVerdicts([linky], answer({ comment_id: 3, videos: [rec({ excerpt: "Great talk https://youtu.be/aircAruvnKk" })] }), TOPICS);
    expect(r2.verdicts[0].videos[0].excerpt).toBeNull();
  });

  it("filters unknown topics, removes duplicates and keeps at most 3", () => {
    const raw = answer({ comment_id: 1, videos: [rec({ topics: ["gpu", "gpu", "cooking", "ai", "llms", "hardware"] })] });
    expect(validateVerdicts([c], raw, TOPICS).verdicts[0].videos[0].topics).toEqual(["gpu", "ai", "llms"]);
  });

  it("clears excerpt and topics when the video is not recommended", () => {
    const raw = answer({ comment_id: 1, videos: [rec({ recommends: false })] });
    expect(validateVerdicts([c], raw, TOPICS).verdicts[0].videos[0]).toEqual({ videoId: "aircAruvnKk", recommends: false, excerpt: null, topics: [] });
  });

  it("ignores videos that are not in the comment", () => {
    const raw = answer({ comment_id: 1, videos: [rec(), rec({ video_id: "dQw4w9WgXcQ" })] });
    const { verdicts, problems } = validateVerdicts([c], raw, TOPICS);
    expect(verdicts[0].videos.map((v) => v.videoId)).toEqual(["aircAruvnKk"]);
    expect(problems).toContain("1/dQw4w9WgXcQ: video not in comment, ignored");
  });

  it("leaves out comments the model skipped or answered only in part, so they are retried", () => {
    const two = cand(4, ["aircAruvnKk", "VMj-3S1tku0"]);
    const raw = answer({ comment_id: 4, videos: [rec()] });
    const { verdicts, problems } = validateVerdicts([c, two], raw, TOPICS);
    expect(verdicts).toEqual([]);
    expect(problems).toEqual(["1: no answer", "4/VMj-3S1tku0: no answer"]);
  });

  it("ignores answers for comments that were not asked about", () => {
    const raw = answer({ comment_id: 1, videos: [rec()] }, { comment_id: 99, videos: [rec()] });
    expect(validateVerdicts([c], raw, TOPICS).verdicts.map((v) => v.commentId)).toEqual([1]);
  });
});

/** Answers "recommends" for every video; fails any batch containing a comment ID in `failOn`. */
class FakeClassifier implements Classifier {
  calls: number[][] = [];
  inFlight = 0;
  maxInFlight = 0;
  constructor(private failOn = new Set<number>(), private error: () => Error = () => new Error("boom")) {}
  async classify(batch: Candidate[]) {
    this.calls.push(batch.map((c) => c.commentId));
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    this.inFlight--;
    if (batch.some((c) => this.failOn.has(c.commentId))) throw this.error();
    return {
      raw: answer(...batch.map((c) => ({ comment_id: c.commentId, videos: c.videoIds.map((v) => ({ video_id: v, recommends: true, excerpt: null, topics: ["ai"] })) }))),
      usage: { inputTokens: 1000, outputTokens: 100 },
    };
  }
}

describe("classifyAll", () => {
  const many = Array.from({ length: 25 }, (_, i) => cand(i + 1, ["aircAruvnKk"]));

  it("classifies everything in batches and reports usage", async () => {
    const fake = new FakeClassifier();
    const saved: number[] = [];
    const stats = await classifyAll(many, fake, TOPICS, { batchSize: 10, concurrency: 2, onVerdicts: (v) => void saved.push(...v.map((x) => x.commentId)) });
    expect(fake.calls.map((b) => b.length).sort()).toEqual([10, 10, 5]);
    expect(saved.sort((a, b) => a - b)).toEqual(many.map((c) => c.commentId));
    expect(stats).toMatchObject({ batches: 3, failedBatches: 0, verdicts: 25, inputTokens: 3000, outputTokens: 300 });
  });

  it("never runs more batches at once than the concurrency limit", async () => {
    const fake = new FakeClassifier();
    await classifyAll(many, fake, TOPICS, { batchSize: 2, concurrency: 3, onVerdicts: () => {} });
    expect(fake.maxInFlight).toBe(3);
  });

  it("retries a failed batch one comment at a time and saves the rest", async () => {
    const fake = new FakeClassifier(new Set([3]));
    const saved: number[] = [];
    const stats = await classifyAll(many.slice(0, 5), fake, TOPICS, { batchSize: 5, onVerdicts: (v) => void saved.push(...v.map((x) => x.commentId)) });
    expect(saved.sort()).toEqual([1, 2, 4, 5]);
    expect(stats.failedBatches).toBe(1);
    expect(stats.problems.filter((p) => p.includes("failed"))).toHaveLength(2); // the batch, then comment 3 alone
  });

  it("stops at once on an authentication error instead of retrying every batch", async () => {
    const authError = () => new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }, "bad key", new Headers());
    const fake = new FakeClassifier(new Set(many.map((c) => c.commentId)), authError);
    await expect(classifyAll(many, fake, TOPICS, { batchSize: 5, concurrency: 1, onVerdicts: () => {} })).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("costUsd", () => {
  it("uses Haiku 5.5 prices", () => {
    expect(costUsd({ inputTokens: 10_000_000, outputTokens: 1_000_000 })).toBeCloseTo(1.5);
  });
});
