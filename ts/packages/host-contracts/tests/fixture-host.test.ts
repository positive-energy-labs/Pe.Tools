import { expect, test } from "vite-plus/test";
import { hostOpCatalog } from "../src/generated/host-catalog.generated.ts";
import { createFixtureHost } from "../src/fixture-host.ts";

const catalog = ["one.read", "two.read"].map((key) => ({
  key,
  effect: "Read",
  responseSchemaJson: JSON.stringify({
    type: "object",
    required: ["value"],
    properties: { value: { type: "number" } },
  }),
}));
const call = (key: string) =>
  new Request("http://fixture/call", { method: "POST", body: JSON.stringify({ key }) });

test("every catalog entry uses the same transport and isolates returned examples", async () => {
  const host = createFixtureHost(catalog, { "one.read": { value: 1 }, "two.read": { value: 2 } });
  for (const [index, entry] of catalog.entries()) {
    expect(await (await host.fetch(call(entry.key))).json()).toEqual({ value: index + 1 });
    (host.read(entry.key) as { value: number }).value = 99;
    expect(host.read(entry.key)).toEqual({ value: index + 1 });
  }
});

test("admission refuses unknown keys, invalid responses and model writes", async () => {
  expect(() => createFixtureHost(catalog, { unknown: {} })).toThrow("not in the catalog");
  expect(() => createFixtureHost(catalog, { "one.read": { value: "bad" } })).toThrow();
  const write = hostOpCatalog.find((entry) => entry.effect === "ModelWrite")!;
  expect(() => createFixtureHost(hostOpCatalog, { [write.key]: {} })).toThrow("model write");
  const host = createFixtureHost(catalog, {});
  expect((await host.fetch(call("one.read"))).status).toBe(409);
  expect((await host.fetch(new Request("http://fixture/actions", { method: "POST" }))).status).toBe(
    404,
  );
});

test("the generated catalog schema is the fixture response authority", () => {
  const entry = hostOpCatalog.find((entry) => entry.key === "revit.catalog.loaded-families")!;
  expect(() =>
    createFixtureHost(hostOpCatalog, { [entry.key]: { families: "invalid" } }),
  ).toThrow();
});

test("graph examples preserve decoded domain objects with prototype getters", () => {
  class Scene {
    get instances() {
      return [1, 2];
    }
  }
  const scene = new Scene();
  const host = createFixtureHost([{ key: "scene", effect: "Read" }], { scene });
  expect(host.read("scene")).toBe(scene);
  expect((host.read("scene") as Scene).instances).toEqual([1, 2]);
});
