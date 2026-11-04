import { beforeAll, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { applyRules, createRule, exclusionReason, compileRules, listRules, deleteRule, type Rule, type RuleCandidate } from "./index";

const base: RuleCandidate = {
  resourceId: "r1",
  title: "How GPUs Actually Schedule Work",
  creatorId: "UC_chips",
  creatorName: "Chips Explained",
  durationS: 38 * 60,
  isShort: false,
  topicSlugs: ["gpu", "hardware", "technology"],
};
const cand = (over: Partial<RuleCandidate> = {}): RuleCandidate => ({ ...base, ...over });
const why = (c: RuleCandidate, rules: Rule[]) => exclusionReason(c, compileRules(rules));

describe("rules engine", () => {
  it("keeps everything with no rules", () => {
    expect(why(cand(), [])).toBeNull();
  });

  describe("channel", () => {
    it("blocks by channel id, case-insensitively", () => {
      expect(why(cand(), [{ kind: "channel", value: "uc_CHIPS" }])).toEqual({ kind: "channel", value: "UC_chips" });
    });
    it("does not block by name collision", () => {
      expect(why(cand(), [{ kind: "channel", value: "Chips Explained" }])).toBeNull();
    });
    it("ignores resources with no channel id", () => {
      expect(why(cand({ creatorId: null }), [{ kind: "channel", value: "UC_chips" }])).toBeNull();
    });
  });

  describe("topic", () => {
    it("blocks a tagged topic", () => {
      expect(why(cand(), [{ kind: "topic", value: "gpu" }])).toEqual({ kind: "topic", value: "gpu" });
    });
    it("blocks children when a parent is blocked (ancestors are on the candidate)", () => {
      expect(why(cand(), [{ kind: "topic", value: "technology" }])?.kind).toBe("topic");
    });
    it("leaves unrelated topics alone", () => {
      expect(why(cand(), [{ kind: "topic", value: "biology" }])).toBeNull();
    });
  });

  describe("keyword", () => {
    it.each([
      ["gpus", "How GPUs Actually Schedule Work"],
      ["schedule work", "How GPUs Actually Schedule Work"],
      ["crypto", "CRYPTO is back!!"],
      ["reaction", "My reaction: (wow)"],
      ["cafe", "Best Café Tour"],
      ["chips", "anything"], // channel name counts too
    ])("blocks %j in %j", (word, title) => {
      expect(why(cand({ title }), [{ kind: "keyword", value: word }])?.kind).toBe("keyword");
    });

    it.each([
      ["ai", "Rain Gardens Explained"],
      ["ai", "Said the Mountain"],
      ["art", "Starting Rust"],
      ["c", "Catalysts"],
    ])("does not let %j match inside a word of %j", (word, title) => {
      expect(why(cand({ title, creatorName: "X" }), [{ kind: "keyword", value: word }])).toBeNull();
    });

    it("treats regex characters literally", () => {
      expect(why(cand({ title: "Why C++ is hard", creatorName: "X" }), [{ kind: "keyword", value: "c++" }])?.kind).toBe("keyword");
      expect(why(cand({ title: "Cxx is fine", creatorName: "X" }), [{ kind: "keyword", value: "c++" }])).toBeNull();
      expect(() => compileRules([{ kind: "keyword", value: "(((" }])).not.toThrow();
    });

    it("matches whole words next to punctuation and digits", () => {
      expect(why(cand({ title: "AI: the 2026 version", creatorName: "X" }), [{ kind: "keyword", value: "ai" }])?.kind).toBe("keyword");
      expect(why(cand({ title: "Top-AI-picks", creatorName: "X" }), [{ kind: "keyword", value: "ai" }])?.kind).toBe("keyword");
      expect(why(cand({ title: "AI2 lab", creatorName: "X" }), [{ kind: "keyword", value: "ai" }])).toBeNull();
    });
  });

  describe("duration", () => {
    it("blocks too short and too long", () => {
      expect(why(cand({ durationS: 299 }), [{ kind: "min_duration", value: "300" }])).toEqual({ kind: "too_short", value: 300 });
      expect(why(cand({ durationS: 3601 }), [{ kind: "max_duration", value: "3600" }])).toEqual({ kind: "too_long", value: 3600 });
    });
    it("keeps the exact boundaries", () => {
      const rules: Rule[] = [{ kind: "min_duration", value: "300" }, { kind: "max_duration", value: "3600" }];
      expect(why(cand({ durationS: 300 }), rules)).toBeNull();
      expect(why(cand({ durationS: 3600 }), rules)).toBeNull();
    });
    it("excludes unknown durations when a duration rule exists (fail closed)", () => {
      expect(why(cand({ durationS: null }), [{ kind: "max_duration", value: "3600" }])).toEqual({ kind: "unknown_duration" });
    });
    it("keeps unknown durations when there is no duration rule", () => {
      expect(why(cand({ durationS: null }), [{ kind: "keyword", value: "zzz" }])).toBeNull();
    });
    it("uses the strictest value when several exist", () => {
      const rules: Rule[] = [{ kind: "max_duration", value: "3600" }, { kind: "max_duration", value: "1200" }];
      expect(why(cand({ durationS: 1800 }), rules)?.kind).toBe("too_long");
    });
  });

  describe("no shorts", () => {
    it("blocks flagged Shorts and anything 60s or less", () => {
      const rules: Rule[] = [{ kind: "no_shorts", value: "" }];
      expect(why(cand({ isShort: true }), rules)).toEqual({ kind: "short" });
      expect(why(cand({ durationS: 45 }), rules)).toEqual({ kind: "short" });
      expect(why(cand({ durationS: 61 }), rules)).toBeNull();
    });
  });

  it("applyRules partitions without losing or duplicating anything", () => {
    const cs = Array.from({ length: 50 }, (_, i) =>
      cand({ resourceId: `r${i}`, durationS: i * 60, title: i % 7 === 0 ? "crypto news" : "fine", creatorName: "X" }),
    );
    const { kept, removed } = applyRules(cs, [{ kind: "keyword", value: "crypto" }, { kind: "min_duration", value: "600" }]);
    expect(kept.length + removed.length).toBe(50);
    expect(new Set([...kept, ...removed.map((r) => r.candidate)].map((c) => c.resourceId)).size).toBe(50);
    for (const k of kept) {
      expect(k.title).not.toContain("crypto");
      expect(k.durationS!).toBeGreaterThanOrEqual(600);
    }
  });

  it("property: no kept candidate ever violates a rule (randomized)", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const words = ["gpu", "crypto", "rust", "ai", "drama", "physics"];
    const topics = ["gpu", "rust", "ai", "biology", "technology", "science"];
    for (let trial = 0; trial < 300; trial++) {
      const rules: Rule[] = [];
      if (rnd() < 0.5) rules.push({ kind: "keyword", value: words[Math.floor(rnd() * words.length)] });
      if (rnd() < 0.5) rules.push({ kind: "topic", value: topics[Math.floor(rnd() * topics.length)] });
      if (rnd() < 0.4) rules.push({ kind: "max_duration", value: String(Math.floor(rnd() * 3600)) });
      if (rnd() < 0.4) rules.push({ kind: "min_duration", value: String(Math.floor(rnd() * 600)) });
      if (rnd() < 0.3) rules.push({ kind: "no_shorts", value: "" });
      if (rnd() < 0.3) rules.push({ kind: "channel", value: "UC_bad" });

      const c = cand({
        title: words.filter(() => rnd() < 0.3).join(" ") || "plain",
        creatorName: "X",
        creatorId: rnd() < 0.3 ? "UC_bad" : "UC_ok",
        durationS: rnd() < 0.1 ? null : Math.floor(rnd() * 5000),
        isShort: rnd() < 0.1,
        topicSlugs: topics.filter(() => rnd() < 0.3),
      });
      const { kept } = applyRules([c], rules);
      if (!kept.length) continue;
      for (const r of rules) {
        if (r.kind === "keyword") expect(c.title.split(" ")).not.toContain(r.value);
        if (r.kind === "topic") expect(c.topicSlugs).not.toContain(r.value);
        if (r.kind === "channel") expect(c.creatorId).not.toBe(r.value);
        if (r.kind === "max_duration") {
          expect(c.durationS).not.toBeNull();
          expect(c.durationS!).toBeLessThanOrEqual(Number(r.value));
        }
        if (r.kind === "min_duration") {
          expect(c.durationS).not.toBeNull();
          expect(c.durationS!).toBeGreaterThanOrEqual(Number(r.value));
        }
        if (r.kind === "no_shorts") expect(c.isShort || (c.durationS ?? 999) <= 60).toBe(false);
      }
    }
  });
});

