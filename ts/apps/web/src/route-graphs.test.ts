import { expect, test } from "vite-plus/test";
import { projectRouteGraph } from "@pe/agent-contracts";
import { ductsGraph } from "./ducts/graph";
import { familiesGraph } from "./families/graph";
import { familyGraph } from "./family/graph";
import { schedulesGraph } from "./schedules/graph";
import ducts from "../../../packages/mcps/src/pea/generated/ducts-graph.json";
import families from "../../../packages/mcps/src/pea/generated/families-graph.json";
import family from "../../../packages/mcps/src/pea/generated/family-graph.json";
import schedules from "../../../packages/mcps/src/pea/generated/schedules-graph.json";

test("Pea's generated route graphs match the executable graphs (pnpm codegen:graphs)", () => {
  expect(projectRouteGraph(ductsGraph)).toEqual(ducts);
  expect(projectRouteGraph(familiesGraph)).toEqual(families);
  expect(projectRouteGraph(familyGraph)).toEqual(family);
  expect(projectRouteGraph(schedulesGraph)).toEqual(schedules);
});
