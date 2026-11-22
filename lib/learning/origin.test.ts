import { expect, it } from "vitest";
import { sameOrigin } from "./origin";

it("uses the incoming host when Next rewrites the internal request URL", () => {
  expect(sameOrigin(new Request("http://localhost:3120/api/learning", { headers: { host: "127.0.0.1:3120", origin: "http://127.0.0.1:3120" } }))).toBe(true);
  expect(sameOrigin(new Request("http://localhost:3000/api/learning", { headers: { host: "vouch.example", origin: "https://vouch.example" } }))).toBe(true);
});
it("rejects missing, malformed and cross-site origins", () => {
  for (const origin of ["null", "broken", "https://evil.example", "https://vouch.example.evil", "https://vouch.example/path"]) {
    expect(sameOrigin(new Request("https://vouch.example/api/learning", { headers: { host: "vouch.example", origin } }))).toBe(false);
  }
  expect(sameOrigin(new Request("https://vouch.example/api/learning"))).toBe(false);
});
