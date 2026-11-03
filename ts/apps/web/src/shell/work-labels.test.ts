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

const fieldsOf = (schema: z.ZodType): string[] => {
  let inner: z.ZodType = schema;
  // Unwrap pipes, defaults and optionals down to the object the Work document is.
  for (let i = 0; i < 8 && !(inner instanceof z.ZodObject); i++) {
    const def = (
      inner as unknown as { def: { in?: z.ZodType; innerType?: z.ZodType; schema?: z.ZodType } }
    ).def;
    inner = def.in ?? def.innerType ?? def.schema ?? inner;
  }
  return inner instanceof z.ZodObject ? Object.keys(inner.shape) : [];
};

test("every Work field a route can write has a declared name for History and Inputs", () => {
  const unnamed: string[] = [];
  for (const graph of graphs) {
    const fields = fieldsOf(graph.work!);
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
