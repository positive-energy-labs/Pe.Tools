import { expect, test } from "vite-plus/test";
import { z } from "zod";
import type { RouteGraph } from "@pe/agent-contracts";
import { dataTablesGraph } from "../data-tables/graph";
import { familyGraph } from "../family/graph";
import { parameterLinksGraph } from "../parameter-links/graph";
import { podsGraph } from "../pods/graph";
import { roomsGraph } from "../rooms/graph";
import { takeoffGraph } from "../takeoff/graph";
import { workPathName } from "./work-writes";

const graphs = [
  dataTablesGraph,
  familyGraph,
  parameterLinksGraph,
  podsGraph,
  roomsGraph,
  takeoffGraph,
] as RouteGraph<unknown, unknown>[];

test("every Work field a route can write has a declared name for History and Inputs", () => {
  const unnamed: string[] = [];
  for (const graph of graphs) {
    const fields = Object.keys(z.toJSONSchema(graph.work!, { io: "input" }).properties ?? {});
    expect(fields.length, `${graph.key} Work schema is an object`).toBeGreaterThan(0);
    for (const field of fields) {
      const family = graph.cells?.find((cell) => (cell.segment ?? cell.key) === field);
      // A cell family names its own rows by key; probe with a sample row key.
      const name = workPathName(graph, family?.segment === null ? [field] : [field, "k"]);
      if (!name) unnamed.push(`${graph.key}.${field}`);
    }
  }
  expect(unnamed).toEqual([]);
});

test("admitted ducts and fans name every Work field for history", async () => {
  const ducts = await import("../ducts/neutral.ts");
  const fans = await import("../fans/neutral.ts");
  for (const { data, schemas } of [
    { data: ducts.ductsData, schemas: ducts.schemas },
    { data: fans.fansData, schemas: fans.schemas },
  ]) {
    const declared = new Set([...Object.keys(data.cells), ...Object.keys(data.workFields)]);
    expect(
      Object.keys(schemas.work.shape).filter((key) => !declared.has(key)),
      data.key,
    ).toEqual([]);
  }
});
