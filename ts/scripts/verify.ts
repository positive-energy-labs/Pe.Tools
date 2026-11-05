/** Comprehensive checkpoint. gate.ts owns source checks; native codegen is explicit here. */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const steps: [name: string, cwd: string, cmd: string[]][] = [
  ["source gate", TS, [process.execPath, "scripts/gate.ts"]],
  ["knip", TS, ["vp", "exec", "knip", "--no-progress"]],
  // @pe/host test owns kit preparation, including when run outside verify.
  [
    "test",
    TS,
    [
      "vp",
      "run",
      // One package at a time and uncached: parallel suites starve each other (a 0.1 s test took 5 s
      // and tripped its timeout), and with the task cache on, `vp run` sat idle with no children
      // after the host suite finished (observed solo: 2+ min, until killed) while the same run
      // with --no-cache exits at once. A test verdict must never be replayed from a cache either.
      "--concurrency-limit",
      "1",
      "--no-cache",
      "--filter",
      "@pe/*",
      "--filter",
      "!@pe/repo-guards",
      "--fail-if-no-match",
      "test",
    ],
  ],
  ["native catalog projection", resolve(TS, "packages/host-contracts"), ["pnpm", "codegen:check"]],
  ["browser", TS, ["pnpm", "test:browser:product"]],
  [
    "r24",
    resolve(TS, ".."),
    ["dotnet", "build", "dotnet/Pe.App/Pe.App.csproj", "-c", "Debug.R24", "-v:q", "-nologo"],
  ],
];

for (const [name, cwd, [bin, ...args]] of steps) {
  const started = Date.now();
  console.log(`\n== verify: ${name}  (${[bin, ...args].join(" ")})`);
  const r = spawnSync(bin!, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.error) console.error(r.error);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (r.status !== 0) {
    console.error(`\n== verify: ${name} RED after ${seconds}s (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
  console.log(`== verify: ${name} green in ${seconds}s`);
}
console.log("\n== verify: green");
