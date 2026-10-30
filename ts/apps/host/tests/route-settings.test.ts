import { afterEach, expect, test } from "vite-plus/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { routeSettingFields } from "@pe/agent-contracts";
import { z } from "zod";
import { field } from "../../../packages/agent-contracts/src/route-field.ts";
import type { SettingField } from "@pe/agent-contracts";
const colour = (value: string): SettingField => ({
  ...field(
    z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default(value),
    {},
  ),
  role: "setting",
});
const testFields = {
  supplyColour: colour("#0569a5"),
  returnColour: colour("#02bba4"),
  exhaustColour: colour("#fea665"),
};
const fixtureStore = (dir: string) => createRouteSettings(dir, { ducts: testFields });
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
    routeSettings: fixtureStore(dir),
  });
  const url = "http://fixture/pe/route-settings/ducts";
  const response = await routes.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: { returnColour: "#123456" }, expectedRevision: 0 }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    revision: 1,
    values: { returnColour: "#123456" },
  });
  expect(await (await routes.fetch(new Request(url))).json()).toEqual(
    fixtureStore(dir).read("ducts"),
  );
  const refused = await routes.fetch(
    new Request(url, {
      method: "POST",
      body: JSON.stringify({ patch: { returnColour: "stale" }, expectedRevision: 0 }),
    }),
  );
  expect(refused.status).toBe(409);
  expect(fixtureStore(dir).read("ducts").values.returnColour).toBe("#123456");
});

test("settings survive a new store, isolate routes and users, and patch without resetting other fields", () => {
  const dir = directory();
  const declarations = { ducts: testFields, another: testFields };
  const store = createRouteSettings(dir, declarations);
  const changes: string[] = [];
  store.subscribe((route) => changes.push(route));
  store.set("ducts", { supplyColour: "#123456" }, 0);
  store.set("ducts", { exhaustColour: "#abcdef" }, 1);
  const reloaded = createRouteSettings(dir, declarations).read("ducts");
  expect(reloaded).toMatchObject({
    revision: 2,
    values: { supplyColour: "#123456", exhaustColour: "#abcdef" },
  });
  expect(store.read("another").values.supplyColour).toBe("#0569a5");
  expect(fixtureStore(directory()).read("ducts").revision).toBe(0);
  expect(changes).toEqual(["ducts", "ducts"]);
  expect(peRoutes["route-settings.set"].permission).toBe("human-or-pea");
});

test("stale revisions, invalid fields and corrupt saved bytes refuse without destroying settings", () => {
  const dir = directory();
  const store = fixtureStore(dir);
  store.set("ducts", { returnColour: "#abcdef" }, 0);
  const file = join(dir, readdirSync(dir)[0]!);
  const bytes = readFileSync(file, "utf8");
  expect(() => store.set("ducts", { returnColour: "old" }, 0)).toThrow("Settings changed");
  expect(() => store.set("ducts", { supplyColour: "red" }, 1)).toThrow();
  expect(() => store.set("ducts", { unknown: "x" }, 1)).toThrow();
  expect(() => store.set("../ducts", {}, 1)).toThrow();
  expect(readFileSync(file, "utf8")).toBe(bytes);
  writeFileSync(file, "not json");
  expect(() => store.set("ducts", { returnColour: "reset" }, 0)).toThrow();
  expect(readFileSync(file, "utf8")).toBe("not json");
});

test("ducts declares no per-user settings; its slots and palette belong to Work", () => {
  expect(routeSettingFields).not.toHaveProperty("ducts");
  expect(() => createRouteSettings(directory()).read("ducts")).toThrow("No settings declared");
  const store = fixtureStore(directory());
  for (const key of [
    "terminalFlow",
    "fanFlow",
    "fanStatic",
    "terminalDrop",
    "componentDrop",
    "fittingCoefficient",
  ]) {
    expect(store.read("ducts").values).not.toHaveProperty(key);
    expect(() => store.set("ducts", { [key]: "Project parameter" }, 0)).toThrow();
  }
});
