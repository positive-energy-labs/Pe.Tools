import { expect, test } from "vite-plus/test";
import { RouteGraphWire as RouteGraphJson } from "../../../packages/agent-contracts/src/route-kernel-data";
import { routeRegistry } from "./route/registry";
import { agentFields } from "@pe/agent-contracts";

const projections = import.meta.glob<{ default: unknown }>(
  "../../../packages/mcps/src/pea/generated/*-graph.json",
  { eager: true },
);

test.each(Object.keys(routeRegistry).sort())("%s wire verbs reflect the declaration without guessing placement", (key) => {
  const { spec, data } = routeRegistry[key]!.module;
  expect(data.band).toEqual([]);
  for (const pane of Object.values(data.panes)) expect(pane.verbs).toEqual([]);
  expect(Object.keys(data.verbs)).toEqual(Object.keys(spec.commands));
  for (const [id, command] of Object.entries(spec.commands)) {
    const verb = data.verbs[id]!;
    expect("entry" in verb && verb.entry).toBe(command.entry);
    expect(verb.label).toBe(command.label);
    expect(verb.review).toBe("plan" in command ? "shown" : "none");
    expect(verb.effect).toBe(command.contract.axes.effect);
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
