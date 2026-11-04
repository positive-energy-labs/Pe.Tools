import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, test } from "vite-plus/test";
import { root } from "./unification-2-census.ts";

// Render every producer, compare bytes, write nothing; teardown rejects tracked generated edits.
for (const [name, cwd, args] of [
  ["route directory and every Pea graph", "ts/apps/web", ["scripts/route-graphs.ts", "--check"]],
  ["Snowdon Page and route", "ts/packages/kit", ["scripts/page.mjs", "--check"]],
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

// Verification runs this suite after package tests. Include staged changes and deletions too.
afterAll(() => {
  execFileSync("git", [
    "diff", "--exit-code", "HEAD", "--",
    "*.generated.*", "ts/packages/*/src/generated/**",
    "ts/packages/mcps/src/pea/generated/**", "ts/apps/web/src/routeTree.gen.ts",
    "examples/pods/*/routes/*/index.js", "examples/pods/*/pages/*/index.html",
  ], { cwd: root, stdio: "pipe" });
});
