import { expect, test } from "vite-plus/test";
import { takeoffGraph } from "../takeoff/graph";
import { selectedTakeoffPage } from "../takeoff/subject";
import { zoneAuditGraph } from "../zone-audit/graph";
test("takeoff siblings share Work and expand all against the current roster", () => {
  for (const graph of [takeoffGraph, zoneAuditGraph])
    expect(graph.workRoute).toBe("takeoffs");
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
