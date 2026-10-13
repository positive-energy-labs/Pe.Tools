// The one build identity source for receipt export: product version (product.payloads.json, shared with
// Pe.App) plus the git commit, stamped at build time into the host bundle and the web bundle. Callers
// cannot override it per file or per request; a build that cannot name its commit fails.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../../..");

export type ReceiptBuildStamp = { version: string; build: string; commit: string };

/** `release` carries the product version; `dev` carries version `dev` (export still needs its opt-in key). */
export function receiptBuildStamp(kind: "release" | "dev"): ReceiptBuildStamp {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(`build stamp: git HEAD is not a commit: ${commit}`);
  const version =
    kind === "dev"
      ? "dev"
      : (
          JSON.parse(readFileSync(resolve(repoRoot, "product.payloads.json"), "utf8")) as {
            version: string;
          }
        ).version;
  return { version, build: commit.slice(0, 12), commit };
}

/** Compile-time defines read by receipt-export.ts and the web bundle. */
export function receiptBuildDefines(kind: "release" | "dev") {
  const stamp = JSON.stringify(receiptBuildStamp(kind));
  return { __PE_HOST_RECEIPT_BUILD__: stamp, __PE_WEB_RECEIPT_BUILD__: stamp };
}
