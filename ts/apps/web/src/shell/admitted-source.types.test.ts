import { createHash } from "node:crypto";
import { createElement, type ReactNode } from "react";
import { expect, it } from "vite-plus/test";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { PageOf } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import {
  builtinData,
  builtinBodies,
  builtinModule,
  schemas,
  entries,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteAdmission,
  createAdmittedRouteRegistry,
  resolveRouteBindings,
  routeFingerprint,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import { createPagePolicy } from "./page-port";

const bodies: BodyBindings<typeof builtinData, typeof schemas, typeof entries, ReactNode> = {
  ...builtinBodies,
  main: {
    ...builtinBodies.main,
    run: (ctx) => createElement("span", null, ctx.page.read().density),
  },
};
const sourceModule = { ...builtinModule, bodies };

it("retains a React builtin through checked admission and resolution without another Page schema", async () => {
  const bytes = new TextEncoder().encode("builtin witness closure");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifact = {
    ...sourceModule.artifact,
    contracts: [{ id: "kernel", sha256 }],
    executables: [
      { client: "web" as const, entry: "bodies.js", members: [{ path: "bodies.js", sha256 }] },
    ],
  };
  const port = await createRouteAdmission({
    loadedBindings: sourceModule,
    artifact,
    expectedFingerprint: await routeFingerprint(artifact),
    contracts: [{ id: "kernel", bytes }],
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
  const admitted = port.admit({ ...sourceModule, artifact });
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(admitted.route);
  try {
    const route = registry.resolve(admitted.route);
    if (!route) throw Error("Missing admitted route");
    const bindings = resolveRouteBindings(registry, route);
    if (!bindings) throw Error("Missing admitted bindings");
    const retained: typeof bodies = bindings.bodies;
    expect(retained.main.run).toBe(bodies.main.run);
    const policy = createPagePolicy(route.data, bindings.schemas, () => "verified");
    const initial = policy.initial();
    if (!initial.ok) throw Error(initial.reason);
    const page: PageOf<typeof builtinData, typeof schemas> = initial.value;
    const density: number = page.density;
    expect(density).toBe(1);
    expect(
      policy.prepare(page, { density: 2 }, { kind: "human", source: "setting", history: "replace" })
        .ok,
    ).toBe(true);
    expect(
      policy.prepare(
        page,
        { search: "forbidden" },
        { kind: "human", source: "setting", history: "replace" },
      ).ok,
    ).toBe(false);
    // @ts-expect-error an admitted pane still cannot treat a query as a setting
    const illegal: Parameters<Parameters<typeof retained.main.run>[0]["page"]["set"]>[0] = "search";
    void illegal;
  } finally {
    registration.deactivate();
  }
  expect(resolveRouteBindings(registry, admitted.route)).toBeNull();
});
