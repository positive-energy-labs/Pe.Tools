import { existsSync } from "node:fs";
import { join } from "node:path";
import { productIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership } from "./host-ownership.ts";

export type PeRevitLaunch = {
  readonly cmd: string;
  readonly args: readonly string[];
  /** Working directory the CLI must run from (dev lane: the repo root, so the dotnet local-tool
   * manifest and product.payloads.json resolve). Undefined = inherit the host's cwd. */
  readonly cwd?: string;
};

/**
 * Launch chain for the pe-revit CLI (install kernel + sandbox control plane):
 * PE_REVIT_CMD env override → dev-lane repo-local tool (`dotnet pe-revit` at the repo root —
 * a source-linked host must run its checkout's CLI, not the older installed shim) → the
 * kernel-installed shim (user machines) → bare `dotnet pe-revit`. Resolved per call — the shim
 * can appear after the host started.
 */
export function peRevitLauncher(): PeRevitLaunch {
  if (process.env.PE_REVIT_CMD) return { cmd: process.env.PE_REVIT_CMD, args: [] };
  if (hostOwnership.lane === "dev" && hostOwnership.sourceRoot)
    return {
      cmd: "dotnet",
      args: ["pe-revit"],
      cwd: join(hostOwnership.sourceRoot, "..", ".."),
    };
  const installedShim = join(installRoot(), "shims", "pe-revit.cmd");
  return existsSync(installedShim)
    ? { cmd: "cmd", args: ["/c", installedShim] }
    : { cmd: "dotnet", args: ["pe-revit"] };
}

/** Product root under `%LOCALAPPDATA%\<vendor>\<product>` (install receipts, shims, logs). */
export function installRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? "",
    productIdentity.vendorName,
    productIdentity.productName,
  );
}
