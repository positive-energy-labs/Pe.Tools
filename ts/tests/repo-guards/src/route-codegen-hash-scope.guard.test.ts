/**
 * Adding a route runs one step, `codegen:routes`, and that step can never leave the ops-catalog hash
 * stale without a red check: nothing it writes is hashed (`ops-catalog-hash.ts`), so a route edit
 * moves no digest, and a C# op edit still reddens `ops-catalog-hash.ts` in the gate.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import { hashedSources } from "../../../packages/host-contracts/scripts/ops-catalog-hash.ts";
import { ROUTES_CS } from "../../../packages/agent-contracts/scripts/route-links-cs.ts";

const repo = resolve(import.meta.dirname, "../../../..");
const generator = readFileSync(resolve(repo, "ts/apps/web/scripts/route-graphs.ts"), "utf8");

// Runs the real generator (every builtin closure is built), so this is the suite's long pole.
test("codegen:routes owns the C# launch rows: its check goes red when only they are stale", () => {
  // The preload hands every process of the run stale C# bytes; the tracked file is never touched.
  const scratch = mkdtempSync(join(tmpdir(), "route-codegen-"));
  const preload = join(scratch, "stale-cs.mjs");
  writeFileSync(
    preload,
    [
      `import fs from "node:fs";`,
      `import { syncBuiltinESMExports } from "node:module";`,
      `import { resolve } from "node:path";`,
      `const target = resolve(${JSON.stringify(ROUTES_CS)});`,
      `const read = fs.readFileSync;`,
      `fs.readFileSync = (path, ...rest) =>`,
      `  typeof path === "string" && resolve(path) === target ? "// stale" : read(path, ...rest);`,
      `syncBuiltinESMExports();`,
    ].join("\n"),
  );
  try {
    const run = spawnSync(process.execPath, ["scripts/route-graphs.ts", "--check"], {
      cwd: resolve(repo, "ts/apps/web"),
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(preload).href}` },
    });
    const stderr = run.stderr.replaceAll("\r\n", "\n");
    expect(run.status, stderr).not.toBe(0);
    expect(stderr).toContain("PeRoutes.generated.cs is stale");
    // Nothing else drifted: the C# rows alone reddened the one step.
    expect(stderr).toContain("run codegen:routes:\ndotnet/Pe.App/Host/PeRoutes.generated.cs (route-links-cs.ts)\n");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 600_000);

test("no file codegen:routes writes is inside the ops-catalog hash", () => {
  const hashed = new Set(hashedSources());
  const written = [relative(repo, ROUTES_CS).replaceAll("\\", "/")];
  expect(hashed.size, "the hash scope lists no C# source").toBeGreaterThan(100);
  expect(written.filter((path) => hashed.has(path))).toEqual([]);
  // Any other C# the generator names is written by it too, and must stay outside the digest.
  const named = [...generator.matchAll(/dotnet\/[\w./-]+\.cs/g)].map((match) => match[0]);
  expect(named.filter((path) => hashed.has(path))).toEqual([]);
});
