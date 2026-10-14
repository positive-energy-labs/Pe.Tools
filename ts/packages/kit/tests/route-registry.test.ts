import { expect, test } from "vite-plus/test";
import { createRouteRegistry, defineRoutePlugin } from "../src/route-registry";

test("a public registration supplies its manifest, hosted view and action attribution together", async () => {
  const registry = createRouteRegistry();
  const hosted = () => "mounted";
  const manifest = { key: "new-route", name: "New route", runs: ["new.apply"] };
  const remove = registry.register(defineRoutePlugin({ manifest, hosted }));
  expect(registry.keys()).toEqual(["new-route"]);
  expect(registry.get("new-route")).toEqual({ manifest, hosted });
  expect(registry.actionRoute("new.apply")).toBe("new-route");
  expect(() => registry.register(defineRoutePlugin({ manifest, hosted }))).toThrow(
    /already registered/,
  );
  expect(() => registry.require("missing")).toThrow(/not registered/);
  registry.register(
    defineRoutePlugin({ manifest: { key: "other", name: "Other", runs: ["new.apply"] }, hosted }),
  );
  expect(registry.actionRoute("new.apply")).toBeNull();
  await remove();
  expect(registry.get("new-route")).toBeUndefined();
  expect(registry.actionRoute("new.apply")).toBe("other");
});
