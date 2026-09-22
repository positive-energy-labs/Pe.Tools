/**
 * =============================================================================================
 * THE OPS-CATALOG DRIFT GUARD — the generated operation catalog is public-contract authority.
 * =============================================================================================
 *
 * `@pe/host-contracts` generates `src/generated/host-ops.generated.ts` from `pe-dev ops-catalog`,
 * and `codegen:check` is the drift gate. Nothing ran that gate: the `--project` path went dead at
 * the `dotnet/` move and no test noticed, so C# operations could drift from the TypeScript the app
 * imports without a red anywhere (crusade review 2026-09-22).
 *
 * Two `it`s, coarse to fine:
 *  1. live script paths   every filesystem path the `codegen*` scripts name resolves. A rename or
 *                         a folder move reddens here in milliseconds, with the path in the message.
 *  2. no drift            the `codegen:check` script itself runs, exactly as package.json writes
 *                         it: the C# CLI projects the catalog and the typegen diffs it against the
 *                         checked-in file. This is the gate; it is never skipped, so a missing
 *                         `dotnet` is a red and not a silence.
 *
 * Same posture as the other guards: plain fs, plain regex, no new dependency.
 * =============================================================================================
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
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

/** The bins a pnpm script would have on PATH, so `dotnet`, `vpx` and `node` resolve the same way. */
const env = {
  ...process.env,
  PATH: [
    resolve(PACKAGE, "node_modules/.bin"),
    resolve(REPO, "ts/node_modules/.bin"),
    process.env.PATH ?? "",
  ].join(delimiter),
};

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

  it("generates exactly the checked-in host-ops.generated.ts", () => {
    // The script, verbatim: a guard that re-spelled the command would not guard the command.
    execSync(scripts["codegen:check"]!, { cwd: PACKAGE, env, stdio: "pipe" });
  }, 600_000);
});
