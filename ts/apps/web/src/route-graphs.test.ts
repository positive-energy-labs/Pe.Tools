import { expect, test } from "vite-plus/test";
import { RouteGraphWire as RouteGraphJson } from "../../../packages/agent-contracts/src/route-kernel-data";
import { routeRegistry } from "./route/registry";
import { agentFields } from "@pe/agent-contracts";

import { projectRouteRead } from "../../host/src/reads/routes";
import { routeRegistry as hostRoutes } from "../../host/src/routes.generated";
import { commands } from "@pe/agent-contracts";
import { z } from "zod";

test.each(Object.keys(routeRegistry).sort())(
  "%s wire verbs reflect the declaration without guessing placement",
  (key) => {
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
  },
);

test.each(Object.keys(routeRegistry).sort())(
  "%s admits and publishes the same typed route to Pea (codegen:routes)",
  (key) => {
    const module = routeRegistry[key]!.module;
    const declared = RouteGraphJson.parse(module.data);
    const projection = projectRouteRead(hostRoutes[key]!.host);
    expect(projection.layout).toEqual(declared.layout);
    for (const [id, verb] of Object.entries(module.data.verbs)) {
      const command = Object.entries(commands).find(([key]) => key === verb.entry)?.[1];
      if (command) expect(projection.verbs[id]!.input).toEqual(z.toJSONSchema(command.input));
    }
    for (const [id, field] of Object.entries(declared.fields)) {
      if ("schema" in field)
        expect(projection.fields[id]).toMatchObject({
          schema: z.toJSONSchema(module.host.schemas[field.schema]!, { io: "input" }),
        });
    }
    const agent = module.spec.agent !== false;
    expect(agentFields(declared.fields).map(([key]) => key)).toEqual(
      agent ? Object.keys(module.spec.fields) : [],
    );
  },
);
