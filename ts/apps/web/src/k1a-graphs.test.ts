// Keep the directory registration side effect out of contract admission tests.
vi.mock("./route/builtin-routes", () => ({ publicRoutes: { entries: () => [] } }));
import { expect, test, vi } from "vite-plus/test";
import { validateRouteGraph, type RouteGraph } from "@pe/agent-contracts";
import { indexGraph } from "./index/graph";
import { legacyGraphs as graphs } from "./legacy-test-inventory.test-support";
test.each(graphs.map((graph) => [graph.key, graph] as const))(
  "%s declares one admitted subject and kernel sets",
  (_, graph) => {
    expect(validateRouteGraph(graph as RouteGraph<any, any>)).toEqual([]);
  },
);

test("singleton catalogue keys cannot become an undeclared subject picker", () => {
  const subject = indexGraph.subjectField;
  const broken = { ...indexGraph, subjectField: { ...subject, cardinality: "many" as const } };
  expect(
    validateRouteGraph(broken).some(
      (error) => error.message === "A singleton subject requires one fixed named key",
    ),
  ).toBe(true);
});
