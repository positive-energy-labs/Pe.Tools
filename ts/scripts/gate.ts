/** Source checkpoint: formatting, lint, owner compiler configurations, projections and guards. */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const steps: [string, string, string[]][] = [
  ["format", root, ["vp", "fmt", "--check"]],
  // Compiler diagnostics run below through each package's actual tsconfig, separately from lint.
  ["lint", root, ["vp", "lint", "--type-aware"]],
];
for (const folder of ["apps", "packages", "tests"])
  for (const name of readdirSync(resolve(root, folder)).sort()) {
    const cwd = resolve(root, folder, name);
    if (existsSync(resolve(cwd, "tsconfig.json")))
      steps.push([`types ${folder}/${name}`, cwd, ["pnpm", "exec", "tsc", "--noEmit"]]);
  }
steps.push(
  [
    "route projections",
    resolve(root, "apps/web"),
    [process.execPath, "scripts/route-graphs.ts", "--check"],
  ],
  [
    "Page projection",
    resolve(root, "packages/kit"),
    [process.execPath, "scripts/page.mjs", "--check"],
  ],
  [
    "C# route links",
    resolve(root, "packages/agent-contracts"),
    [process.execPath, "scripts/route-links-cs.ts", "--check"],
  ],
  [
    "catalog source hash",
    resolve(root, "packages/host-contracts"),
    [process.execPath, "scripts/ops-catalog-hash.ts"],
  ],
  ["repo guards", resolve(root, "tests/repo-guards"), ["vp", "test", "run"]],
);
const failures: string[] = [];
for (const [name, cwd, [bin, ...args]] of steps) {
  const started = Date.now();
  console.log(`\n== gate: ${name} (${[bin, ...args].join(" ")})`);
  const result = spawnSync(bin!, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) failures.push(name);
  console.log(
    `== gate: ${name} ${result.status === 0 ? "GREEN" : "RED"} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
console.log(failures.length ? `Gate RED: ${failures.join(", ")}` : "Gate GREEN");
process.exitCode = failures.length ? 1 : 0;
