import { describe, expect, it } from "vitest";
import { USERNAME_PATTERN, usernameFrom } from ".";

describe("usernameFrom", () => {
  it.each([
    ["Sam O'Neil", "sam_oneil_4821"],
    ["  Priya   Nair ", "priya_nair_4821"],
    ["José Álvarez", "jose_alvarez_4821"],
    ["李雷", "user_4821"],
    ["!!!", "user_4821"],
    ["A", "a_4821"],
    ["Someone With A Very Long Display Name Indeed", "someone_with_a_very_4821"],
  ])("%s -> %s", (name, expected) => {
    const u = usernameFrom(name, "4821");
    expect(u).toBe(expected);
    expect(USERNAME_PATTERN.test(u)).toBe(true);
  });

  it("never ends the base with an underscore after trimming", () => {
    expect(usernameFrom("abcdefghijklmnopqrs tuv", "4821")).toBe("abcdefghijklmnopqrs_4821");
  });
});
