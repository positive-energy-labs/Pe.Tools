import { expect, test } from "vite-plus/test";
import { workSchemaAge } from "../src/route-doc.ts";

test.each([
  [undefined, "unknown"],
  [null, "unknown"],
  ["1", "unknown"],
  [0, "unknown"],
  [1, "older"],
  [2, "current"],
  [3, "newer"],
])("Work schema marker %s has age %s", (schemaVersion, age) => {
  expect(workSchemaAge({ version: 1, schemaVersion }, { schemaVersion: 2 })).toBe(age);
});
test("envelope transport version does not establish authored schema age", () => {
  expect(workSchemaAge({ version: 1 }, { schemaVersion: 2 })).toBe("unknown");
});
