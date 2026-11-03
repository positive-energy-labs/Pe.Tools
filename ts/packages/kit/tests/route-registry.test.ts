import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { createRouteRegistry } from "../src/route-registry.ts";
import { builtinModule, entries } from "../../agent-contracts/src/route-kernel.fixtures.ts";
import { createRouteAdmission, routeFingerprint } from "../../agent-contracts/src/route-module.ts";
import type { RouteFingerprintInput } from "../../agent-contracts/src/route-kernel-admission.ts";
async function prepare(expected?: string) {
  const bytes = new TextEncoder().encode("registry fixture closure");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const artifact: RouteFingerprintInput = {
    version: 1,
    data: builtinModule.data,
    contracts: [{ id: "contract", sha256: hash }],
    executables: [
      { client: "web", entry: "bodies.js", members: [{ path: "bodies.js", sha256: hash }] },
    ],
  };
  const port = await createRouteAdmission({
    loadedBindings: builtinModule,
    artifact,
    expectedFingerprint: expected ?? (await routeFingerprint(artifact)),
    contracts: [{ id: "contract", bytes }],
    executables: [
      {
        client: "web",
        entry: "bodies.js",
        resolved: true,
        members: [{ path: "bodies.js", bytes }],
      },
    ],
    catalog: Object.entries(entries).map(([key, entry]) => ({ key, ...entry.axes, uses: [] })),
  });
  return { port, module: { ...builtinModule, artifact } };
}
test("only exact A-issued handles publish; retirement revokes mount bindings", async () => {
  const { port, module } = await prepare();
  const result = port.admit(module);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const routes = createRouteRegistry();
  let notifications = 0;
  routes.subscribe(() => notifications++);
  const copied = Object.assign({}, result.route);
  expect(() => routes.register(copied, () => null)).toThrow(/Foreign/);
  expect(routes.keys()).toEqual([]);
  expect(notifications).toBe(0);
  const remove = routes.register(result.route, () => null);
  expect(routes.resolve(result.route)).toBe(result.route);
  expect(routes.resolve(copied)).toBeNull();
  expect(routes.bindings(result.route)).not.toBeNull();
  expect(routes.keys()).toEqual(["tiny"]);
  expect(() => routes.register(result.route, () => null)).toThrow(/already registered/);
  remove();
  remove();
  expect(routes.resolve(result.route)).toBeNull();
  expect(routes.bindings(result.route)).toBeNull();
  expect(() => routes.register(result.route, () => null)).toThrow(/retired/);
  expect(notifications).toBe(2);
});
test("body/schema mutations and stale stamps cannot publish", async () => {
  const { port, module } = await prepare();
  const stale = await prepare("0".repeat(64));
  const candidates = [
    port.admitUnknown({
      ...module,
      bodies: {
        ...module.bodies,
        calculate: { ...module.bodies.calculate, run: () => ({ total: 999 }) },
      },
    }),
    port.admitUnknown({ ...module, schemas: { ...module.schemas, number: module.schemas.text } }),
    stale.port.admit(stale.module),
  ];
  const routes = createRouteRegistry();
  for (const result of candidates) {
    expect(result.ok).toBe(false);
    if (result.ok) routes.register(result.route, () => null);
  }
  expect(routes.revision()).toBe(0);
  expect(routes.keys()).toEqual([]);
});
