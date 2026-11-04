import { expect, it } from "vitest";
import { describeRule, sortRules } from "./describe";

const l = {
  channelNames: new Map([["UC_hype", "Hype Central"]]),
  topicNames: new Map([["hardware", "Hardware"]]),
};

it.each([
  [{ kind: "channel", value: "UC_hype" }, "Never show Hype Central"],
  [{ kind: "channel", value: "UC_gone" }, "Never show this channel"],
  [{ kind: "topic", value: "hardware" }, "Hide Hardware, including its subtopics"],
  [{ kind: "keyword", value: "crypto" }, "Hide titles containing “crypto”"],
  [{ kind: "min_duration", value: "300" }, "Hide videos shorter than 5 min"],
  [{ kind: "max_duration", value: "3600" }, "Hide videos longer than 1 hr"],
  [{ kind: "max_duration", value: "5400" }, "Hide videos longer than 1 hr 30 min"],
  [{ kind: "no_shorts", value: "" }, "Hide Shorts"],
] as const)("%o", (rule, label) => {
  expect(describeRule(rule, l)).toBe(label);
});

it("sorts channel and topic blocks before duration limits", () => {
  const sorted = sortRules([
    { kind: "max_duration", value: "3600" },
    { kind: "keyword", value: "b" },
    { kind: "channel", value: "x" },
    { kind: "keyword", value: "a" },
  ] as const);
  expect(sorted.map((r) => `${r.kind}:${r.value}`)).toEqual(["channel:x", "keyword:a", "keyword:b", "max_duration:3600"]);
});
