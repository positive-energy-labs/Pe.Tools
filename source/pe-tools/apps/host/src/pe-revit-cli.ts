import { existsSync } from "node:fs";
import { join } from "node:path";
import { productIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership, type HostOwnership } from "./host-ownership.ts";

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
export function peRevitLauncher(
  ownership: Pick<HostOwnership, "lane" | "sourceRoot"> = hostOwnership,
  override = process.env.PE_REVIT_CMD,
  fileExists: (path: string) => boolean = existsSync,
): PeRevitLaunch {
  if (override?.trim()) return { cmd: override.trim(), args: [] };
  if (ownership.lane === "dev") {
    if (!ownership.sourceRoot)
      throw new Error("Dev Pe.Tools host cannot resolve its source checkout for pe-revit.");
    return {
      cmd: "dotnet",
      // `dotnet tool run` is manifest-only: unlike command discovery, it cannot select an
      // installed/global pe-revit when this checkout's pinned local tool is unavailable.
      args: ["tool", "run", "pe-revit", "--"],
      cwd: join(ownership.sourceRoot, "..", ".."),
    };
  }
  const installedShim = join(installRoot(), "shims", "pe-revit.cmd");
  return fileExists(installedShim)
    ? { cmd: "cmd", args: ["/c", installedShim] }
    : { cmd: "dotnet", args: ["pe-revit"] };
}

/** Reject missing/stale CLI output instead of treating a successful process exit as a verdict. */
export function validatePeRevitEnvelope(
  stdout: string,
  args: readonly string[],
  launch: Pick<PeRevitLaunch, "cmd" | "args">,
): string {
  const command = `${launch.cmd} ${[...launch.args, ...args].join(" ")}`.trim();
  if (!stdout.trim()) throw new Error(`pe-revit produced no output for '${command}'`);
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error(`pe-revit produced invalid JSON for '${command}'`);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("result" in value) ||
    !("resolved" in value) ||
    !Array.isArray((value as { diagnostics?: unknown }).diagnostics) ||
    !Array.isArray((value as { nextSteps?: unknown }).nextSteps)
  )
    throw new Error(`pe-revit produced a non-envelope JSON result for '${command}'`);
  return stdout;
}

/** Product root under `%LOCALAPPDATA%\<vendor>\<product>` (install receipts, shims, logs). */
export function installRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? "",
    productIdentity.vendorName,
    productIdentity.productName,
  );
}
