import { expect, test } from "vite-plus/test";
import { searchWrapper } from "../src/shared/rvt-api/searchDocs.ts";

test("calls the Revit API docs search API", async () => {
  const results = await searchWrapper("FilteredElementCollector", 2026, 3);
  expect(results.some((result) => result.title === "FilteredElementCollector Class")).toBe(true);
});
