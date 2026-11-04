import { describe, expect, it } from "vitest";
import { trustFromCounts } from "@/lib/trust/model";
import {
  MAX_FEED_ITEMS,
  diversify,
  explain,
  freshness,
  quality,
  rankCircle,
  scoreCandidate,
  type CircleVouch,
  type FeedCandidate,
  type RankedItem,
} from "./rank";

const NOW = new Date("2026-05-01T12:00:00Z");
const H = 3_600_000;
const GPU = 1;
const DESIGN = 2;
const topics = new Map([[GPU, "GPU"], [DESIGN, "Design"]]);

let n = 0;
function v(over: Partial<CircleVouch> & { worth?: number; samples?: number; topicId?: number | null } = {}): CircleVouch {
  const { worth = 0, samples = 0, topicId = null, ...rest } = over;
  n++;
  return {
    vouchId: `v${n}`,
    curatorId: `c${n}`,
    curatorName: `Curator${n}`,
    curatorUsername: `curator${n}`,
    note: null,
    isOwnContent: false,
    createdAt: new Date(NOW.getTime() - H),
    topicIds: [GPU],
    trust: { ...trustFromCounts(worth, samples), topicId },
    ...rest,
  };
}
function cand(id: string, vouches: CircleVouch[], over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    resourceId: id,
    title: id,
    durationS: 600,
    thumbnailUrl: null,
    creatorName: null,
    primaryTopic: { id: GPU, name: "GPU" },
    worthCount: 0,
    ratingCount: 0,
    vouches,
    ...over,
  };
}

describe("signals", () => {
  it("quality is smoothed toward 50%", () => {
    expect(quality(0, 0)).toBe(0.5);
    expect(quality(1, 1)).toBeCloseTo(0.667, 2);
    expect(quality(90, 100)).toBeCloseTo(0.892, 2);
  });

  it("freshness halves every 72 hours and never exceeds 1", () => {
    expect(freshness(NOW, NOW)).toBe(1);
    expect(freshness(new Date(NOW.getTime() - 72 * H), NOW)).toBeCloseTo(0.5);
    expect(freshness(new Date(NOW.getTime() + 5 * H), NOW)).toBe(1); // clock skew
  });

  it("more trusted vouchers outrank fewer", () => {
    expect(scoreCandidate(cand("a", [v(), v()]), NOW)).toBeGreaterThan(scoreCandidate(cand("b", [v()]), NOW));
  });

  it("trust earned on the topic outweighs a raw follow", () => {
    const trusted = cand("a", [v({ worth: 11, samples: 12, topicId: GPU })]);
    const neutral = cand("b", [v()]);
    expect(scoreCandidate(trusted, NOW)).toBeGreaterThan(scoreCandidate(neutral, NOW));
  });

  it("creator vouches count half", () => {
    const own = scoreCandidate(cand("a", [v({ isOwnContent: true })]), NOW);
    const other = scoreCandidate(cand("b", [v()]), NOW);
    expect(own).toBeCloseTo(other / 2);
  });

  it("freshness uses the most recent vouch, so a re-vouch resurfaces old videos", () => {
    const old = new Date(NOW.getTime() - 30 * 24 * H);
    const stale = cand("a", [v({ createdAt: old })]);
    const revouched = cand("b", [v({ createdAt: old }), v({ createdAt: NOW })]);
    expect(scoreCandidate(revouched, NOW)).toBeGreaterThan(scoreCandidate(stale, NOW) * 10);
  });

  it("scores zero with no vouches", () => {
    expect(scoreCandidate(cand("a", []), NOW)).toBe(0);
  });
});

