import { afterEach, expect, test } from "vite-plus/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ductsSettingFields } from "@pe/agent-contracts";
import { peRoutes } from "@pe/agent-contracts/pe-api";
import { createRouteSettings } from "../src/route-settings.ts";
import { createPeRoutes } from "../src/pe-routes.ts";

const roots: string[] = [];
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-route-settings-"));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("the declared HTTP handler reads and writes settings without a Work document or running host", async () => {
  const dir = directory();
  const routes = createPeRoutes({
    registrations: [],
    heads: { observe: () => () => {} },
    store: {
      getState: async () => null,
      setState: async () => {
        throw Error("Settings must not write Work");
      },
    },
    routeSettings: createRouteSettings(dir),
  });
  const url = "http://fixture/pe/route-settings/ducts";
  const response = await routes.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: { fanFlow: "Agent design flow" }, expectedRevision: 0 }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    revision: 1,
    values: { fanFlow: "Agent design flow" },
  });
  expect(await (await routes.fetch(new Request(url))).json()).toEqual(
    createRouteSettings(dir).read("ducts"),
  );
  const refused = await routes.fetch(
    new Request(url, {
      method: "POST",
      body: JSON.stringify({ patch: { fanFlow: "stale" }, expectedRevision: 0 }),
    }),
  );
  expect(refused.status).toBe(409);
  expect(createRouteSettings(dir).read("ducts").values.fanFlow).toBe("Agent design flow");
});

test("settings survive a new store, isolate routes and users, and patch without resetting other fields", () => {
  const dir = directory();
  const declarations = { ducts: ductsSettingFields, another: ductsSettingFields };
  const store = createRouteSettings(dir, declarations);
  const changes: string[] = [];
  store.subscribe((route) => changes.push(route));
  store.set("ducts", { supplyColour: "#123456" }, 0);
  store.set("ducts", { terminalFlow: "Design CFM" }, 1);
  const reloaded = createRouteSettings(dir, declarations).read("ducts");
  expect(reloaded).toMatchObject({
    revision: 2,
    values: { supplyColour: "#123456", terminalFlow: "Design CFM" },
  });
  expect(store.read("another").values.supplyColour).toBe("#0569a5");
  expect(createRouteSettings(directory()).read("ducts").revision).toBe(0);
  expect(changes).toEqual(["ducts", "ducts"]);
  expect(peRoutes["route-settings.set"].permission).toBe("human-or-pea");
});

test("stale revisions, invalid fields and corrupt saved bytes refuse without destroying settings", () => {
  const dir = directory();
  const store = createRouteSettings(dir);
  store.set("ducts", { fanFlow: "My flow" }, 0);
  const file = join(dir, readdirSync(dir)[0]!);
  const bytes = readFileSync(file, "utf8");
  expect(() => store.set("ducts", { fanFlow: "old" }, 0)).toThrow("Settings changed");
  expect(() => store.set("ducts", { supplyColour: "red" }, 1)).toThrow();
  expect(() => store.set("ducts", { unknown: "x" }, 1)).toThrow();
  expect(() => store.set("../ducts", {}, 1)).toThrow();
  expect(readFileSync(file, "utf8")).toBe(bytes);
  writeFileSync(file, "not json");
  expect(() => store.set("ducts", { fanFlow: "reset" }, 0)).toThrow();
  expect(readFileSync(file, "utf8")).toBe("not json");
});