describe("rule storage", () => {
  let db: Db;
  beforeAll(async () => {
    db = await openPglite();
  });

  it("stores durations given in minutes as seconds", async () => {
    const u = await fx.user(db);
    const r = await createRule(db, u, "max_duration", "60");
    expect(r).toMatchObject({ ok: true, rule: { kind: "max_duration", value: "3600" } });
  });

  it("replaces an existing max instead of stacking", async () => {
    const u = await fx.user(db);
    await createRule(db, u, "max_duration", "60");
    await createRule(db, u, "max_duration", "20");
    const rules = await listRules(db, u);
    expect(rules.map((r) => [r.kind, r.value])).toEqual([["max_duration", "1200"]]);
  });

  it("rejects a min above the max", async () => {
    const u = await fx.user(db);
    await createRule(db, u, "max_duration", "20");
    expect(await createRule(db, u, "min_duration", "30")).toEqual({ ok: false, error: "min_exceeds_max" });
  });

  it.each([
    ["min_duration", "0"],
    ["max_duration", "1.5"],
    ["max_duration", "abc"],
    ["keyword", " a "],
    ["keyword", "x".repeat(51)],
    ["channel", "  "],
  ] as const)("rejects %s = %j", async (kind, value) => {
    expect(await createRule(db, await fx.user(db), kind, value)).toEqual({ ok: false, error: "invalid_value" });
  });

  it("rejects unknown topics", async () => {
    expect(await createRule(db, await fx.user(db), "topic", "astrology")).toEqual({ ok: false, error: "unknown_topic" });
  });

  it("normalizes keywords and dedupes", async () => {
    const u = await fx.user(db);
    await createRule(db, u, "keyword", "  CRYPTO ");
    await createRule(db, u, "keyword", "crypto");
    expect((await listRules(db, u)).map((r) => r.value)).toEqual(["crypto"]);
  });

  it("only lets the owner delete a rule", async () => {
    const u = await fx.user(db);
    const other = await fx.user(db);
    const r = await createRule(db, u, "no_shorts", "");
    const id = r.ok ? r.rule.id : "";
    expect(await deleteRule(db, other, id)).toBe(false);
    expect(await deleteRule(db, u, id)).toBe(true);
  });
});
