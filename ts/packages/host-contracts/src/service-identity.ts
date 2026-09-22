// Product service identity — the POLICY layer over the SDK's vendored service client
// (./vendor/pe-service.ts). Naming mechanics (the worktree hash, a cross-language contract with the
// SDK's C# client) live in the SDK; this module owns only what is Pe.Tools-specific: the product
// root and the lane→name mapping.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hostProcessIdentity, productIdentity } from "./contracts/product.ts";
import { sourceServiceName } from "./vendor/pe-service.ts";

export type HostLane = "dev" | "installed";

/**
 * Product root under `%LOCALAPPDATA%\<vendor>\<product>` — the A10 service-file `appBase`
 * (`state/service/<service-name>.json` lives beneath it) and the install-receipt root. Resolved
 * lazily so tests can redirect it via `LOCALAPPDATA`.
 */
export function productRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
  );
}

/** Worktree-scoped dev-host name for a checkout root (SDK hash — byte-stable across languages). */
export function sourceHostServiceName(sourceRoot: string): string {
  return sourceServiceName(hostProcessIdentity.serviceName, sourceRoot);
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
