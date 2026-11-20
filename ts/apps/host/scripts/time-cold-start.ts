/** Times a cold source-host start (the SDK's `vp run @pe/host#attach` body: `src/dev.ts`) from spawn
 * to healthy, per phase, in an isolated product home. Each run is a fresh process and a fresh home.
 *
 *   node scripts/time-cold-start.ts [--runs 3] [--cold-receipt] [--max-healthy-ms N]
 *
 * --cold-receipt deletes the route-startup receipt before each run (the state before any
 * `codegen:routes` or host start). --max-healthy-ms exits 1 when the median exceeds N.
 * In-process phases come from `PE_START_TIMING` marks in dev.ts (ms since process start);
 * service file, health and frontend are observed from outside, like the SDK loader does. */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { routeStartupReceiptPath } from "@pe/web/route-startup";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    "cold-receipt": { type: "boolean", default: false },
    "max-healthy-ms": { type: "string" },
  },
});
const hostDir = join(import.meta.dirname, "..");
const checkout = join(hostDir, "..", "..", "..");
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function run() {
  const dir = await mkdtemp(join(tmpdir(), "pe-cold-start-"));
  const home = join(dir, "home");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PE_TOOLS_PRODUCT_HOME: home,
    LOCALAPPDATA: join(dir, "localappdata"),
    APPDATA: join(dir, "appdata"),
    PE_BROWSER_HOME: join(dir, "browser-home"),
    PE_LANE: "dev",
    PE_START_TIMING: "1",
  };
  for (const key of [
    "PE_TOOLS_HOST_SERVICE_NAME",
    "PE_TOOLS_HOST_BASE_URL",
    "PE_TOOLS_FRONTEND_BASE_URL",
    "PE_SERVICE_LEASE_PATH",
    "PE_TEST_HOME_ROOT",
  ])
    delete env[key];
  await mkdir(env.LOCALAPPDATA!, { recursive: true });
  await mkdir(env.APPDATA!, { recursive: true });
  if (values["cold-receipt"]) await rm(routeStartupReceiptPath(checkout), { force: true });

  const started = performance.now();
  const at = () => Math.round(performance.now() - started);
  const host = spawn(
    process.execPath,
    ["--import", "jiti/register", "src/dev.ts", "--no-revit", "--no-tray"],
    { cwd: hostDir, env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true },
  );
  const phases: Record<string, number> = {};
  let log = "";
  const read = (chunk: Buffer) => {
    log += chunk.toString();
    for (const [, name, ms] of log.matchAll(/PE_START_TIMING (\S+) (\d+)/g))
      phases[name!] ??= Number(ms);
    if (/Browser: http/.test(log)) phases.frontend ??= at();
  };
  host.stdout!.on("data", read);
  host.stderr!.on("data", read);
  try {
    const serviceDir = join(home, ".local-state", "state", "service");
    const deadline = Date.now() + 300_000;
    while (phases.healthy === undefined || phases.frontend === undefined) {
      if (host.exitCode !== null) throw new Error(`Source host exited:\n${log.slice(-3000)}`);
      if (Date.now() > deadline) throw new Error(`No healthy host in 300 s:\n${log.slice(-3000)}`);
      await delay(100);
      if (phases.healthy !== undefined) continue;
      for (const file of (await readdir(serviceDir).catch(() => [])).filter((f) =>
        f.endsWith(".json"),
      )) {
        const row = JSON.parse(await readFile(join(serviceDir, file), "utf8").catch(() => "{}"));
        if (row.pid !== host.pid) continue;
        phases.serviceFile ??= at();
        // The SDK loader's own readiness probe: the payload's `service.health` route.
        const ok = await fetch(`http://127.0.0.1:${row.port}/host/status`, {
          signal: AbortSignal.timeout(2_000),
        }).then(
          (response) => response.status < 400,
          () => false,
        );
        if (ok) phases.healthy = at();
      }
    }
    return phases;
  } finally {
    // dev.ts retires on parent disconnect; the tree kill only covers a host that did not.
    if (host.connected) host.disconnect();
    await Promise.race([new Promise((done) => host.once("exit", done)), delay(15_000)]);
    if (host.exitCode === null && host.pid)
      spawnSync("taskkill", ["/pid", String(host.pid), "/t", "/f"]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
  }
}

const runs: Record<string, number>[] = [];
for (let i = 0; i < Number(values.runs); i++) {
  runs.push(await run());
  console.log(`run ${i + 1}: ${JSON.stringify(runs.at(-1))}`);
}
const median = (name: string) => {
  const sorted = runs.map((r) => r[name] ?? NaN).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
// Marks are cumulative; a phase's own cost is its mark minus the previous one.
const order = ["entry", "projection", "hostGraph", "serviceFile", "healthy", "frontend"];
console.log("phase         at(ms)  own(ms)   (median of " + runs.length + ")");
for (const [i, name] of order.entries())
  console.log(
    `${name.padEnd(12)} ${String(median(name)).padStart(7)} ${String(median(name) - (i ? median(order[i - 1]!) : 0)).padStart(8)}`,
  );
const max = values["max-healthy-ms"];
if (max && !(median("healthy") <= Number(max))) {
  console.error(`FAIL: median healthy ${median("healthy")} ms exceeds ${max} ms`);
  process.exit(1);
}
