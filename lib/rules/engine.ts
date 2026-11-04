/**
 * Hard user rules. Applied before ranking, never overridden by popularity (plan 3.2).
 * "A blocked resource appearing is a product trust failure." So when in doubt, exclude.
 */

export type RuleKind = "channel" | "topic" | "keyword" | "min_duration" | "max_duration" | "no_shorts";
export type Rule = { kind: RuleKind; value: string };

export type RuleCandidate = {
  resourceId: string;
  title: string;
  creatorId: string | null;
  creatorName: string | null;
  durationS: number | null;
  isShort: boolean;
  /** Topic slugs on the resource, including ancestors (blocking "technology" blocks "gpu"). */
  topicSlugs: string[];
};

export type ExclusionReason =
  | { kind: "channel"; value: string }
  | { kind: "topic"; value: string }
  | { kind: "keyword"; value: string }
  | { kind: "too_short"; value: number }
  | { kind: "too_long"; value: number }
  | { kind: "unknown_duration" }
  | { kind: "short" };

export const SHORT_MAX_SECONDS = 60;

type Compiled = {
  channels: Set<string>;
  topics: Set<string>;
  keywords: { word: string; re: RegExp }[];
  min: number | null;
  max: number | null;
  noShorts: boolean;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase, strip accents, collapse whitespace. */
export function normalizeText(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function compileRules(rules: Rule[]): Compiled {
  const c: Compiled = { channels: new Set(), topics: new Set(), keywords: [], min: null, max: null, noShorts: false };
  for (const r of rules) {
    switch (r.kind) {
      case "channel":
        c.channels.add(r.value.trim().toLowerCase());
        break;
      case "topic":
        c.topics.add(r.value.trim().toLowerCase());
        break;
      case "keyword": {
        const word = normalizeText(r.value);
        // Whole-word match so blocking "ai" does not hide "rain". Letters/digits define words.
        if (word) c.keywords.push({ word, re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, "u") });
        break;
      }
      case "min_duration": {
        const n = Number(r.value);
        if (Number.isFinite(n)) c.min = Math.max(c.min ?? 0, n);
        break;
      }
      case "max_duration": {
        const n = Number(r.value);
        if (Number.isFinite(n)) c.max = c.max === null ? n : Math.min(c.max, n);
        break;
      }
      case "no_shorts":
        c.noShorts = true;
        break;
    }
  }
  return c;
}

/** Returns the first reason a candidate is excluded, or null if it may be shown. */
export function exclusionReason(cand: RuleCandidate, c: Compiled): ExclusionReason | null {
  if (cand.creatorId && c.channels.has(cand.creatorId.toLowerCase())) return { kind: "channel", value: cand.creatorId };

  for (const t of cand.topicSlugs) if (c.topics.has(t.toLowerCase())) return { kind: "topic", value: t };

  if (c.keywords.length) {
    const hay = normalizeText(`${cand.title} ${cand.creatorName ?? ""}`);
    for (const k of c.keywords) if (k.re.test(hay)) return { kind: "keyword", value: k.word };
  }

  const isShort = cand.isShort || (cand.durationS !== null && cand.durationS <= SHORT_MAX_SECONDS);
  if (c.noShorts && isShort) return { kind: "short" };

  if (c.min !== null || c.max !== null) {
    if (cand.durationS === null) return { kind: "unknown_duration" };
    if (c.min !== null && cand.durationS < c.min) return { kind: "too_short", value: c.min };
    if (c.max !== null && cand.durationS > c.max) return { kind: "too_long", value: c.max };
  }
  return null;
}

export function applyRules<T extends RuleCandidate>(
  candidates: T[],
  rules: Rule[],
): { kept: T[]; removed: { candidate: T; reason: ExclusionReason }[] } {
  const c = compileRules(rules);
  const kept: T[] = [];
  const removed: { candidate: T; reason: ExclusionReason }[] = [];
  for (const cand of candidates) {
    const reason = exclusionReason(cand, c);
    if (reason) removed.push({ candidate: cand, reason });
    else kept.push(cand);
  }
  return { kept, removed };
}
