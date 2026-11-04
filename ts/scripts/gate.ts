/** COMMON 26: the unit/integration gate; no browser, Revit or generated writes. */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const steps: [string, string, string[]][] = [];
for (const folder of ["apps", "packages"])
  for (const name of readdirSync(resolve(root, folder)).sort()) {
    const cwd = resolve(root, folder, name);
    if (existsSync(resolve(cwd, "tsconfig.json")))
      steps.push([`tsc ${folder}/${name}`, cwd, ["pnpm", "exec", "tsc", "--noEmit"]]);
  }
steps.push(
  ["typed lint", root, ["vp", "lint", "--type-aware", "--type-check"]],
  ["repo guards", resolve(root, "tests/repo-guards"), ["vp", "test", "run", "--maxWorkers=2"]],
  [
    "route projections",
    resolve(root, "apps/web"),
    [process.execPath, "scripts/route-graphs.ts", "--check"],
  ],
  [
    "C# route links",
    resolve(root, "packages/agent-contracts"),
    [process.execPath, "scripts/route-links-cs.ts", "--check"],
  ],
  [
    "closure pins",
    resolve(root, "apps/web"),
    [process.execPath, "scripts/route-graphs.ts", "--builtin-closure-only", "--check"],
  ],
);
const failures: string[] = [];
for (const [name, cwd, [bin, ...args]] of steps) {
  console.log(`\n== gate: ${name}`);
  const result = spawnSync(bin!, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) failures.push(name);
  console.log(`== gate: ${name} ${result.status === 0 ? "GREEN" : "RED"}`);
}
console.log(failures.length ? `Gate RED: ${failures.join(", ")}` : "Gate GREEN");
process.exitCode = failures.length ? 1 : 0;
