/**
 * Circle ranking. Pure: no I/O, so every rule here is unit tested.
 *
 *   score = trust_signal x quality x freshness          (plan 14.2)
 *
 * trust_signal  sum over circle vouchers of trust(viewer, curator, topic); creator vouches count half
 * quality       (worth + 1) / (ratings + 2) across all viewers (Bayesian, prior 50%)
 * freshness     0.5 ^ (hours since most recent circle vouch / HALF_LIFE). Vouch time, not upload time,
 *               so old excellent videos resurface when someone re-vouches them.
 *
 * Every signal that moves the score also appears in the explanation (plan 14.4).
 */

import { trustLevel, type TrustLevel, type TrustStats } from "@/lib/trust/model";

export const FRESHNESS_HALF_LIFE_H = 72;
export const OWN_CONTENT_FACTOR = 0.5;
export const PAGE_SIZE = 10;
/** Finite by design (plan 3.5): Circle never pages past this. */
export const MAX_FEED_ITEMS = 30;

export type CircleVouch = {
  vouchId: string;
  curatorId: string;
  curatorName: string;
  curatorUsername: string;
  note: string | null;
  isOwnContent: boolean;
  createdAt: Date;
  topicIds: number[];
  /** trust(viewer, curator) resolved for this vouch's topics. */
  trust: TrustStats & { topicId: number | null };
};

export type FeedCandidate = {
  resourceId: string;
  title: string;
  durationS: number | null;
  thumbnailUrl: string | null;
  creatorName: string | null;
  primaryTopic: { id: number; name: string } | null;
  worthCount: number;
  ratingCount: number;
  vouches: CircleVouch[];
};

export type Explanation = {
  code: "circle_topic_trust" | "circle_base_trust" | "circle_follow";
  /** "Vouched by Priya and 2 others you trust" */
  headline: string;
  /** "You rated 11 of Priya's 12 GPU picks Worth It." */
  whyThis: string;
  leadCurator: { id: string; name: string; username: string; level: TrustLevel };
  vouchers: { id: string; name: string }[];
  featuredNote: { text: string; by: string } | null;
  creatorVouch: boolean;
};

export type RankedItem = FeedCandidate & { score: number; explanation: Explanation; leadVouchId: string };

export function quality(worth: number, total: number): number {
  return (worth + 1) / (total + 2);
}

export function freshness(latest: Date, now: Date): number {
  const hours = Math.max(0, (now.getTime() - latest.getTime()) / 3_600_000);
  return Math.pow(0.5, hours / FRESHNESS_HALF_LIFE_H);
}

function vouchWeight(v: CircleVouch) {
  return v.trust.weight * (v.isOwnContent ? OWN_CONTENT_FACTOR : 1);
}

export function scoreCandidate(c: FeedCandidate, now: Date): number {
  if (!c.vouches.length) return 0;
  const trust = c.vouches.reduce((s, v) => s + vouchWeight(v), 0);
  const latest = c.vouches.reduce((m, v) => (v.createdAt > m ? v.createdAt : m), c.vouches[0].createdAt);
  return trust * quality(c.worthCount, c.ratingCount) * freshness(latest, now);
}

function possessive(name: string) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

export function explain(c: FeedCandidate, topicNames: Map<number, string>): { explanation: Explanation; leadVouchId: string } {
  // Lead curator: the voucher whose judgement the viewer trusts most; ties go to more evidence.
  const sorted = [...c.vouches].sort(
    (a, b) => vouchWeight(b) - vouchWeight(a) || b.trust.sampleCount - a.trust.sampleCount || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const lead = sorted[0];
  const others = sorted.length - 1;
  const names = sorted.map((v) => v.curatorName);

  let headline: string;
  if (others === 0) headline = `Vouched by ${names[0]}`;
  else if (others === 1) headline = `Vouched by ${names[0]} and ${names[1]}`;
  else headline = `Vouched by ${names[0]} and ${others} others you follow`;

  const t = lead.trust;
  let code: Explanation["code"];
  let whyThis: string;
  if (t.topicId !== null && t.sampleCount >= 3) {
    code = "circle_topic_trust";
    const topic = topicNames.get(t.topicId) ?? "these";
    whyThis = `You rated ${t.worthCount} of ${possessive(lead.curatorName)} ${t.sampleCount} ${topic} picks Worth It.`;
  } else if (t.sampleCount >= 3) {
    code = "circle_base_trust";
    whyThis = `You rated ${t.worthCount} of ${possessive(lead.curatorName)} ${t.sampleCount} picks Worth It.`;
  } else {
    code = "circle_follow";
    whyThis = `You follow ${lead.curatorName}. Rating this teaches Vouch how much you trust their picks.`;
  }
  if (others > 0) whyThis += ` ${others === 1 ? "1 other person" : `${others} other people`} you follow vouched too.`;

  const noted = sorted.find((v) => v.note);
  return {
    leadVouchId: lead.vouchId,
    explanation: {
      code,
      headline,
      whyThis,
      leadCurator: { id: lead.curatorId, name: lead.curatorName, username: lead.curatorUsername, level: trustLevel(t) },
      vouchers: sorted.map((v) => ({ id: v.curatorId, name: v.curatorName })),
      featuredNote: noted ? { text: noted.note!, by: noted.curatorName } : null,
      creatorVouch: c.vouches.some((v) => v.isOwnContent),
    },
  };
}

/**
 * Post-ranking diversity (plan 14.3): at most 2 consecutive items on the same topic and
 * at most 2 items led by the same curator in any window of 10. Relaxes only when nothing fits.
 */
export function diversify(items: RankedItem[], maxRun = 2, maxPerCurator = 2, window = 10): RankedItem[] {
  const pool = [...items];
  const out: RankedItem[] = [];
  while (pool.length) {
    const recent = out.slice(-(window - 1));
    const fits = (it: RankedItem) => {
      const topic = it.primaryTopic?.id ?? null;
      const run = out.slice(-maxRun);
      const topicRun = topic !== null && run.length === maxRun && run.every((r) => r.primaryTopic?.id === topic);
      const curatorCount = recent.filter((r) => r.explanation.leadCurator.id === it.explanation.leadCurator.id).length;
      return !topicRun && curatorCount < maxPerCurator;
    };
    let idx = pool.findIndex(fits);
    if (idx === -1) idx = 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export function rankCircle(cands: FeedCandidate[], now: Date, topicNames: Map<number, string>): RankedItem[] {
  const scored = cands
    .filter((c) => c.vouches.length)
    .map((c) => ({ ...c, score: scoreCandidate(c, now), ...explain(c, topicNames) }))
    .sort((a, b) => b.score - a.score || a.resourceId.localeCompare(b.resourceId));
  return diversify(scored).slice(0, MAX_FEED_ITEMS);
}
