import { expect, test } from "vite-plus/test";
import { projectRouteGraph } from "@pe/agent-contracts";
import { legacyGraphs } from "./legacy-test-inventory.test-support";

const projections = import.meta.glob<{ default: unknown }>(
  "../../../packages/mcps/src/pea/generated/*-graph.json",
  { eager: true },
);
test.each(legacyGraphs.map((graph) => [graph.key, graph] as const))(
  "%s Pea projection matches its inventoried legacy graph (codegen:graphs)",
  (_, graph) => {
    const projection =
      projections[`../../../packages/mcps/src/pea/generated/${graph.key}-graph.json`];
    expect(projection, `Missing projection for ${graph.key}`).toBeDefined();
    // Closure identity is checked by the artifact producer; source graph bodies carry no pin.
    const { moduleHash: _pin, ...declared } = projection!.default as Record<string, unknown>;
    expect(projectRouteGraph(graph)).toEqual(declared);
  },
);
