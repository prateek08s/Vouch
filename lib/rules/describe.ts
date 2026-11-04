import { formatDuration } from "@/lib/format";
import type { Rule } from "./engine";
import type { RuleError } from "./index";

export const RULE_ERROR_MESSAGES: Record<RuleError, string> = {
  invalid_value: "That value doesn't work for this rule.",
  unknown_topic: "That topic doesn't exist.",
  min_exceeds_max: "The minimum length can't be longer than the maximum.",
  too_many_rules: "You've reached the rule limit. Remove one first.",
};

export type RuleLookups = {
  channelNames: Map<string, string>;
  topicNames: Map<string, string>;
};

/** Plain-language label for a stored rule. */
export function describeRule(rule: Rule, l: RuleLookups): string {
  switch (rule.kind) {
    case "channel":
      return `Never show ${l.channelNames.get(rule.value) ?? "this channel"}`;
    case "topic":
      return `Hide ${l.topicNames.get(rule.value) ?? rule.value}, including its subtopics`;
    case "keyword":
      return `Hide titles containing “${rule.value}”`;
    case "min_duration":
      return `Hide videos shorter than ${formatDuration(Number(rule.value)) ?? `${rule.value} sec`}`;
    case "max_duration":
      return `Hide videos longer than ${formatDuration(Number(rule.value)) ?? `${rule.value} sec`}`;
    case "no_shorts":
      return "Hide Shorts";
  }
}

/** Rules people reach for first are listed first. */
const ORDER: Rule["kind"][] = ["channel", "topic", "keyword", "no_shorts", "min_duration", "max_duration"];
export function sortRules<T extends Rule>(rules: T[]): T[] {
  return [...rules].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.value.localeCompare(b.value));
}
