// Product service identity — the POLICY layer over the SDK's vendored service client
// (./vendor/pe-service.ts). Naming mechanics (the worktree hash, a cross-language contract with the
// SDK's C# client) live in the SDK; this module owns only what is Pe.Tools-specific: the product
// root and the lane→name mapping.
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isSea } from "node:sea";
import {
  hostProcessIdentity,
  productIdentity,
  productInstallLayout,
  productPathNames,
} from "./contracts/product.ts";
import { insideTestRoot, productHomePath } from "./product-paths.ts";
export {
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
  hostProcessIdentity,
} from "./contracts/product.ts";
import { normalizeSourceRoot, sourceServiceName } from "./vendor/pe-service.ts";

export type HostLane = "dev" | "installed";

/**
 * Product root under `%LOCALAPPDATA%\<vendor>\<product>` — the A10 service-file `appBase`
 * (`state/service/<service-name>.json` lives beneath it) and the install-receipt root. Resolved
 * lazily so tests can redirect it via `LOCALAPPDATA`. When the product home override is set the
 * root moves under it (`<home>\.local-state`), so an isolated run shares no state with the owner's
 * host; the SDK's own registry stays in `%LOCALAPPDATA%\Pe.Revit.Sdk`.
 */
export function productRoot(): string {
  if (process.env[productPathNames.productHomeVariable]?.trim())
    return join(productHomePath(), productPathNames.localStateDirectoryName);
  return insideTestRoot(
    join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      productIdentity.vendorName,
      productIdentity.productName,
    ),
  );
}

/** The owner's terminal context token, written by the host at start and read by the `pea` CLI. */
export const hostContextTokenPath = (serviceName: string): string =>
  join(productRoot(), "state", "service", `${serviceName}.context`);

/** Installed executables must run at the manifest's canonical installed location. */
export function installedRuntimeRoot(
  app: "host" | "pea",
  executablePath = process.execPath,
  bundled = isSea(),
): string {
  const root = productRoot();
  const expected = join(root, productInstallLayout[`VersionedApp:${app}`]);
  if (!bundled || normalizeSourceRoot(executablePath) !== normalizeSourceRoot(expected))
    throw Error(`Installed ${app} must execute from '${expected}'.`);
  return root;
}

/** Worktree-scoped dev-host name for a checkout root (SDK hash — byte-stable across languages). */
export function sourceHostServiceName(sourceRoot: string): string {
  return sourceServiceName(hostProcessIdentity.serviceName, sourceRoot);
}

/**
 * The dev frontend's preferred port for a checkout. The MAIN checkout (its `.git` is a directory) is
 * the dev lane's identity and keeps `DEV_LANE_FRONTEND_PORT`, the origin of the owner's installed
 * "Pe.Tools Dev" PWA. Every linked worktree (`.git` is a file) takes a stable slot in 5200-5999
 * derived from the same hash as its dev host's service name, so worktrees run beside main and each
 * other. Vite walks to the next free port on a collision; the host learns the origin that actually
 * bound (dev.ts), never this number.
 */
export const DEV_LANE_FRONTEND_PORT = 5175;
export const DEV_FRONTEND_PORTS = { first: 5200, count: 800 } as const;
export function devFrontendPort(sourceRoot: string): number {
  if (statSync(join(sourceRoot, ".git"), { throwIfNoEntry: false })?.isDirectory())
    return DEV_LANE_FRONTEND_PORT;
  const hash = /([0-9a-f]{8})[0-9a-f]*$/.exec(sourceHostServiceName(sourceRoot))?.[1];
  if (!hash) throw new Error("Dev host service name carries no checkout hash.");
  return DEV_FRONTEND_PORTS.first + (Number.parseInt(hash, 16) % DEV_FRONTEND_PORTS.count);
}

/**
 * The checkout's language roots, named once. C# mirror: `TsHostLauncher` (the one C# spelling of
 * the TS root). Everything else derives paths from a checkout root through these.
 */
export const checkoutLayout = { ts: "ts", dotnet: "dotnet" } as const;

/**
 * A Pe.Tools checkout root — the ONE dev identity input, hashed by host, MCP clients, pea, and the
 * C# launcher alike. A `.git` entry (dir in the main checkout, file in a linked worktree) with
 * `Pe.Tools.slnx` beside it. Walks up like git does, so identity follows where the WORK is.
 */
export function checkoutRootFrom(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git")) && existsSync(join(dir, "Pe.Tools.slnx"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Spawn plumbing: a supervisor tells the host it just spawned which checkout it serves. */
export const sourceRootVariable = "PE_TOOLS_SOURCE_ROOT";

/**
 * The service name for a host lane: the installed host is the one global name; a dev host derives a
 * stable worktree-scoped name from its checkout root, so worktrees coexist under one product root.
 */
export function hostServiceName(lane: HostLane, sourceRoot: string | null): string {
  if (lane === "installed") return hostProcessIdentity.serviceName;
  if (!sourceRoot) throw new Error("A dev host requires a source root for service identity.");
  return sourceHostServiceName(sourceRoot);
}

/** Ownership authorizes execution; matching ownership does not attest loaded code freshness. */
export function runtimeOwnerRejection(
  expected: {
    lane: HostLane;
    sourceRoot: string | null;
    serviceName: string;
    installedRoot?: string | null;
  },
  actual: {
    lane?: string | null;
    sourceRoot?: string | null;
    serviceName?: string | null;
    installedRoot?: string | null;
  },
): string | null {
  if (actual.lane !== expected.lane)
    return `Runtime lane '${actual.lane ?? "unknown"}' does not match '${expected.lane}'.`;
  if (actual.serviceName !== expected.serviceName)
    return `Runtime service '${actual.serviceName ?? "unknown"}' does not match '${expected.serviceName}'.`;
  if (expected.lane === "dev") {
    if (
      !actual.sourceRoot ||
      !expected.sourceRoot ||
      normalizeSourceRoot(actual.sourceRoot) !== normalizeSourceRoot(expected.sourceRoot)
    )
      return `Runtime checkout '${actual.sourceRoot ?? "unknown"}' does not match '${expected.sourceRoot}'.`;
    if (actual.installedRoot) return "Checkout runtime must not report an installation root.";
  } else {
    if (actual.sourceRoot) return "Installed runtime must not report a checkout source root.";
    if (
      !expected.installedRoot ||
      !actual.installedRoot ||
      normalizeSourceRoot(actual.installedRoot) !== normalizeSourceRoot(expected.installedRoot)
    )
      return `Runtime installation '${actual.installedRoot ?? "unknown"}' does not match '${expected.installedRoot ?? "unknown"}'.`;
  }
  return null;
}
