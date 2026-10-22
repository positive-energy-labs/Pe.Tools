/**
 * THE OPS-CATALOG DRIFT GUARD. `host-ops.generated.ts` is projected from the dotnet graph by
 * `pnpm codegen` in @pe/host-contracts, which also records `ops-catalog.sha`, a hash of every
 * non-test C# source. A dotnet edit without a regen reddens here in milliseconds; the guard never
 * builds dotnet (the old shape took 200 to 330 s per run with its output hidden, signal 1 of the
 * crusade review 2026-09-22). `codegen:check` remains the slow lane that proves the generator.
 */
import { execFileSync, spawnSync } from "node:child_process";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: HERE,
  encoding: "utf8",
}).trim();

const PACKAGE = resolve(REPO, "ts/packages/host-contracts");

describe("ops-catalog codegen", () => {

  it("host-ops.generated.ts was generated from the current dotnet sources", () => {
    const r = spawnSync("node", ["scripts/ops-catalog-hash.ts"], {
      cwd: PACKAGE,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
  });
});
