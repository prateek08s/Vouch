import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ClaudeCodeClassifier, type CliRunner } from "./claude-code";
import { ClassifierFatal, ClassifierRefusal, ClassifierTruncated, classifyAll, type Candidate } from "./classify";

const TOPICS = [
  { slug: "ai", name: "AI", parent: "Technology" },
  { slug: "gpu", name: "GPU", parent: "Hardware" },
];
const batch: Candidate[] = [{ commentId: 7, author: "pg", postedAt: "2025-01-01T00:00:00Z", text: "Great: https://youtu.be/aircAruvnKk", videoIds: ["aircAruvnKk"] }];
const answer = { results: [{ comment_id: 7, videos: [{ video_id: "aircAruvnKk", recommends: true, excerpt: "Great", topics: ["ai"] }] }] };

function fake(reply: (args: string[], stdin: string) => unknown) {
  const calls: { args: string[]; stdin: string }[] = [];
  const run: CliRunner = async (args, stdin) => {
    calls.push({ args, stdin });
    const r = reply(args, stdin);
    return typeof r === "string" ? r : JSON.stringify(r);
  };
  return { run, calls };
}

const ok = (over: object = {}) => ({
  type: "result", subtype: "success", is_error: false, stop_reason: "end_turn",
  result: JSON.stringify(answer), structured_output: answer,
  usage: { input_tokens: 10, cache_creation_input_tokens: 4000, cache_read_input_tokens: 500, output_tokens: 120 },
  ...over,
});

describe("ClaudeCodeClassifier", () => {
  it("calls claude -p with Haiku, no tools, the system prompt file and the verdict schema", async () => {
    const f = fake(() => ok());
    const c = new ClaudeCodeClassifier(TOPICS, f.run);
    await c.classify(batch);
    const { args, stdin } = f.calls[0];
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(args[0]).toBe("-p");
    expect(flag("--model")).toBe("haiku");
    expect(flag("--output-format")).toBe("json");
    expect(flag("--tools")).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(await readFile(flag("--system-prompt-file"), "utf8")).toContain("- gpu: GPU (under Hardware)");
    const schema = JSON.parse(flag("--json-schema"));
    expect(JSON.stringify(schema)).toContain('"enum":["ai","gpu"]');
    // The CLI rejects schemas that name the draft 2020-12 meta-schema.
    expect(schema).not.toHaveProperty("$schema");
    expect(stdin).toContain('"comment_id": 7');
    await c.dispose();
  });

  it("returns the structured answer and counts cached input as input", async () => {
    const c = new ClaudeCodeClassifier(TOPICS, fake(() => ok()).run);
    expect(await c.classify(batch)).toEqual({ raw: answer, usage: { inputTokens: 4510, outputTokens: 120 } });
  });

  it("falls back to the result text when structured_output is missing", async () => {
    const c = new ClaudeCodeClassifier(TOPICS, fake(() => ok({ structured_output: undefined })).run);
    expect((await c.classify(batch)).raw).toEqual(answer);
  });

  it("rejects answers that do not match the schema, such as an unknown topic", async () => {
    const bad = { results: [{ comment_id: 7, videos: [{ video_id: "aircAruvnKk", recommends: true, excerpt: null, topics: ["cooking"] }] }] };
    const c = new ClaudeCodeClassifier(TOPICS, fake(() => ok({ structured_output: bad, result: JSON.stringify(bad) })).run);
    await expect(c.classify(batch)).rejects.toBeInstanceOf(ClassifierTruncated);
  });

  it("surfaces CLI errors such as hitting a usage limit", async () => {
    const c = new ClaudeCodeClassifier(TOPICS, fake(() => ok({ is_error: true, subtype: "error_during_execution", result: "Usage limit reached" })).run);
    await expect(c.classify(batch)).rejects.toThrow(/Usage limit reached/);
  });

  it("reports refusals as refusals", async () => {
    const c = new ClaudeCodeClassifier(TOPICS, fake(() => ok({ stop_reason: "refusal" })).run);
    await expect(c.classify(batch)).rejects.toBeInstanceOf(ClassifierRefusal);
  });

  it("stops the whole run on a setup error instead of retrying every comment", async () => {
    const calls: number[] = [];
    const run: CliRunner = async () => {
      calls.push(1);
      throw new ClassifierFatal("claude CLI failed: --json-schema is not a valid JSON Schema");
    };
    const c = new ClaudeCodeClassifier(TOPICS, run);
    const many = Array.from({ length: 20 }, (_, i) => ({ ...batch[0], commentId: i + 1 }));
    await expect(classifyAll(many, c, new Set(["ai", "gpu"]), { batchSize: 10, concurrency: 1, onVerdicts: () => {} })).rejects.toBeInstanceOf(ClassifierFatal);
    expect(calls).toHaveLength(1);
  });

  it("explains output that is not JSON at all", async () => {
    const c = new ClaudeCodeClassifier(TOPICS, fake(() => "Please log in").run);
    await expect(c.classify(batch)).rejects.toThrow(/not a result: Please log in/);
  });
});
