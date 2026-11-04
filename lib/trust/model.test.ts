import { describe, expect, it } from "vitest";
import { TRUST_DEFAULT, TRUST_MAX, TRUST_MIN, trustFromCounts, trustLevel } from "./model";

describe("trustFromCounts", () => {
  it("starts at the default with no evidence", () => {
    expect(trustFromCounts(0, 0)).toEqual({ weight: TRUST_DEFAULT, confidence: 0, sampleCount: 0, worthCount: 0 });
  });

  it("moves conservatively on a single rating", () => {
    const up = trustFromCounts(1, 1).weight;
    const down = trustFromCounts(0, 1).weight;
    expect(up).toBeGreaterThan(1);
    expect(up).toBeLessThan(1.4);
    expect(down).toBeLessThan(1);
    expect(down).toBeGreaterThan(0.6);
  });

  it("moves up and down at the same pace relative to each bound", () => {
    for (const n of [1, 4, 10, 50]) {
      const up = (trustFromCounts(n, n).weight - 1) / (TRUST_MAX - 1);
      const down = (1 - trustFromCounts(0, n).weight) / (1 - TRUST_MIN);
      expect(up).toBeCloseTo(down, 2);
    }
  });

  it("does not hit the floor after a handful of bad picks (plan 6.3)", () => {
    expect(trustFromCounts(0, 7).weight).toBeGreaterThan(0.6);
    expect(trustFromCounts(0, 20).weight).toBeGreaterThan(TRUST_MIN + 0.2);
  });

  it("separates 2/2 from 82/90 (plan 6.4)", () => {
    const lucky = trustFromCounts(2, 2);
    const proven = trustFromCounts(82, 90);
    expect(proven.weight).toBeGreaterThan(lucky.weight + 0.8);
    expect(proven.confidence).toBeGreaterThan(0.85);
    expect(lucky.confidence).toBeLessThan(0.2);
  });

  it("never leaves [0.2, 3.0] however extreme the record", () => {
    for (const [w, n] of [[0, 10_000], [10_000, 10_000], [0, 1], [1, 1], [5000, 10_000]]) {
      const { weight } = trustFromCounts(w, n);
      expect(weight).toBeGreaterThanOrEqual(TRUST_MIN);
      expect(weight).toBeLessThanOrEqual(TRUST_MAX);
    }
    // Bounds are approached asymptotically by long records.
    expect(trustFromCounts(0, 10_000).weight).toBeCloseTo(TRUST_MIN, 2);
    expect(trustFromCounts(10_000, 10_000).weight).toBeCloseTo(TRUST_MAX, 2);
  });

  it("increases monotonically with each extra Worth It", () => {
    let prev = -Infinity;
    for (let w = 0; w <= 20; w++) {
      const { weight } = trustFromCounts(w, 20);
      expect(weight).toBeGreaterThanOrEqual(prev);
      prev = weight;
    }
  });

  it.each([[-1, 0], [0, -1], [3, 2], [0, NaN]])("rejects impossible counts %i/%i", (w, n) => {
    expect(() => trustFromCounts(w, n)).toThrow(RangeError);
  });
});

describe("trustLevel", () => {
  it("withholds judgement below 3 samples", () => {
    expect(trustLevel(trustFromCounts(2, 2))).toBe("new");
  });
  it.each([
    [11, 12, "strong"],
    [82, 90, "very_strong"],
    [5, 10, "neutral"],
    [0, 12, "low"],
  ])("%i/%i is %s", (w, n, level) => {
    expect(trustLevel(trustFromCounts(w, n))).toBe(level);
  });
});
