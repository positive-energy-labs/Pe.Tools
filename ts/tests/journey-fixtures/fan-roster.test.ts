import { expect, test } from "vite-plus/test";
import { fanRosterLabel, fanRosterRow } from "./fan-roster.ts";

test.each([
  ["MA-1 / port 1muas\nnot computed", true],
  ["MA-1 / port 12muas", false],
  ["MA-10 / port 1", false],
] as const)("roster identity survives decoration: %s", (text, matches) => {
  expect(fanRosterRow("MA-1", 1).test(text)).toBe(matches);
  expect(fanRosterLabel("MA-1 / port 1").test(text)).toBe(matches);
});

test("duplicate-mark locations and regex punctuation remain literal", () => {
  expect(fanRosterRow("MA+1", 1).test("MA+1 · Level 2 / port 1muas\nnot computed")).toBe(true);
  expect(fanRosterRow("MA+1", 1).test("MAA1 / port 1")).toBe(false);
});
