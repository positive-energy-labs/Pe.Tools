/**
 * ADR 0026, Readings: routes reach the host through one kernel door.
 * New kernel: ts/apps/web/src/shell/ (reserved, not created yet), exempt below.
 * Existing kernel exemptions are exact files, not the whole route/ or host/ directory.
 * Source census only: computed module specifiers and transitive wrappers are not visible.
 */
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
import baseline from "./host-door.baseline.json" with { type: "json" };

const KERNEL = new Set(
  [
    "route/presentation.ts",
    "route/route-owner.ts",
    "readings.ts",
    "route/entity-route.ts",
    "route/host.ts",
  ].map((path) => WEB + path),
);
const HOST_CLIENT = modulePath(WEB + "index.ts", "#/host/client");
const ACTION_CLIENT = resolve(ROOT, "packages/mcps/src/shared/takeoff-action-client").replaceAll(
  "\\",
  "/",
);

function hostImport(file: string, entry: Import): boolean {
  const path = modulePath(file, entry.module);
  if (path === ACTION_CLIENT)
    return !entry.names?.length || entry.names.some((name) => name !== "actionResult");
  return (
    path === HOST_CLIENT ||
    !!entry.names?.some((name) => name === "callHostRpc" || name === "hostFetch") ||
    (entry.names === null && path === modulePath(file, "#/host/runtime"))
  );
}

it("host door bypasses can only shrink (ADR 0026)", () => {
  const actual = productionFiles("apps/web/src").filter(
    (file) =>
      !KERNEL.has(file) &&
      !file.startsWith(WEB + "shell/") &&
      readImports(file).some((entry) => hostImport(file, entry)),
  );
  expect(
    ratchet(actual, baseline),
    "ADR 0026: use the kernel host door; never add host-door.baseline.json entries. " +
      "When a baseline file stops importing the host, remove its entry to shrink the baseline.",
  ).toEqual({ violations: [], stale: [] });
});

it("recognizes aliases, relative clients and multiline imports without counting actionResult", () => {
  const file = WEB + "open/example.tsx";
  const source = `
    // import { hostFetch } from '#/host/runtime';
    import { actionResult as result } from '../../../../packages/mcps/src/shared/takeoff-action-client';
    import { actionResult, submitAction as submit } from '../../../../packages/mcps/src/shared/takeoff-action-client.ts';
    import {\n callHostRpc as call\n } from '../host/client.ts';
    import { hostFetch as fetch } from '#/host/runtime';
    export { hostUrl } from '#/host/client';
    const client = import('#/host/client.ts');
  `;
  expect(imports(source, file).map((entry) => hostImport(file, entry))).toEqual([
    false,
    true,
    true,
    true,
    true,
    true,
  ]);
});

it("rejects both a new bypass and a stale allowance", () => {
  expect(ratchet(["new.ts"], { "retired.ts": 1 })).toEqual({
    violations: ["new.ts"],
    stale: ["retired.ts"],
  });
});
