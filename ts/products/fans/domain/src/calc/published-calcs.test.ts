import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import {
  capturePath,
  checkVersions,
  firstDifference,
  recompute,
  regenerate,
} from "./published-calcs.fixture.ts";

const next = recompute();
if (process.env.PE_REGENERATE_CALCS === "1") regenerate(next);
const saved = JSON.parse(readFileSync(capturePath, "utf8"));
test.each(Object.entries(next))("published %s matches the current engine", (key, value) => {
  checkVersions(saved[key], key);
  expect(firstDifference(saved[key], value), key).toBeNull();
});
test("capture contains exactly the consumed inputs and projections", () => {
  expect(Object.keys(saved).sort()).toEqual(Object.keys(next).sort());
});
test("retired engine recordings are refused", () => {
  expect(() => checkVersions({ engineVersion: "retired" }, "recorded-key")).toThrow(
    "recorded-key.engineVersion: retired !=",
  );
});