describe("explain", () => {
  it("names the single voucher and admits when trust is still unknown", () => {
    const c = cand("a", [v({ curatorName: "Priya" })]);
    const { explanation } = explain(c, topics);
    expect(explanation.headline).toBe("Vouched by Priya");
    expect(explanation.code).toBe("circle_follow");
    expect(explanation.whyThis).toBe("You follow Priya. Rating this teaches Vouch how much you trust their picks.");
  });

  it("cites topic evidence for the most trusted voucher (plan 10)", () => {
    const c = cand("a", [
      v({ curatorName: "Maya" }),
      v({ curatorName: "Priya", worth: 11, samples: 12, topicId: GPU }),
      v({ curatorName: "Arjun" }),
    ]);
    const { explanation } = explain(c, topics);
    expect(explanation.headline).toBe("Vouched by Priya and 2 others you follow");
    expect(explanation.whyThis).toBe("You rated 11 of Priya's 12 GPU picks Worth It. 2 other people you follow vouched too.");
    expect(explanation.leadCurator).toMatchObject({ name: "Priya", level: "strong" });
    expect(explanation.code).toBe("circle_topic_trust");
  });

  it("falls back to overall evidence when the topic has none", () => {
    const c = cand("a", [v({ curatorName: "James", worth: 7, samples: 9, topicId: null })]);
    expect(explain(c, topics).explanation).toMatchObject({
      code: "circle_base_trust",
      whyThis: "You rated 7 of James' 9 picks Worth It.",
    });
  });

  it("uses two names for two vouchers", () => {
    const c = cand("a", [v({ curatorName: "Priya" }), v({ curatorName: "Sam" })]);
    expect(explain(c, topics).explanation.headline).toMatch(/^Vouched by (Priya and Sam|Sam and Priya)$/);
  });

  it("features the note from the most trusted voucher who wrote one", () => {
    const c = cand("a", [
      v({ curatorName: "Low", note: "meh", worth: 0, samples: 10 }),
      v({ curatorName: "High", note: "Best explanation of GPU scheduling I've seen.", worth: 10, samples: 10 }),
      v({ curatorName: "Top", note: null, worth: 20, samples: 20 }),
    ]);
    expect(explain(c, topics).explanation.featuredNote).toEqual({ text: "Best explanation of GPU scheduling I've seen.", by: "High" });
  });

  it("flags creator vouches", () => {
    expect(explain(cand("a", [v({ isOwnContent: true })]), topics).explanation.creatorVouch).toBe(true);
  });

  it("leads with the vouch it attributes, so Worth It credits the right person", () => {
    const top = v({ worth: 10, samples: 10 });
    expect(explain(cand("a", [v(), top]), topics).leadVouchId).toBe(top.vouchId);
  });
});

function ranked(id: string, topicId: number, curator: string, score: number): RankedItem {
  return {
    ...cand(id, [], { primaryTopic: { id: topicId, name: String(topicId) } }),
    score,
    leadVouchId: id,
    explanation: {
      code: "circle_follow",
      headline: "",
      whyThis: "",
      leadCurator: { id: curator, name: curator, username: curator, level: "new" },
      vouchers: [],
      featuredNote: null,
      creatorVouch: false,
    },
  };
}

describe("diversify", () => {
  it("never shows 3 in a row on one topic when alternatives exist", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => ranked(`g${i}`, GPU, `c${i}`, 100 - i)),
      ...Array.from({ length: 3 }, (_, i) => ranked(`d${i}`, DESIGN, `d${i}`, 50 - i)),
    ];
    const out = diversify(items).map((i) => i.primaryTopic!.id);
    for (let i = 2; i < out.length - 3; i++) {
      expect(out[i] === out[i - 1] && out[i] === out[i - 2], `run at ${i}: ${out}`).toBe(false);
    }
  });

  it("caps any one curator at 2 per 10", () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => ranked(`p${i}`, i % 2 ? GPU : DESIGN, "priya", 100 - i)),
      ...Array.from({ length: 8 }, (_, i) => ranked(`o${i}`, i % 2 ? GPU : DESIGN, `other${i}`, 50 - i)),
    ];
    const first10 = diversify(items).slice(0, 10);
    expect(first10.filter((i) => i.explanation.leadCurator.id === "priya")).toHaveLength(2);
  });

  it("keeps score order when there is nothing to fix", () => {
    const items = [ranked("a", GPU, "x", 3), ranked("b", DESIGN, "y", 2), ranked("c", GPU, "z", 1)];
    expect(diversify(items).map((i) => i.resourceId)).toEqual(["a", "b", "c"]);
  });

  it("relaxes rather than dropping items when nothing fits", () => {
    const items = Array.from({ length: 5 }, (_, i) => ranked(`g${i}`, GPU, "solo", 10 - i));
    const out = diversify(items);
    expect(out.map((i) => i.resourceId)).toEqual(["g0", "g1", "g2", "g3", "g4"]);
  });
});

describe("rankCircle", () => {
  it("is finite", () => {
    const cs = Array.from({ length: 100 }, (_, i) => cand(`r${i}`, [v()]));
    expect(rankCircle(cs, NOW, topics)).toHaveLength(MAX_FEED_ITEMS);
  });

  it("is deterministic for equal scores", () => {
    const shared = v();
    const cs = ["c", "a", "b"].map((id) => cand(id, [{ ...shared, curatorId: id }], { primaryTopic: null }));
    expect(rankCircle(cs, NOW, topics).map((r) => r.resourceId)).toEqual(["a", "b", "c"]);
  });
});
