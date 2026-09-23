/**
 * THE OPS-CATALOG DRIFT GUARD. `host-ops.generated.ts` is projected from the dotnet graph by
 * `pnpm codegen` in @pe/host-contracts, which also records `ops-catalog.sha`, a hash of every
 * non-test C# source. A dotnet edit without a regen reddens here in milliseconds; the guard never
 * builds dotnet (the old shape took 200 to 330 s per run with its output hidden, signal 1 of the
 * crusade review 2026-09-22). `codegen:check` remains the slow lane that proves the generator.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: HERE,
  encoding: "utf8",
}).trim();

const PACKAGE = resolve(REPO, "ts/packages/host-contracts");
const scripts = (
  JSON.parse(readFileSync(resolve(PACKAGE, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

describe("ops-catalog codegen", () => {
  it("names only paths that exist", () => {
    const dead: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith("codegen")) continue;
      // `--project <dir>` (the C# CLI) and every `scripts/*.ts` the command runs.
      const paths = [
        ...[...command.matchAll(/--project\s+(\S+)/g)].map((m) => m[1]!),
        ...[...command.matchAll(/(\S*scripts\/\S+\.ts)/g)].map((m) => m[1]!),
      ];
      expect(paths.length, `${name} runs nothing this guard can check`).toBeGreaterThan(0);
      for (const path of paths)
        if (!existsSync(resolve(PACKAGE, path))) dead.push(`${name}: ${path}`);
    }
    expect(dead, "a codegen script points at a path that no longer exists").toEqual([]);
  });

  it("host-ops.generated.ts was generated from the current dotnet sources", () => {
    const r = spawnSync("node", ["scripts/ops-catalog-hash.ts"], {
      cwd: PACKAGE,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
  });
});
