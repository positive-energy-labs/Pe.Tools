import { expect, test } from "vite-plus/test";
import { validateRouteGraph } from "@pe/agent-contracts";
import { openGraph } from "../open/graph";
import { sessionsGraph } from "../sessions/graph";
import { takeoffGraph } from "./graph";
import { zoneAuditGraph } from "../zone-audit/graph";
const graphs = [openGraph, sessionsGraph, takeoffGraph, zoneAuditGraph];
for (const graph of graphs)
  test(`${graph.key} admits only verbs placed on that route`, () => {
    expect(validateRouteGraph(graph as typeof openGraph)).toEqual([]);
  });
test("different questions cannot run their sibling's commands", () => {
  expect(takeoffGraph.verbs.partition).toBeUndefined();
  expect(zoneAuditGraph.verbs.adopt).toBeUndefined();
  expect(openGraph.verbs.stop).toBeUndefined();
});
