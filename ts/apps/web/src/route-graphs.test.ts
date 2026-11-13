import { expect, test } from "vite-plus/test";
import { RouteGraphWire as RouteGraphJson } from "../../../packages/agent-contracts/src/route-kernel-data";
import { routeRegistry } from "./route/registry";
import { agentFields } from "@pe/agent-contracts";

const projections = import.meta.glob<{ default: unknown }>(
  "../../../packages/mcps/src/pea/generated/*-graph.json",
  { eager: true },
);

test.each(Object.keys(routeRegistry).sort())("%s wire verbs reflect the declaration and place each verb once", (key) => {
  const { spec, data } = routeRegistry[key]!.module;
  expect(data.band).toEqual([...spec.band]);
  // The band and the panes together hold every declared verb exactly once.
  expect([...data.band, ...Object.values(data.panes).flatMap((pane) => (Array.isArray(pane.verbs) ? pane.verbs : []))].sort()).toEqual(Object.keys(spec.verbs).sort());
  expect(Object.keys(data.verbs)).toEqual(Object.keys(spec.verbs));
  for (const [id, declared] of Object.entries(spec.verbs)) {
    const verb = data.verbs[id]!;
    expect("entry" in verb && verb.entry).toBe(declared.handle.key);
    expect(verb.label).toBe(declared.label);
    expect(verb.review).toBe(declared.handle.plan ? "shown" : "none");
    expect(verb.effect).toBe(declared.handle.effect);
    expect(Object.keys(verb).sort()).toEqual(["effect", "entry", "label", "review"]);
  }
});

test.each(Object.keys(routeRegistry).sort())(
  "%s admits and publishes the same typed route to Pea (codegen:routes)",
  (key) => {
    const module = routeRegistry[key]!.module;
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
