import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { productInstallLayout } from "@pe/host-contracts/contracts";
import { resolveLaneAndRoot } from "@pe/runtime/runtime-owner";

declare const __PE_SOURCE_COMMIT__: string;

export type PeSourceTree = { root: string; sha: string; dirty: boolean };

export function peSourceTree(): PeSourceTree {
  const owner = resolveLaneAndRoot();
  if (owner.lane === "dev") {
    const root = owner.sourceRoot!;
    const sha = git(root, ["rev-parse", "HEAD"]);
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Pe.Tools source HEAD is invalid: '${sha}'.`);
    return {
      root,
      sha,
      dirty: git(root, ["status", "--porcelain", "--untracked-files=normal"]).length > 0,
    };
  }

  const host = join(owner.installedRoot!, productInstallLayout["VersionedApp:host"]);
  const root = join(dirname(host), "src");
  const manifestPath = join(dirname(host), "src-manifest.json");
  if (!existsSync(root) || !existsSync(manifestPath))
    throw new Error(`Installed Pe.Tools source is incomplete beside '${host}'.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { commit?: unknown };
  const sha = typeof manifest.commit === "string" ? manifest.commit : "";
  const built = typeof __PE_SOURCE_COMMIT__ === "undefined" ? "" : __PE_SOURCE_COMMIT__;
  if (!/^[0-9a-f]{40}$/.test(sha) || sha !== built)
    throw new Error(
      `Installed Pe.Tools source commit '${sha || "missing"}' does not match '${built || "missing"}'.`,
    );
  return { root, sha, dirty: false };
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
