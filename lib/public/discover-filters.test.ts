import { expect, it } from "vitest";
import { discoverHref, parseDiscoverFilters } from "./discover-filters";
it("normalizes filters and rejects inherited enum keys and fractional pages", () => {
  expect(parseDiscoverFilters({topic:["ai"," ai ",""],len:"constructor",sort:"toString",page:"1.5",maxMinutes:"-1",channel:"  Teacher  "})).toEqual({topics:["ai"],length:null,sort:"top",cursor:0,channel:"Teacher",maxMinutes:null});
});
it("retains combined filters across pagination but resets the page after changes", () => {
  const filters=parseDiscoverFilters({topic:["ai","web"],channel:"C++ & friends",maxMinutes:"30",len:"medium",page:"12"});
  const next=new URL(discoverHref("/discover",filters,{cursor:24,sort:"shortest"}),"https://vouch.example");
  expect(next.searchParams.getAll("topic")).toEqual(["ai","web"]);
  expect(next.searchParams.get("channel")).toBe("C++ & friends");
  expect(next.searchParams.get("maxMinutes")).toBe("30");
  expect(next.searchParams.get("page")).toBe("24");
  expect(next.searchParams.get("len")).toBe("medium");
  expect(new URL(discoverHref("/",filters,{channel:"Other"}),next).searchParams.has("page")).toBe(false);
});
