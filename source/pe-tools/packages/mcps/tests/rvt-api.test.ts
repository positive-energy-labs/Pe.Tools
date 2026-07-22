import { expect, test } from "vite-plus/test";
import { searchWrapper } from "../src/shared/rvt-api/searchDocs.ts";

// ponytail: hits live rvtdocs.com/ac.cnstrc.com — opt in with PE_NETWORK_TESTS=1
test.skipIf(!process.env.PE_NETWORK_TESTS)("calls the Revit API docs search API", async () => {
  const results = await searchWrapper("FilteredElementCollector", 2026, 3);
  expect(results.some((result) => result.title === "FilteredElementCollector Class")).toBe(true);
}, 30_000);
