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
