import { expect, it } from "vite-plus/test";
import { additions, boundaryCensus } from "./unification-2-census.ts";

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

it("keeps admitted Place composition private without permitting body or re-export escapes", () => {
  const actual = boundaryCensus({
    "ts/apps/web/src/chat/owner.tsx": `import { useWorkbench } from 'provider.ts'; const mode = place.fixture; export const ChatOwner = () => null;`,
    "ts/apps/web/src/chat/chat-shell.tsx": `import { ChatOwner } from '#/chat/owner';`,
    "ts/apps/web/src/route/builtin-routes.tsx": `const ChatRoute = () => import('#/chat/chat-shell');`,
    "provider.ts": `import { appAtomRegistry } from '#/shell/owner'; export const useWorkbench = () => appAtomRegistry;`,
    "ts/apps/web/src/example/body.ts": `import { useWorkbench } from 'provider.ts'; const mode = state.fixture;`,
  });
  expect(actual.rawPageImports).toHaveLength(1);
  expect(actual.rawPageImports![0]).toContain("example/body.ts");
  expect(actual.fixtureMode).toHaveLength(1);
  expect(actual.fixtureMode![0]).toContain("example/body.ts");
  const escape = boundaryCensus({
    "ts/apps/web/src/chat/owner.tsx": `export { createViewOwner } from '#/route/view-owner';`,
    "ts/apps/web/src/example/body.ts": `import { createViewOwner } from '#/chat/owner';`,
    "ts/apps/web/src/route/builtin-routes.tsx": `import { appAtomRegistry } from '#/shell/owner';`,
  });
  expect(escape.rawPageImports).toHaveLength(3);
});


it("type-only route context imports do not import a colocated runtime owner",()=>{
 const actual=boundaryCensus({
  "ts/apps/web/src/example/drawing.tsx":`import type {Context} from '#/example/route';`,
  "ts/apps/web/src/example/route.ts":`import {appAtomRegistry} from '#/shell/owner'; export type Context={};`,
  "ts/apps/web/src/example/direct.ts":`import type {PrivateOwner} from '#/shell/owner';`,
 });
 expect(actual.rawPageImports).toHaveLength(2);
 expect(actual.rawPageImports!.some(row=>row.includes("drawing.tsx"))).toBe(false);
});


import { kernelRouteInventory, kernelRouteFloors } from "./kernel-route-names-census.ts";
import kernelRoutes from "./kernel-route-names.baseline.json" with { type: "json" };

it("ADR 0033 rule 7 inventories every kernel path and ratchets route sites", () => {
  const actual = kernelRouteInventory(kernelRoutes.paths);
  expect(actual.paths, "Enroll every discovered kernel path; no missing or silently skipped files").toEqual(kernelRoutes.paths);
  expect(additions(actual.sites, kernelRoutes.sites)).toEqual([]);
});

it("ADR 0033 rule 7 allowances only shrink against every committed floor", () => {
  for (const floor of kernelRouteFloors())
    expect(additions(kernelRoutes.sites, floor.sites)).toEqual([]);
});
