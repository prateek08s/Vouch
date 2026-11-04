import { expect, it } from "vitest";
import { formatDuration, greeting, initials, plural } from "./format";

it.each([
  [null, null],
  [0, null],
  [45, "45 sec"],
  [60, "1 min"],
  [38 * 60 + 12, "38 min"],
  [3600, "1 hr"],
  [3600 + 56 * 60, "1 hr 56 min"],
  [3599, "1 hr"],
])("formatDuration(%s) = %s", (s, out) => expect(formatDuration(s)).toBe(out));

it.each([
  ["Priya Nair", "PN"],
  ["maya", "MA"],
  ["  Ana  María  López ", "AL"],
  ["", "?"],
])("initials(%j) = %s", (name, out) => expect(initials(name)).toBe(out));

it("greets by local hour", () => {
  expect(greeting(new Date("2026-01-01T09:00:00Z"), "UTC")).toBe("Good morning");
  expect(greeting(new Date("2026-01-01T14:00:00Z"), "UTC")).toBe("Good afternoon");
  expect(greeting(new Date("2026-01-01T20:00:00Z"), "UTC")).toBe("Good evening");
  expect(greeting(new Date("2026-01-01T02:00:00Z"), "UTC")).toBe("Good evening");
});

it("pluralizes", () => {
  expect(plural(1, "person", "people")).toBe("1 person");
  expect(plural(4, "thing", "things")).toBe("4 things");
});
