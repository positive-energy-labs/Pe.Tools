import { expect, test } from "vite-plus/test";
import { module } from "../shell/admitted-module.test-fixture";
import generated from "../captures/source-closure.generated.json";
import {
  createRouteAdmission,
  createBuiltinRouteInventory,
  createAdmittedRouteRegistry,
  resolveRouteBindings,
  builtinClosureFingerprint,
} from "../../../../packages/agent-contracts/src/route-module";
import { z } from "zod";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";

const closure = () => ({
  ...generated.envelope,
  source: z.literal("builtin-closure").parse(generated.envelope.source),
  version: z.literal(1).parse(generated.envelope.version),
  data: RouteGraphJson.parse(module.data),
  variants: generated.envelope.variants.map((v) => ({
    ...v,
    client: z.enum(["web", "pea"]).parse(v.client),
  })),
});

test("production source imports admit once through the linker and exact handle registry", async () => {
  const envelope=closure(), fingerprint=await builtinClosureFingerprint(envelope);
  const inventory=createBuiltinRouteInventory({captures:{module,closure:{envelope,fingerprint},catalog:Object.entries(module.entries).map(([key,entry])=>({key,...entry.axes,uses:[]}))}});
  const result=(await inventory.prepare("captures",fingerprint)).admit(module);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const registry = createAdmittedRouteRegistry();
  const receipt = registry.register(result.route);
  expect(resolveRouteBindings(registry, result.route)?.bodies.main?.run).toBe(
    module.bodies.main.run,
  );
  for (const copy of [
    { ...result.route },
    Object.assign({}, result.route),
    new Proxy(result.route, {}),
  ]) {
    expect(registry.resolve(copy)).toBeNull();
    // @ts-expect-error copied handles have no private admission authority
    expect(() => registry.register(copy)).toThrow(/copied/);
  }
  receipt.deactivate();
  expect(registry.resolve(result.route)).toBeNull();
  expect(() => registry.register(result.route)).toThrow(/retired/);
  await expect(inventory.prepare("captures", "0".repeat(64))).rejects.toThrow(/Stale/);
});

test("a structural builtin receipt cannot claim source admission", async () => {
  const admission = await createRouteAdmission({ source: "builtin-closure" });
  expect(admission.admitUnknown(module)).toMatchObject({ ok: false });
});

test("changed source closure refuses the old inventory stamp before publishing a handle", async () => {
  const envelope = closure();
  const previous = await builtinClosureFingerprint(envelope);
  envelope.modules[0]!.sha256 = "0".repeat(64);
  expect(await builtinClosureFingerprint(envelope)).not.toBe(previous);
  const inventory = createBuiltinRouteInventory({
    captures: {
      module,
      closure: { envelope, fingerprint: previous },
      catalog: [],
    },
  });
  const result = (await inventory.prepare("captures", previous)).admit(module);
  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw Error("stale source accepted");
  expect(JSON.stringify(result.diagnostics)).toContain("closure fingerprint mismatch");
});

test("source-import evidence does not bypass semantic admission", async () => {
  const envelope = closure();
  const inventory = createBuiltinRouteInventory({
    captures: {
      module,
      closure: { envelope, fingerprint: await builtinClosureFingerprint(envelope) },
      catalog: [],
    },
  });
  const admission = await inventory.prepare("captures", await builtinClosureFingerprint(envelope));
  expect(admission.admitUnknown({ ...module, bodies: {} })).toMatchObject({ ok: false });
});
