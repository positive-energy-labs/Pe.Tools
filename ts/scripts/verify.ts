/**
 * `vp verify`: the one command that proves a change. Each step runs in order with its full
 * output on the terminal, and the first red stops the run. CI and the `execute` skill name
 * this and nothing else.
 *
 *  1. check    fmt + lint + typecheck, whole workspace, so a contract edit reddens in its consumers.
 *              Generated files are excluded from fmt by ts/vite.config.ts and linted like the rest.
 *  2. knip     dead files, exports, and dependencies against knip.json. `knip --fix` is the purge.
 *  3. test     every package's own `test` script, so web and host keep their lane setup.
 *  4. guards   ts/tests/repo-guards, serialized (fileParallelism: false in its vite config).
 *              The ops-catalog guard reads the committed drift hash and never builds dotnet.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const steps: [name: string, cwd: string, cmd: string[]][] = [
  ["check", TS, ["vp", "check"]],
  ["knip", TS, ["vp", "exec", "knip", "--no-progress"]],
  [
    "test",
    TS,
    [
      "vp",
      "run",
      "--filter",
      "@pe/*",
      "--filter",
      "!@pe/repo-guards",
      "--fail-if-no-match",
      "test",
    ],
  ],
  ["guards", resolve(TS, "tests/repo-guards"), ["vp", "test"]],
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
