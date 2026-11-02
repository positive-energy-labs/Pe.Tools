import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "vite-plus/test";
import { root } from "./unification-2-census.ts";

// Render every producer, compare bytes, write nothing. Works on a dirty tree as well as CI.
for (const [name, cwd, args] of [
  ["route directory and every Pea graph", "ts/apps/web", ["scripts/route-graphs.ts", "--check"]],
  ["PeRoutes.generated.cs", "ts/packages/agent-contracts", ["scripts/route-links-cs.ts", "--check"]],
] as const)
  test(`${name} matches its producer`, () => {
    execFileSync(process.execPath, [...args], { cwd: resolve(root, cwd), stdio: "pipe" });
  }, 120_000);

test("host catalog and contracts match C# authority", () => {
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["codegen:check"], {
    cwd: resolve(root, "ts/packages/host-contracts"), stdio: "pipe",
    shell: process.platform === "win32",
  });
}, 180_000);
