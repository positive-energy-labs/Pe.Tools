import { expect, test } from "vite-plus/test";
import { validateRouteGraph } from "@pe/agent-contracts";
import { openGraph } from "../open/graph";
import { sessionsGraph } from "../sessions/graph";
import { takeoffGraph } from "../takeoff/graph";
import { selectedTakeoffPage } from "../takeoff/subject";
import { zoneAuditGraph } from "../zone-audit/graph";
import { rhvacSyncGraph } from "../rhvac-sync/graph";
import { podsGraph } from "../pods/graph";
import { podAdminGraph } from "../pod-admin/graph";
import { schedulesGraph } from "../schedules/graph";
import { scheduleSpecsGraph } from "../schedule-specs/graph";
import { parameterLinksGraph } from "../parameter-links/graph";
import { dataTablesGraph } from "../data-tables/graph";
import { grillesGraph } from "../grilles/graph";
import { bindGraph } from "../pages-bind/graph";
// TODO: repeat browser fixture renders after triage refreshes the shared generated module hashes.
for (const graph of [
  openGraph,
  sessionsGraph,
  takeoffGraph,
  zoneAuditGraph,
  rhvacSyncGraph,
  podsGraph,
  podAdminGraph,
  schedulesGraph,
  scheduleSpecsGraph,
  parameterLinksGraph,
  dataTablesGraph,
  grillesGraph,
  bindGraph,
])
  test(`${graph.key} declares one subject and one selection`, () => {
    expect(validateRouteGraph(graph as typeof openGraph)).toEqual([]);
  });
test("takeoff siblings share Work and expand all against the current roster", () => {
  for (const graph of [takeoffGraph, zoneAuditGraph, rhvacSyncGraph])
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
