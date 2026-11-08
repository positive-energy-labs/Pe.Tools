import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { routeDirectory } from "../../../packages/agent-contracts/src/generated/route-directory.ts";
import { expect, it } from "vite-plus/test";
import { additions, boundaryCensus, legacyInventory, root, syntax, walk } from "./unification-2-census.ts";

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

it("type-only route context imports do not import a colocated runtime owner",()=>{
 const actual=boundaryCensus({
  "ts/apps/web/src/example/drawing.tsx":`import type {Context} from '#/example/route';`,
  "ts/apps/web/src/example/route.ts":`import {appAtomRegistry} from '#/shell/owner'; export type Context={};`,
  "ts/apps/web/src/example/direct.ts":`import type {PrivateOwner} from '#/shell/owner';`,
 });
 expect(actual.rawPageImports).toHaveLength(2);
 expect(actual.rawPageImports!.some(row=>row.includes("drawing.tsx"))).toBe(false);
});


it("ADR 0033 rule 7 keeps the Work write kernel free of route names, request types and files", () => {
  const names = routeDirectory.map(({ key }) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Lowercase identifiers such as openId and bindIntent are kernel vocabulary, not route types.
  const types = names.map(name => name.replace(/(^|-)([a-z])/g, (_, _dash, letter) => letter.toUpperCase()));
  const routeName = new RegExp(`(?:["'/](?:${names.join("|")})(?=[./"'-])|\\b(?:${types.join("|")})(?=[A-Z]|\\b))`, "g");
  const files = [
    "ts/apps/host/src/work-write-boundary.ts",
    "ts/apps/host/src/reads/routes.ts",
    "ts/apps/host/src/action-journal.ts",
    "ts/apps/host/src/journal-snapshot.ts",
    "ts/packages/mcps/src/shared/takeoff-action-client.ts",
    "ts/apps/host/src/document-lifetime.ts",
    "ts/packages/agent-contracts/src/write-intent.ts",
  ];
  const hits = files.filter(file => existsSync(resolve(root, file))).flatMap(file => {
    let text = readFileSync(resolve(root, file), "utf8");
    const source = syntax(text, file), tags: [number, number][] = [];
    walk(source, node => {
      // Work's binding enum shares a word with the navigation route; it is not a route reference.
      if (ts.isStringLiteral(node) && node.text === "open" && ts.isBinaryExpression(node.parent) &&
        ts.isPropertyAccessExpression(node.parent.left) && node.parent.left.name.text === "binding")
        tags.push([node.getStart(source), node.end]);
    });
    for (const [start, end] of tags.reverse()) text = text.slice(0, start) + "_".repeat(end - start) + text.slice(end);
    return text.split("\n").flatMap((line, index) => {
      routeName.lastIndex = 0;
      return routeName.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [];
    });
  });
  expect(hits).toEqual([]);
});
