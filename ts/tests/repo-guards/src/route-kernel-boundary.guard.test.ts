import { expect, it } from "vite-plus/test";
import { additions, boundaryCensus, legacyInventory } from "./unification-2-census.ts";

it("scans source despite mocked imports, aliases, exports and malformed fixture code", () => {
  const actual = boundaryCensus({
    "ts/apps/web/src/example/body.ts": `
      vi.mock('#/shell/page', () => ({}));
      import * as hidden from '#/shell/page';
      export { createViewOwner as innocent } from '#/route/view-owner';
      const mode = state['fixture'];
      import(variable);
      const broken = ;
    `,
    "ts/packages/kit/src/route-registry.ts": `const registry = { register(x: RouteRegistration) {} }`,
  });
  expect(actual.rawPageImports).toHaveLength(2);
  expect(actual.fixtureMode).toHaveLength(1);
  expect(actual.uncheckedRegistry).toHaveLength(1);
  expect(actual.malformedSources!.length).toBeGreaterThan(0);
  expect(actual.dynamicModules).toHaveLength(1);
});

it("follows re-export wrappers to the private writer", () => {
  const actual = boundaryCensus({
    "ts/apps/web/src/example/body.ts": `import { innocent } from 'wrapper.ts'`,
    "wrapper.ts": `export { createViewOwner as innocent } from '#/route/view-owner'`,
  });
  expect(actual.rawPageImports).toHaveLength(1);
});

it("allows narrow PagePort contracts and the admitted registry door", () => {
  const actual = boundaryCensus({
    "ts/apps/web/src/example/body.ts": `import type { PagePort } from '@pe/agent-contracts/route-kernel-page';`,
    "ts/packages/kit/src/route-registry.ts": `import type { AdmittedRoute } from "@pe/agent-contracts/route-kernel-admission"; const registry = { register(x: AdmittedRoute) {} }`,
  });
  expect(Object.values(actual).flat()).toEqual([]);
});

it("inventories registered, standalone, aliased, namespace and dynamic Pod legacy doors", () => {
  const input = {
    "ts/apps/web/src/example/route.tsx": `
      import { mountRoute as mount, routeFromGraph as router } from '#/shell/mount';
      import * as shell from '#/shell/mount';
      import { registerLegacyGraph as register } from '#/shell/legacy-route-door';
      import { registerLegacyModule as load } from '#/shell/legacy-route-door';
      const alias = mount;
      const body = alias(graph, adapters);
      const route = router(graph, adapters);
      const standalone = shell.mountRoute(other, adapters);
      register(graph, body);
      function pod() { return load(row, bundle); }
    `,
    "ts/apps/web/src/example/graph.ts": `export const exampleGraph: RouteGraph = {};`,
  };
  const { sites, graphs } = legacyInventory(input);
  expect(sites.legacyMounts).toHaveLength(2);
  expect(sites.legacyRouterMounts).toHaveLength(1);
  expect(sites.legacyRegistrations).toHaveLength(1);
  expect(sites.legacyPodLoaders).toHaveLength(1);
  expect(graphs).toEqual([{ file: "ts/apps/web/src/example/graph.ts", symbol: "exampleGraph" }]);
  expect(additions(sites, {})).toHaveLength(6);
  expect(additions({}, sites)).toEqual([]);
  const moved = legacyInventory(
    Object.fromEntries(Object.entries(input).map(([file, text]) => [file, "\n\n" + text])),
  );
  expect(moved.sites).toEqual(sites);
  const replacement = legacyInventory({
    ...input,
    "ts/apps/web/src/example/graph.ts": `export const replacementGraph: RouteGraph = {};`,
  });
  expect(additions(replacement.sites, sites)).toEqual([
    "legacyGraphs: ts/apps/web/src/example/graph.ts#replacementGraph",
  ]);
});

it("removing an earlier registration cannot rename surviving sites", () => {
  const file = "ts/apps/web/src/route/builtin-routes.tsx";
  const preamble = `import { registerLegacyGraph as register } from '#/shell/legacy-route-door';`;
  const before = legacyInventory({
    [file]: preamble + `register(first, body); register(second, body);`,
  });
  const after = legacyInventory({ [file]: preamble + `register(second, body);` });
  expect(additions(after.sites, before.sites)).toEqual([]);
  expect(before.sites.legacyRegistrations).toHaveLength(2);
  expect(after.sites.legacyRegistrations).toHaveLength(1);
});
