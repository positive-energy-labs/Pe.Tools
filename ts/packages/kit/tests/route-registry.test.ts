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
  const { commands } = await import("@pe/agent-contracts");
  const graph = {
    key: "rooms",
    address: "rooms",
    name: "Rooms",
    fields: {},
    readings: {},
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
