import { expect, test } from "vite-plus/test";
import { RouteGraphJson } from "../../../packages/agent-contracts/src/route-kernel-data";
import { builtinRouteKeys, typedBuiltin } from "./route/builtin-inventory";
import { agentFields } from "@pe/agent-contracts";

const projections = import.meta.glob<{ default: unknown }>(
  "../../../packages/mcps/src/pea/generated/*-graph.json",
  { eager: true },
);

test.each(builtinRouteKeys)(
  "%s admits and publishes the same typed route to Pea (codegen:routes)",
  (key) => {
    const module = typedBuiltin(key);
    const declared = RouteGraphJson.parse(module.data);
    const projection = projections[`../../../packages/mcps/src/pea/generated/${key}-graph.json`];
    expect(projection, `Missing projection for ${key}`).toBeDefined();
    // Pea receives JSON data; executable drawing/command bodies stay in the typed module.
    expect(projection!.default).toEqual(JSON.parse(JSON.stringify(declared)));
    const agent = module.spec.agent !== false;
    expect(agentFields(declared.fields).map(([key]) => key)).toEqual(
      agent ? Object.keys(module.spec.fields) : [],
    );
  },
);
