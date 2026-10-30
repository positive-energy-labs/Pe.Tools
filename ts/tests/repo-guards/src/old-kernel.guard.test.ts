/**
 * ADR 0026, Seed and cutover: the count of old-kernel consumer files only decreases.
 * Kernel dirs exempt from this consumer census: ts/apps/web/src/route/ (old kernel),
 * ts/apps/web/src/shell/ (kernel), ts/packages/kit/.
 * Production means app/package src, excluding tests, lab, prototypes and design-system,
 * as in kit-census. Each baseline value is one consumer file, not its import count.
 * Source census only: computed module specifiers and transitive wrappers are not visible.
 */
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vite-plus/test";
import {
  ROOT,
  WEB,
  imports,
  modulePath,
  productionFiles,
  ratchet,
  readImports,
  type Import,
} from "./import-census.ts";
import baseline from "./old-kernel.baseline.json" with { type: "json" };

const OLD = new Map(
  [
    ["entity-route", null],
    ["use-route", null],
    ["manifest", null],
    ["presentation", null],
    ["keys", null],
    ["flow", null],
    ["inspector", null],
    ["pod-plugins", null],
    ["surface-manifests", null],
    ["route-owner", null],
    ["shell-probe", null],
    ["entity", "EntityRouteView"],
    ["shell", null],
    ["situation", "Situation"],
    ["stage", "StageDecl"],
  ].map(([module, name]) => [modulePath(WEB + "index.ts", `#/route/${module}`), name]),
);

// This ratchet covers physical retirement too: an unused executor must not return unnoticed.
const RETIRED = [
  "route/entity-route",
  "route/entity",
  "route/route-owner",
  "route/route-owner.test",
  "route/situation",
  "route/situation-lamp",
  "route/stage",
  "route/flow",
  "route/inspector",
  "route/pod-plugins",
  "route/surface-manifests",
  "route/shell-probe",
  "route/shell-probe.test",
  "takeoff/manifest",
];
const LEGACY_EXPORTS = new Set([
  "RouteShell",
  "useRoute",
  "defineRoute",
  "RouteManifest",
  "RouteAction",
  "Ctx",
  "BoundCommands",
  "bindCommands",
  "invokeBoundCommand",
  "presentation",
]);

it("retired kernel modules stay deleted (ADR 0026 D3/D7)", () => {
  const returned = RETIRED.flatMap((path) => [".ts", ".tsx"].map((ext) => WEB + path + ext)).filter(
    (path) => existsSync(resolve(ROOT, path)),
  );
  expect(returned).toEqual([]);
});

function oldImport(file: string, entry: Import): boolean {
  const path = modulePath(file, entry.module);
  if (path === modulePath(WEB + "index.ts", "#/takeoff/manifest")) return true;
  if (["#/route", "#/route/index"].some((module) => path === modulePath(WEB + "index.ts", module)))
    return entry.names === null || entry.names.some((name) => LEGACY_EXPORTS.has(name));
  if (path === "@pe/kit/lang/pane")
    return entry.names === null || entry.names.includes("PaneSplit");
  if (!OLD.has(path)) return false;
  const name = OLD.get(path);
  return name == null || entry.names === null || entry.names.includes(name);
}

it("old-kernel consumer files can only shrink (ADR 0026)", () => {
  // The completed consumer ratchet is a hard zero; no allowance can be reintroduced.
  expect(baseline).toEqual({});
  const sources = ["apps", "packages"].flatMap((kind) =>
    readdirSync(resolve(ROOT, kind)).flatMap((name) => {
      const src = `${kind}/${name}/src`;
      return existsSync(resolve(ROOT, src)) ? productionFiles(src) : [];
    }),
  );
  const actual = sources.filter(
    (file) =>
      !file.startsWith("packages/kit/") &&
      !file.startsWith(WEB + "route/") &&
      !file.startsWith(WEB + "shell/") &&
      readImports(file).some((entry) => oldImport(file, entry)),
  );
  expect(
    ratchet(actual, baseline),
    "ADR 0026: migrate consumers to shell/; never add old-kernel.baseline.json entries. " +
      "When a file stops importing the old kernel, remove its entry to shrink the baseline.",
  ).toEqual({ violations: [], stale: [] });
});

it("counts imported names before aliases, type imports and namespace access", () => {
  const file = WEB + "family/example.tsx";
  const source = `
    import { EntityRouteView as View } from '../route/entity.tsx';
    import type { StageDecl as Stage } from '#/route/stage';
    import { useChooseTarget } from '#/route/shell';
    import { SituationAction } from '#/route/situation-verbs';
    import { Pane } from '@pe/kit/lang/pane';
    import { PaneSplit as Split } from '@pe/kit/lang/pane';
    import * as kernel from '#/route/shell';
    export { Situation } from '#/route/situation';
    const kernel = import('#/route/entity-route');
  `;
  expect(imports(source, file).map((entry) => oldImport(file, entry))).toEqual([
    true,
    true,
    true,
    false,
    false,
    true,
    true,
    true,
    true,
  ]);
});

it("rejects a replacement consumer even when the total count stays unchanged", () => {
  expect(ratchet(["new.ts"], { "retired.ts": 1 })).toEqual({
    violations: ["new.ts"],
    stale: ["retired.ts"],
  });
});

it("recognizes retired execution, type doors and barrel aliases", () => {
  const file = WEB + "family/example.tsx";
  const source = `
    import { useRoute as useOld } from '#/route';
    export type { RouteManifest } from '../route/manifest';
    import { refuse } from '#/route';
    import { takeoffGraph } from '#/takeoff/graph';
    const owner = require('../route/route-owner.ts');
    export * from '#/takeoff/manifest';
  `;
  expect(imports(source, file).map((entry) => oldImport(file, entry))).toEqual([
    true,
    true,
    false,
    false,
    true,
    true,
  ]);
});
