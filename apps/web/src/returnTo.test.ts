import { expect, it } from "vitest";
import { sameSitePath } from "./returnTo.ts";

it("comes back from sign-in only to a path on this site", () => {
  const origin = "https://offsiteagents.app";
  expect(sameSitePath("/pair?code=K7QD-3MPX", origin)).toBe("/pair?code=K7QD-3MPX");
  expect(sameSitePath("/pair?code=K7QD-3MPX&dev=al#x", origin)).toBe("/pair?code=K7QD-3MPX&dev=al#x");
  for (const bad of ["https://evil.example/pair", "//evil.example/pair", "/\\evil.example", "pair", "/callback?code=1", 42, null, undefined]) {
    expect(sameSitePath(bad, origin)).toBeNull();
  }
});
