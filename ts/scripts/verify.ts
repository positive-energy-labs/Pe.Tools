/**
 * `vp verify`: the one command that proves a change. Each step runs in order with its full
 * output on the terminal, and the first red stops the run. CI and the `execute` skill name
 * this and nothing else.
 *
 *  1. check    fmt + lint + typecheck, whole workspace, so a contract edit reddens in its consumers.
 *              Generated files are excluded from fmt by ts/vite.config.ts and linted like the rest.
 *  2. knip     dead files, exports, and dependencies against knip.json. `knip --fix` is the purge.
 *  3. kit      build packages/kit/dist, the Page kit asset the host tests serve.
 *  4. test     every package's own `test` script, so web and host keep their lane setup.
 *  5. guards   ts/tests/repo-guards, serialized (fileParallelism: false in its vite config).
 *              The ops-catalog guard reads the committed drift hash and never builds dotnet.
 *  6. r24      compile Pe.App as Debug.R24 (net48) and nothing else: no Revit, no deploy. CI builds
 *              R23 and R25, so a net8-only API (`SkipLast`, `IReadOnlySet<T>`) went red here unseen.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const steps: [name: string, cwd: string, cmd: string[]][] = [
  ["check", TS, ["vp", "check"]],
  ["knip", TS, ["vp", "exec", "knip", "--no-progress"]],
  // The host serves and exports Pages from packages/kit/dist (gitignored); a fresh worktree has none
  // and the snowdon acceptance tests answer 503 without it.
  ["kit", TS, ["vp", "run", "--filter", "@pe/kit", "build"]],
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
  ["guards", resolve(TS, "tests/repo-guards"), ["vp", "test"]],
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
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (r.status !== 0) {
    console.error(`\n== verify: ${name} RED after ${seconds}s (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
  console.log(`== verify: ${name} green in ${seconds}s`);
}
console.log("\n== verify: green");
