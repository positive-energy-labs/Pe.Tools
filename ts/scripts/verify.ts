/**
 * Comprehensive checkpoint. gate.ts owns source checks; native codegen is explicit here.
 * Every stage runs even after a red one and the verdict lists them all, because a runner that
 * stops at the first red hands its owner one layer of failures per run.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shell = process.platform === "win32";

// One `vp run` per package: a single run over `@pe/*` schedules no further package after a red one.
const listed = spawnSync("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
  cwd: TS,
  shell,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (listed.status !== 0) throw new Error(`pnpm -r list failed: ${listed.stderr}`);
const tested = (JSON.parse(listed.stdout) as { name?: string; path: string }[])
  .filter(
    ({ name, path }) =>
      name?.startsWith("@pe/") &&
      // The source gate runs the repo guards.
      name !== "@pe/repo-guards" &&
      JSON.parse(readFileSync(resolve(path, "package.json"), "utf8")).scripts?.test,
  )
  .map(({ name }) => name!);
if (!tested.length) throw new Error("no @pe/* package declares a test script");

const steps: [name: string, cwd: string, cmd: string[]][] = [
  ["source gate", TS, [process.execPath, "scripts/gate.ts"]],
  ["knip", TS, ["vp", "exec", "knip", "--no-progress"]],
  // @pe/host test owns kit preparation, including when run outside verify.
  // One package at a time and uncached: parallel suites starve each other (a 0.1 s test took 5 s
  // and tripped its timeout), and with the task cache on, `vp run` sat idle with no children
  // after the host suite finished (observed solo: 2+ min, until killed) while the same run
  // with --no-cache exits at once. A test verdict must never be replayed from a cache either.
  ...tested.map((name): [string, string, string[]] => [
    `test ${name}`,
    TS,
    [
      "vp",
      "run",
      "--concurrency-limit",
      "1",
      "--no-cache",
      "--filter",
      name,
      "--fail-if-no-match",
      "test",
    ],
  ]),
  ["native catalog projection", resolve(TS, "packages/host-contracts"), ["pnpm", "codegen:check"]],
  ["browser", TS, ["pnpm", "test:browser:product"]],
  [
    "r24",
    resolve(TS, ".."),
    ["dotnet", "build", "dotnet/Pe.App/Pe.App.csproj", "-c", "Debug.R24", "-v:q", "-nologo"],
  ],
];

const failures: string[] = [];
for (const [name, cwd, [bin, ...args]] of steps) {
  const started = Date.now();
  console.log(`\n== verify: ${name}  (${[bin, ...args].join(" ")})`);
  const r = spawnSync(bin!, args, { cwd, stdio: "inherit", shell });
  if (r.error) console.error(r.error);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (r.status !== 0) failures.push(name);
  console.log(
    r.status === 0
      ? `== verify: ${name} green in ${seconds}s`
      : `== verify: ${name} RED after ${seconds}s (exit ${r.status})`,
  );
}
console.log(failures.length ? `\n== verify: RED: ${failures.join(", ")}` : "\n== verify: green");
process.exitCode = failures.length ? 1 : 0;
