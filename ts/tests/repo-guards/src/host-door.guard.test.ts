/**
 * ADR 0026, Readings: routes reach the host through one kernel door.
 * Kernel: ts/apps/web/src/shell/. Transport/source exemptions below are exact files by role.
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

const INFRASTRUCTURE = new Set(
  [
    // Shared subscription/read transport, including receipt observation.
    "readings.ts",
    // Persisted Work transport used by the shell's write and recovery paths.
    "route/host.ts",
    // Typed /call transport, including exact session/document headers and host errors.
    "host/client.ts",
    // Runtime-bound typed Pe HTTP transport.
    "host/pe-client.ts",
    // Update admission and successor-probe transport used by machine chrome.
    "host/install.ts",
    // Machine/bootstrap/share/admin transport used by machine chrome.
    "host/machine.ts",
    // Measured-value read adapter owns cancellation against the displayed reading basis.
    "host/measured-parse.ts",
    // Navigation snapshot transport used by the shared navigation owner.
    "navigation/navigation-client.ts",
    // Native family read adapter preserves response provenance for subsequent admission.
    "revit/observation.tsx",
    // Immutable binary scene-artifact transport, separate from JSON readings.
    "scene/artifact.ts",
    // Scene reading source owns subscriber demand, cancellation, busy retry and artifact leases.
    "scene/scene-data.ts",
    // Typed harness-thread HTTP/SSE transport used by shared chat sources and owners.
    "workbench/provider/harness-client.ts",
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
    return (
      !entry.names?.length ||
      entry.names.some(
        (name) =>
          // Pure receipt projection, inert local diagnostics, and a type cannot call the host.
          !["actionResult", "inspectRetainedActions", "DetachedAction"].includes(name),
      )
    );
  return (
    path === HOST_CLIENT ||
    !!entry.names?.some((name) => name === "callHostRpc" || name === "hostFetch") ||
    (entry.names === null && path === modulePath(file, "#/host/runtime"))
  );
}

const bypasses = (file: string, entries: Import[]) =>
  !INFRASTRUCTURE.has(file) &&
  !file.startsWith(WEB + "shell/") &&
  entries.some((entry) => hostImport(file, entry));

it("host door bypasses can only shrink (ADR 0026)", () => {
  const actual = productionFiles("apps/web/src").filter((file) =>
    bypasses(file, readImports(file)),
  );
  expect(
    ratchet(actual, baseline),
    "ADR 0026: use the kernel host door; never add host-door.baseline.json entries. " +
      "When a baseline file stops importing the host, remove its entry to shrink the baseline.",
  ).toEqual({ violations: [], stale: [] });
});

it("has no migration allowances left", () => {
  expect(baseline).toEqual({});
});

it("kernel gap: shared observation-scoped Select and Section Box need a kernel verb door", () => {
  const file = WEB + "revit/element-menu.tsx";
  // A mounted route's target cannot replace the displayed observation's captured lifetime.
  expect(
    bypasses(file, readImports(file)),
    "Global verbs still submit outside shell execution",
  ).toBe(false);
});

it("exempts only named infrastructure, never neighboring UI or a directory", () => {
  for (const file of [
    "host/another-client.ts",
    "scene/another-source.ts",
    "revit/element-menu.tsx",
    "open/route.tsx",
  ]) {
    const path = WEB + file;
    expect(
      bypasses(path, imports(`import { hostFetch as fetch } from '#/host/runtime'`, path)),
    ).toBe(true);
  }
  expect(
    bypasses(WEB + "host/client.ts", [{ module: "#/host/runtime", names: ["hostFetch"] }]),
  ).toBe(false);
});

it("does not mistake inert evidence or a detached receipt type for an effect", () => {
  expect(
    hostImport(WEB + "state/owner-inspector.tsx", {
      module: "../../../../packages/mcps/src/shared/takeoff-action-client",
      names: ["inspectRetainedActions", "DetachedAction"],
    }),
  ).toBe(false);
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
