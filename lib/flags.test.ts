import { expect, it } from "vitest";
import { socialEnabled } from "./flags";

it("keeps the social layer off unless NEXT_PUBLIC_VOUCH_SOCIAL is 1", () => {
  expect(socialEnabled({})).toBe(false);
  expect(socialEnabled({ NEXT_PUBLIC_VOUCH_SOCIAL: "true" })).toBe(false);
  expect(socialEnabled({ NEXT_PUBLIC_VOUCH_SOCIAL: "1" })).toBe(true);
});
