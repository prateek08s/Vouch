/**
 * Taste Graph v1: the pure math.
 *
 * Trust is derived from outcomes, never accumulated by mutation:
 *   smoothed = (worth + PRIOR) / (samples + 2 * PRIOR)       Bayesian, centred on 50%
 *   weight   = 1 + (smoothed - 0.5) * 2 * room               room = MAX - 1 above, 1 - MIN below
 *
 * The bounds are asymmetric around 1.0 (0.8 below, 2.0 above), so each side is scaled to its
 * own room. A single linear spread would hit the 0.2 floor after ~7 bad ratings while the
 * ceiling took hundreds. Both bounds are approached asymptotically, never reached quickly.
 * With PRIOR = 5 a few ratings move trust only a little (plan 6.3: conservative updates).
 */

export const TRUST_MIN = 0.2;
export const TRUST_MAX = 3.0;
export const TRUST_DEFAULT = 1.0;
export const PRIOR = 5;
/** Samples at which confidence reaches 50%. */
const CONFIDENCE_HALF = 10;

export type TrustStats = { weight: number; confidence: number; sampleCount: number; worthCount: number };

export function trustFromCounts(worthCount: number, sampleCount: number): TrustStats {
  if (sampleCount < 0 || worthCount < 0 || worthCount > sampleCount || !Number.isFinite(sampleCount)) {
    throw new RangeError(`invalid counts: ${worthCount}/${sampleCount}`);
  }
  const smoothed = (worthCount + PRIOR) / (sampleCount + 2 * PRIOR);
  const room = smoothed >= 0.5 ? TRUST_MAX - TRUST_DEFAULT : TRUST_DEFAULT - TRUST_MIN;
  const weight = clamp(TRUST_DEFAULT + (smoothed - 0.5) * 2 * room, TRUST_MIN, TRUST_MAX);
  return {
    weight: round(weight),
    confidence: round(sampleCount / (sampleCount + CONFIDENCE_HALF)),
    sampleCount,
    worthCount,
  };
}

export type TrustLevel = "new" | "low" | "neutral" | "strong" | "very_strong";

/** Human label for a trust value. Fake precision is avoided in the UI (plan 7.2). */
export function trustLevel(stats: Pick<TrustStats, "weight" | "sampleCount">): TrustLevel {
  if (stats.sampleCount < 3) return "new";
  if (stats.weight >= 2.2) return "very_strong";
  if (stats.weight >= 1.4) return "strong";
  if (stats.weight <= 0.7) return "low";
  return "neutral";
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
function round(x: number) {
  return Math.round(x * 1000) / 1000;
}
