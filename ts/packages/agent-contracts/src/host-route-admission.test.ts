import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { captureHostModule } from "./host-route-admission.ts";
import type { HostRouteModule } from "./host-route-admission.ts";

import { builtinData } from "./route-kernel.fixtures.ts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
  createAdmittedRouteRegistry,
  createHostAdmittedRouteRegistry,
} from "./route-module.ts";
import type { BuiltinClosure } from "./route-module.ts";

const base: HostRouteModule = {
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
const neutral: HostRouteModule = {
  ...base,
  workState: {
    route: base.data.key,
    title: base.data.name,
    description: base.data.directory.summary,
    schema: base.schemas.work!,
    schemaVersion: 2,
    migrations: { 1: base.bodies.upgrade!.run },
  },
};
async function prepare(module = neutral, data = module.data) {
  const envelope: BuiltinClosure = {
    source: "builtin-closure",
    version: 1,
    data,

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

test("complete Work spec is required and every host-run export is captured", async () => {
  const workState = {
    ...neutral.workState!,
    finds: ["search"],
    editable: [["amount"]],
    reconcileEdit: (next: unknown, patches: readonly unknown[]) => ({ next, patches }),
  };
  const module = { ...neutral, workState };
  const port = await prepare(module);
  expect(port.admitHost(module).ok).toBe(true);
  for (const candidate of [
    { ...module, workState: undefined },
    { ...module, workState: { ...workState, route: "wrong" } },
    { ...module, workState: { ...workState, schemaVersion: 3 } },
    { ...module, workState: { ...workState, schema: z.object({}) } },
    { ...module, workState: { ...workState, reconcileEdit: () => null } },
    { ...module, workState: { ...workState, finds: [] } },
    { ...module, workState: { ...workState, editable: [] } },
    { ...module, workState: { ...workState, migrations: { 1: () => null } } },
  ])
    expect(port.admitHost(candidate).ok).toBe(false);
  expect(
    (await prepare({ ...module, workState: undefined })).admitHost({
      ...module,
      workState: undefined,
    }).ok,
  ).toBe(false);
  for (const key of ["reconcileEdit"] as const)
    expect(() =>
      captureHostModule({ ...module, workState: { ...workState, [key]: "not executable" } }),
    ).toThrow();
});

test("host write admission is callable, owner-only and captured before prepare yields", async () => {
  const admit = async () => null;
  const module = { ...neutral, admit };
  const port = await prepare(module);
  expect(port.admitHost(module).ok).toBe(true);
  for (const candidate of [
    { ...neutral },
    { ...module, admit: undefined },
    { ...module, admit: async () => null },
    { ...module, admit: "browser callback" as never },
  ])
    expect(port.admitHost(candidate).ok).toBe(false);
  expect(() => captureHostModule({ ...neutral, admit: "not callable" })).toThrow();
  const { work: _work, ...data } = neutral.data;
  const noWork = {
    ...module,
    data: { ...data, capabilities: [] },
    workState: undefined,
    bodies: {},
  };
  expect((await prepare(noWork)).admitHost(noWork).ok).toBe(false);
});
