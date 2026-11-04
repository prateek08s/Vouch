/**
 * Taste Passport v1 (plan 5.7, 7): top topics, emerging taste and curator success.
 * Pure, so every rule is unit tested.
 *
 * Plan 7.2, "avoid fake precision": topics get a level (Core, Strong, Emerging), not a score.
 */

export type TopicSignal = { topicId: number; kind: "vouch" | "worth"; at: Date };
export type TopicLevel = "core" | "strong" | "emerging";
export type PassportTopic = { topicId: number; name: string; level: TopicLevel };

/** Putting your name on something says more than enjoying it. */
export const WEIGHT = { vouch: 2, worth: 1 } as const;
export const MAX_TOPICS = 5;
export const MIN_SIGNALS = 3;
export const CORE_SHARE = 0.6;
export const STRONG_SHARE = 0.25;
export const EMERGING_DAYS = 30;
export const EMERGING_RECENT_SHARE = 0.6;

export const LEVEL_LABEL: Record<TopicLevel, string> = {
  core: "Core interest",
  strong: "Strong interest",
  emerging: "Emerging interest",
};

/**
 * Top topics by weighted signal. Core: close to the strongest topic. Emerging: not core, and
 * mostly from the last 30 days. Strong: a solid share of the strongest. Weaker topics are left
 * out rather than shown as tiny bars. Null until there are enough signals to say anything.
 */
export function topicLevels(signals: TopicSignal[], names: ReadonlyMap<number, string>, now: Date): PassportTopic[] | null {
  if (signals.length < MIN_SIGNALS) return null;
  const recentSince = now.getTime() - EMERGING_DAYS * 86_400_000;
  const by = new Map<number, { score: number; recent: number }>();
  for (const s of signals) {
    if (!names.has(s.topicId)) continue;
    const w = WEIGHT[s.kind];
    const cur = by.get(s.topicId) ?? { score: 0, recent: 0 };
    cur.score += w;
    if (s.at.getTime() >= recentSince) cur.recent += w;
    by.set(s.topicId, cur);
  }
  const ranked = [...by.entries()].sort((a, b) => b[1].score - a[1].score || names.get(a[0])!.localeCompare(names.get(b[0])!));
  if (!ranked.length) return null;
  const top = ranked[0][1].score;
  // "Emerging" means new compared with before. Someone whose activity is all recent has no
  // before yet, so every topic would look emerging: only use the label once there is a baseline.
  const hasBaseline = signals.some((s) => s.at.getTime() < recentSince);
  const out: PassportTopic[] = [];
  for (const [topicId, t] of ranked) {
    let level: TopicLevel | null = null;
    if (t.score >= CORE_SHARE * top) level = "core";
    else if (hasBaseline && t.recent / t.score >= EMERGING_RECENT_SHARE) level = "emerging";
    else if (t.score >= STRONG_SHARE * top) level = "strong";
    if (level) out.push({ topicId, name: names.get(topicId)!, level });
    if (out.length === MAX_TOPICS) break;
  }
  return out;
}

/** A rating someone else gave a video they reached through this person's vouch. */
export type AttributedRating = { raterId: string; worthIt: boolean; topicIds: number[] };

export type CuratorSuccess = {
  rated: number;
  worth: number;
  /** Null until enough ratings exist for a rate to mean anything. */
  worthItRate: number | null;
  /** Distinct people who found something worth watching through this curator. */
  peopleHelped: number;
  /** Topics where this curator's picks are rated Worth It most reliably. */
  trustedFor: string[];
};

export const MIN_RATINGS_FOR_RATE = 5;
export const MIN_RATINGS_FOR_TOPIC = 3;
export const TRUSTED_TOPIC_RATE = 0.6;

export function curatorSuccess(ratings: AttributedRating[], names: ReadonlyMap<number, string>): CuratorSuccess {
  const worth = ratings.filter((r) => r.worthIt).length;
  const perTopic = new Map<number, { n: number; w: number }>();
  for (const r of ratings) {
    for (const t of new Set(r.topicIds)) {
      const cur = perTopic.get(t) ?? { n: 0, w: 0 };
      cur.n++;
      if (r.worthIt) cur.w++;
      perTopic.set(t, cur);
    }
  }
  const trustedFor = [...perTopic.entries()]
    .filter(([t, s]) => names.has(t) && s.n >= MIN_RATINGS_FOR_TOPIC && s.w / s.n >= TRUSTED_TOPIC_RATE)
    .sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n || b[1].n - a[1].n || names.get(a[0])!.localeCompare(names.get(b[0])!))
    .slice(0, 3)
    .map(([t]) => names.get(t)!);
  return {
    rated: ratings.length,
    worth,
    worthItRate: ratings.length >= MIN_RATINGS_FOR_RATE ? worth / ratings.length : null,
    peopleHelped: new Set(ratings.filter((r) => r.worthIt).map((r) => r.raterId)).size,
    trustedFor,
  };
}
