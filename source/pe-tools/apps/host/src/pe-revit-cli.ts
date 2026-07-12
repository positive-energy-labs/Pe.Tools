import { existsSync } from "node:fs";
import { join } from "node:path";
import { productIdentity } from "@pe/host-contracts/contracts";

/**
 * Launch chain for the pe-revit CLI (install kernel + sandbox control plane):
 * PE_REVIT_CMD env override → the kernel-installed shim (user machines) → `dotnet pe-revit`
 * (dev checkout, local tool). Resolved per call — the shim can appear after the host started.
 */
export function peRevitLauncher(): [string, string[]] {
  const installedShim = join(installRoot(), "shims", "pe-revit.cmd");
  return process.env.PE_REVIT_CMD
    ? [process.env.PE_REVIT_CMD, []]
    : existsSync(installedShim)
      ? ["cmd", ["/c", installedShim]]
      : ["dotnet", ["pe-revit"]];
}

/** Product root under `%LOCALAPPDATA%\<vendor>\<product>` (install receipts, shims, logs). */
export function installRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? "",
    productIdentity.vendorName,
    productIdentity.productName,
  );
}
