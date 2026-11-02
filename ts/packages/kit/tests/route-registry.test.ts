import { expect, test } from "vite-plus/test";
import { createRouteRegistry } from "../src/route-registry.ts";

test("a route manifest cannot claim another tool's command attribution", () => {
  const routes = createRouteRegistry();
  const pod = { key: "pod.custom", name: "Custom", actions: { save: { does: "settings.write" } } };
  routes.register({ manifest: pod, hosted: () => null });
  expect(routes.actionRoute("settings.write")).toBeNull();
  const remove = routes.register({ manifest: { key: "pods", name: "Pods" }, hosted: () => null });
  expect(routes.actionRoute("settings.write")).toBe("pods");
  remove();
  expect(routes.actionRoute("settings.write")).toBeNull();
  expect(routes.get("pod.custom")?.manifest.name).toBe("Custom");
});

test("a kernel registration exposes the executable graph itself and retires its command route", async () => {
  const { commands, field } = await import("@pe/agent-contracts");
  const {commands: builtins} = await import("@pe/agent-contracts");
  const schema = builtins["rooms.merge"].input.shape.work;
  const graph = {
    subjectField:{field:"catalog" as const,noun:"catalog",keyKind:"name" as const,cardinality:"one" as const,roster:"catalog",detail:"catalog",pane:"body",show:(id:string)=>id},
    key: "rooms",
    address: "rooms",
    name: "Rooms",
    fields: {catalog:{...field(schema, {}, {encode:JSON.stringify,decode:JSON.parse}),role:"subject" as const},selected:{...field(schema, {}, {encode:JSON.stringify,decode:JSON.parse}),role:"selection" as const}},
    readings: {catalog:{kind:"derive" as const,source:"catalog",retire:"never" as const}},
    verbs: {
      merge: {
        kind: "command" as const,
        review: "shown" as const,
        label: "Merge",
        does: "rooms.merge",
        input: commands["rooms.merge"].input,
      },
    },
    panes: { body: { label: "Rooms", purpose: "Inspect", draws: [], verbs: [] } },
    layout: { kind: "pane" as const, id: "body" },
    stages: { inspect: { word: "Inspect", panes: ["body"], verbs: ["merge"] } },
  };
  const routes = createRouteRegistry();
  const retire = routes.registerGraph(graph, () => null);
  expect(routes.get("rooms")?.manifest).toBe(graph);
  expect(routes.get("rooms")?.graph).toBe(graph);
  expect(routes.actionRoute("rooms.merge")).toBe("rooms");
  retire();
  expect(routes.actionRoute("rooms.merge")).toBeNull();
});
