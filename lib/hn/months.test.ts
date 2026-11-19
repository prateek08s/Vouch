import { expect, it } from "vitest";
import { addMonths, monthEnded, monthsBetween, pendingMonths } from "./months";

it("does month arithmetic across years", () => {
  expect(addMonths("2025-12", 1)).toBe("2026-01");
  expect(addMonths("2026-01", -1)).toBe("2025-12");
  expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  const now = new Date("2026-11-20T00:00:00Z");
  expect(monthEnded("2026-10", now)).toBe(true);
  expect(monthEnded("2026-11", now)).toBe(false);
});

it("plans missing finished months plus last and this month", () => {
  const have = monthsBetween("2025-01", "2025-12");
  expect(pendingMonths(have, new Date("2026-03-05T00:00:00Z"))).toEqual(["2026-01", "2026-02", "2026-03"]);
  const all = monthsBetween("2025-01", "2026-10");
  expect(pendingMonths(all, new Date("2026-11-20T00:00:00Z"))).toEqual(["2026-10", "2026-11"]);
  expect(pendingMonths([], new Date("2025-01-10T00:00:00Z"))).toEqual(["2025-01"]);
});
