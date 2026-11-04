import { beforeAll, expect, it } from "vitest";
import { openPglite } from "@/lib/db";
import { groupedTopics, loadTopics, type TopicIndex } from "./index";

let t: TopicIndex;
beforeAll(async () => {
  t = await loadTopics(await openPglite());
});

it.each([
  ["gpu", ["gpu", "hardware", "technology"]],
  ["llms", ["llms", "ai", "technology"]],
  ["rust", ["rust", "programming", "technology"]],
  ["physics", ["physics", "science"]],
  ["technology", ["technology"]],
])("lineage of %s", (slug, expected) => {
  expect(t.lineage(t.bySlug.get(slug)!.id)).toEqual(expected);
});

it("returns nothing for unknown ids", () => {
  expect(t.lineage(999_999)).toEqual([]);
});

it("groups topics as a tree: root, then each branch followed by its leaves", () => {
  const tech = groupedTopics(t).find((g) => g.root.slug === "technology")!;
  const slugs = tech.topics.map((x) => x.slug);
  expect(slugs[0]).toBe("technology");
  // Branch immediately followed by its own children, alphabetical.
  const hw = slugs.indexOf("hardware");
  expect(slugs.slice(hw, hw + 3)).toEqual(["hardware", "cpu", "gpu"]);
  const ai = slugs.indexOf("ai");
  expect(slugs.slice(ai, ai + 3)).toEqual(["ai", "computer-vision", "llms"]);
  expect(tech.topics.find((x) => x.slug === "gpu")!.depth).toBe(2);
});

it("includes every topic exactly once across groups", () => {
  const all = groupedTopics(t).flatMap((g) => g.topics.map((x) => x.id));
  expect(all.length).toBe(t.byId.size);
  expect(new Set(all).size).toBe(t.byId.size);
});
