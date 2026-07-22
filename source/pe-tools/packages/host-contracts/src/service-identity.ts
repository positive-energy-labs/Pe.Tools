// Product service identity — the POLICY layer over the SDK's vendored service client
// (./vendor/pe-service.ts). Naming mechanics (the worktree hash, a cross-language contract with the
// SDK's C# client) live in the SDK; this module owns only what is Pe.Tools-specific: the product
// root and the lane→name mapping.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
 * The ONE identity input for a dev host: a Pe.Tools checkout root maps to `<root>/source/pe-tools`,
 * the directory the host runs from and hashes its service name over. Mirror of the C# side
 * (ProductDevelopmentRuntimeLayout.ResolveSourceHostWorkingDirectory), including the package.json
 * existence check — every deriver (host, MCP clients, C# launcher) must pass THIS through
 * `hostServiceName`, never the checkout root itself, or the names disagree by construction.
 * Idempotent: a path that already is the host source dir passes through.
 */
export function devHostSourceDir(checkoutRoot: string): string | null {
  if (existsSync(join(checkoutRoot, "apps", "host", "package.json"))) return checkoutRoot;
  const candidate = join(checkoutRoot, "source", "pe-tools");
  return existsSync(join(candidate, "apps", "host", "package.json")) ? candidate : null;
}

/**
 * The service name for a host lane: the installed host is the one global name; a dev host derives a
 * stable worktree-scoped name from its checkout root, so worktrees coexist under one product root.
 */
export function hostServiceName(lane: HostLane, sourceRoot: string | null): string {
  if (lane === "installed") return hostProcessIdentity.serviceName;
  if (!sourceRoot) throw new Error("A dev host requires a source root for service identity.");
  return sourceHostServiceName(sourceRoot);
}
