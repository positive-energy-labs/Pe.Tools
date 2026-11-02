// Keep the directory registration side effect out of contract admission tests.
vi.mock("./route/builtin-routes", () => ({ publicRoutes: { entries: () => [] } }));
import { expect, test, vi } from "vite-plus/test";
import { validateRouteGraph, type RouteGraph } from "@pe/agent-contracts";
import { ductsGraph } from "./ducts/graph";
import { fansGraph } from "./fans/graph";
import { familiesGraph } from "./families/graph";
import { familyGraph } from "./family/graph";
import { roomsGraph } from "./rooms/graph";
import { spaceGraph } from "./space/graph";
import { settingsGraph } from "./settings/graph";
import { designSystemGraph } from "./design-system/graph";
import { indexGraph } from "./index/graph";
import { opsGraph } from "./ops/graph";
import { ductLossGraph } from "./duct-loss/graph";
import { chatGraph } from "./chat/graph";
const graphs = [ductsGraph, fansGraph, familiesGraph, familyGraph, roomsGraph, spaceGraph, settingsGraph, designSystemGraph, indexGraph, opsGraph, ductLossGraph, chatGraph(() => ({ thread: "" }))];
test.each(graphs.map(graph => [graph.key, graph] as const))("%s declares one admitted subject and kernel sets", (_, graph) => {
 expect(validateRouteGraph(graph as RouteGraph<any, any>)).toEqual([]);
});

test.each(graphs.map(graph => [graph.key, graph] as const))("%s binds its subject to declared readings", (_, graph) => {
 const errors = validateRouteGraph(graph as RouteGraph<any, any>);
 expect(errors.filter(error => error.path.startsWith("subjectField"))).toEqual([]);
});

test("singleton catalogue keys cannot become an undeclared subject picker", () => {
  const subject = indexGraph.subjectField;
  const broken = { ...indexGraph, subjectField: { ...subject, cardinality: "many" as const } };
  expect(validateRouteGraph(broken).some(error => error.message === "A singleton subject requires one fixed named key")).toBe(true);
});
