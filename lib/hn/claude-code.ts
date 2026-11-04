import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  ClassifierFatal,
  ClassifierRefusal,
  ClassifierTruncated,
  systemPrompt,
  userPrompt,
  verdictSchema,
  type Candidate,
  type Classifier,
  type RawVerdicts,
  type TopicForPrompt,
  type Usage,
} from "./classify";

/**
 * Runs the same classification through the Claude Code CLI (`claude -p`) instead of the API.
 * It uses whatever Claude Code is signed in with, so no API key is needed: on a Claude
 * subscription the calls count against the plan's usage limits rather than being billed.
 *
 * Same prompt, same schema, same validation as ClaudeClassifier: only the transport differs.
 */

/** Runs the CLI with arguments and stdin, resolving to its stdout. Injectable for tests. */
export type CliRunner = (args: string[], stdin: string) => Promise<string>;

// A healthy batch of 20 takes about 30 seconds. Calls that hang do so indefinitely, so give up
// after 2 minutes and let the batch be split and retried.
export const defaultCliRunner = (bin = "claude", timeoutMs = 120_000): CliRunner => (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      // The CLI exits non-zero on errors but still prints a JSON result we can explain.
      if (err && !stdout) {
        const why = stderr.trim() || err.message;
        // A timeout may pass on retry. Exiting before any result (bad flags, missing CLI,
        // not signed in) will fail the same way every time.
        reject(err.killed ? new Error(`claude CLI timed out: ${why}`) : new ClassifierFatal(`claude CLI failed: ${why}`));
      } else resolve(stdout);
    });
    child.stdin?.end(stdin);
  });

const CliResult = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  is_error: z.boolean(),
  result: z.string().nullish(),
  stop_reason: z.string().nullish(),
  structured_output: z.unknown().optional(),
  usage: z
    .object({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
      cache_creation_input_tokens: z.number().default(0),
      cache_read_input_tokens: z.number().default(0),
    })
    .partial()
    .optional(),
});

export class ClaudeCodeClassifier implements Classifier {
  private readonly system: string;
  private readonly schema: ReturnType<typeof verdictSchema>;
  private readonly jsonSchema: string;
  private promptFile: Promise<string> | null = null;

  constructor(
    topics: TopicForPrompt[],
    private readonly run: CliRunner = defaultCliRunner(),
    private readonly model = "haiku",
  ) {
    this.system = systemPrompt(topics);
    this.schema = verdictSchema(topics.map((t) => t.slug));
    // The CLI's validator does not load the draft 2020-12 meta-schema that Zod names in "$schema".
    // The schema itself uses only basic keywords, so dropping the label is enough.
    const { $schema: _draft, ...schema } = z.toJSONSchema(this.schema);
    void _draft;
    this.jsonSchema = JSON.stringify(schema);
  }

  /** The system prompt goes through a file: Windows limits command lines to ~32K characters. */
  private systemPromptFile(): Promise<string> {
    this.promptFile ??= (async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "vouch-hn-"));
      const file = path.join(dir, "system-prompt.txt");
      await writeFile(file, this.system, "utf8");
      return file;
    })();
    return this.promptFile;
  }

  async dispose() {
    if (this.promptFile) await rm(path.dirname(await this.promptFile), { recursive: true, force: true });
  }

  async classify(batch: Candidate[]): Promise<{ raw: RawVerdicts; usage: Usage }> {
    const args = [
      "-p",
      "--model", this.model,
      "--output-format", "json",
      "--no-session-persistence",
      // A pure text task: no tools, no files, nothing to approve.
      "--tools", "",
      "--system-prompt-file", await this.systemPromptFile(),
      "--json-schema", this.jsonSchema,
    ];
    const stdout = await this.run(args, userPrompt(batch));

    let parsed: z.infer<typeof CliResult>;
    try {
      parsed = CliResult.parse(JSON.parse(stdout));
    } catch {
      throw new Error(`claude CLI returned something that is not a result: ${stdout.slice(0, 200)}`);
    }
    if (parsed.stop_reason === "refusal") throw new ClassifierRefusal("refusal");
    if (parsed.is_error) throw new Error(`claude CLI error (${parsed.subtype ?? "unknown"}): ${(parsed.result ?? "").slice(0, 300)}`);
    const out = this.schema.safeParse(parsed.structured_output ?? safeJson(parsed.result));
    if (!out.success) throw new ClassifierTruncated("answer did not match the schema");

    const u = parsed.usage ?? {};
    return {
      raw: out.data,
      usage: {
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      },
    };
  }
}

function safeJson(s: string | null | undefined): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
