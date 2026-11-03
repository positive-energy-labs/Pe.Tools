import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { builtinData } from "./route-kernel.fixtures.ts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
  createAdmittedRouteRegistry,
  createHostAdmittedRouteRegistry,
} from "./route-module.ts";
import type { BuiltinClosure } from "./route-module.ts";
import type { HostRouteModule } from "./host-route-admission.ts";
const neutral: HostRouteModule = {
  data: {
    ...builtinData,
    work: { route: builtinData.key, schema: "work", version: 2, migrations: { "1": "upgrade" } },
  },
  schemas: { work: z.object({ amount: z.number() }) },
  bodies: {
    upgrade: {
      kind: "migration",
      slot: "work.migrations.1",
      source: { module: "neutral.ts", export: "upgrade" },
      run: () => ({ amount: 1 }),
    },
  },
};
async function prepare(module = neutral, data = module.data) {
  const envelope: BuiltinClosure = {
    source: "builtin-closure",
    version: 1,
    data,
    hostVersion: "test",
    modules: [{ id: "neutral.ts", sha256: "a".repeat(64) }],
    variants: [{ client: "web", entry: "neutral.ts" }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    fixture: { host: true, module, closure: { envelope, fingerprint }, catalog: [] },
  });
  return inventory.prepare("fixture", fingerprint);
}
test("neutral admission preserves the full declaration without loading UI slots", async () => {
  const port = await prepare();
  const result = port.admitHost(neutral);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.route.data).toEqual(neutral.data);
  expect(Object.isFrozen(result.route.resolvedWork)).toBe(true);
  expect(Object.isFrozen(result.route.resolvedWork!.spec)).toBe(true);
  expect(port.admitUnknown(neutral).ok).toBe(false);
  expect(() => createAdmittedRouteRegistry().register(result.route as never)).toThrow();
  const registry = createHostAdmittedRouteRegistry();
  expect(() => registry.register({ ...result.route })).toThrow();
  const receipt = registry.register(result.route);
  expect(registry.resolve(result.route)).toBe(result.route);
  receipt.deactivate();
  expect(registry.resolve(result.route)).toBeNull();
  expect(() => registry.register(result.route)).toThrow();
});
test("neutral data cannot differ from the full web closure", async () => {
  expect((await prepare(neutral, { ...neutral.data, name: "other" })).admitHost(neutral).ok).toBe(
    false,
  );
});
test("missing and misbound host migrations and schemas refuse", async () => {
  const candidates: HostRouteModule[] = [
    { ...neutral, schemas: {} },
    { ...neutral, bodies: {} },
    { ...neutral, bodies: { upgrade: { ...neutral.bodies.upgrade!, slot: "panes.main.body" } } },
  ];
  for (const candidate of candidates)
    expect((await prepare(candidate)).admitHost(candidate).ok).toBe(false);
});
test("post-prepare replacement of a host body refuses", async () => {
  const port = await prepare();
  expect(
    port.admitHost({
      ...neutral,
      bodies: { upgrade: { ...neutral.bodies.upgrade!, run: () => ({ amount: 2 }) } },
    }).ok,
  ).toBe(false);
});
