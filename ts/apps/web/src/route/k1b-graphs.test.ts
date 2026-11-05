import { expect, test } from "vite-plus/test";
import { takeoffGraph } from "../takeoff/graph";
import { selectedTakeoffPage } from "../takeoff/subject";
test("takeoff Work expands all against the current roster", () => {
  expect(takeoffGraph.workRoute).toBe("takeoffs");
  expect(
    selectedTakeoffPage(
      { views: "all", zones: "all" },
      { views: [{ id: "View, A", label: "A" }], zones: [{ id: "zone-a", label: "A" }] },
    ),
  ).toEqual({ views: ["View, A"], zones: ["zone-a"] });
  expect(() => selectedTakeoffPage({ views: "all", zones: [] })).toThrow("roster");
  expect(() =>
    selectedTakeoffPage(
      { views: [], zones: "all" },
      { views: [], zones: [], zonesComplete: false },
    ),
  ).toThrow("explicit zones");
});
