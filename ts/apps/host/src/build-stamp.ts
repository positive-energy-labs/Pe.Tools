// The one build identity source for receipt export: product version (product.payloads.json, shared with
// Pe.App) plus the git commit, stamped at build time into the host bundle and the web bundle. Callers
// cannot override it per file or per request; a build that cannot name its commit fails.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ReceiptBuildStamp = { version: string; build: string; commit: string };

/** `release` carries the product version; `dev` carries version `dev` (export still needs its opt-in key). */
export function receiptBuildStamp(
  kind: "release" | "dev",
  root = resolve(import.meta.dirname, "../../../.."),
): ReceiptBuildStamp {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(`build stamp: git HEAD is not a commit: ${commit}`);
  const version =
    kind === "dev"
      ? "dev"
      : (
          JSON.parse(readFileSync(resolve(root, "product.payloads.json"), "utf8")) as {
            version: string;
          }
        ).version;
  if (kind === "release") return { version, build: commit.slice(0, 12), commit };
  // Source launches have no baked artifact. Hash the working bytes too, so two dirty builds
  // at the same HEAD cannot share a recording identity. Ignored outputs are not source inputs.
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const hash = createHash("sha256")
    .update(commit)
    .update(git(["diff", "HEAD", "--binary", "--no-ext-diff"]));
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const path of untracked)
    hash
      .update(path)
      .update("\0")
      .update(
        createHash("sha256")
          .update(readFileSync(resolve(root, path)))
          .digest(),
      );
  return { version, build: `${commit.slice(0, 12)}-${hash.digest("hex")}`, commit };
}

/** Compile-time defines read by receipt-export.ts and the web bundle. */
export function receiptBuildDefines(kind: "release" | "dev") {
  const receipt = receiptBuildStamp(kind);
  const stamp = JSON.stringify(receipt);
  return {
    __PE_HOST_RECEIPT_BUILD__: stamp,
    __PE_WEB_RECEIPT_BUILD__: stamp,
    __PE_SOURCE_COMMIT__: JSON.stringify(receipt.commit),
  };
}
