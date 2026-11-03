import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { openBrowser, type BrowserSession } from "@pe/browser";
import type { startFansFixtureHost } from "./fans-fixture-host.ts";

const exec = promisify(execFile);
const home = "C:/Users/kaitp/AppData/Local/Temp/pe-fans-home";
if (
  process.env.LOCALAPPDATA?.replaceAll("\\", "/") !== home ||
  process.env.PE_TOOLS_PRODUCT_HOME?.replaceAll("\\", "/") !== home
)
  throw Error("FANS requires both isolated home overrides before loading a host or browser");
if (process.env.PE_LANE !== "dev")
  throw Error("FANS fixture requires the explicit PE_LANE=dev source identity");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const queue = "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/locks/QUEUE.txt";
const ledger = join(root, ".artifacts/tmp/fans/witness-runs.json");
const previous = JSON.parse(await readFile(ledger, "utf8").catch(() => "[]")) as unknown[];
if (previous.length >= 3) throw Error("Three witness runs used; no run 4");
const run = previous.length + 1;
const dir = join(root, `.artifacts/tmp/fans/witness-${run}`);
const curve = `C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/evolution-20261103/fans-ram-curve-${run}.log`;
const stamp = () => new Date().toISOString();
async function ram(pid = 0) {
  const script = `$ErrorActionPreference='Stop'; $rows=Get-CimInstance Win32_Process; $owned=@(); if(${pid} -gt 0){$owned=@(${pid})}; do {$more=@($rows | Where-Object {$_.ParentProcessId -in $owned -and $_.ProcessId -notin $owned} | Select-Object -ExpandProperty ProcessId); $owned=@($owned)+@($more)} while($more.Count); $bytes=($rows | Where-Object {$_.ProcessId -in $owned} | Measure-Object WorkingSetSize -Sum).Sum; @{freeGiB=[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,3);chromeGiB=[math]::Round($bytes/1GB,3);pids=$owned} | ConvertTo-Json -Compress`;
  const result = await exec(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true },
  );
  return JSON.parse(result.stdout) as { freeGiB: number; chromeGiB: number; pids: number[] };
}
const start = await ram();
if (start.freeGiB < 10) throw Error(`Browser fixture gate: ${start.freeGiB} GiB < 10`);
const lines = (await readFile(queue, "utf8")).split(/\r?\n/);
const taken = lines.findLastIndex(
  (line) => line.includes("browser-heavy") && !/WAIT|RELEASED/.test(line),
);
const released = lines.findLastIndex(
  (line) => /RELEASED/.test(line) && /browser-heavy|ram1-diagnose/.test(line),
);
if (taken > released) throw Error(`Browser-heavy is held: ${lines[taken]}`);
const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true });
const { stdout: dirty } = await exec(
  "git",
  ["status", "--porcelain", "--untracked-files=all", "--", "ts"],
  { cwd: root, windowsHide: true },
);
if (dirty.trim()) throw Error("Commit the exclusive candidate before its browser witness");
await mkdir(dir, { recursive: true });
await appendFile(
  queue,
  `\nFANS t3-1f3f475b ${stamp()}: TOOK browser-heavy; run ${run}/3; free ${start.freeGiB} GiB; ${head.trim()}; isolated home ${home}\n`,
);
const receipt = {
  run,
  head: head.trim(),
  started: stamp(),
  start,
  productState: `${home}/.local-state/state`,
  result: "running",
  host: "",
  workStore: "",
  target: "",
  browser: null as BrowserSession["info"] | null,
  cleanup: [] as string[],
};
await writeFile(ledger, JSON.stringify([...previous, receipt], null, 2));
const save = () => writeFile(join(dir, "receipt.json"), JSON.stringify(receipt, null, 2));
let server: Awaited<ReturnType<typeof startFansFixtureHost>> | undefined;
let browser: BrowserSession | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let stopReason: string | null = null;
let finish: (result: string) => void = () => {};
const ended = new Promise<string>((resolve) => {
  finish = (result) => {
    if (stopReason === null) {
      stopReason = result;
      resolve(result);
    }
  };
});
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (["PASS", "FAIL", "RAM1"].includes(line.trim())) finish(line.trim());
});
process.once("SIGINT", () => finish("interrupted"));
process.once("SIGTERM", () => finish("interrupted"));
const sample = async () => {
  const reading = await ram(browser?.info.pid);
  await appendFile(curve, JSON.stringify({ at: stamp(), run, ...reading }) + "\n");
  console.log(`RAM ${JSON.stringify(reading)}`);
  if (reading.freeGiB < 6) finish("RAM-floor");
};
try {
  await sample();
  timer = setInterval(() => {
    void sample().catch((error) => finish(String(error)));
  }, 15_000);
  const fixture = await import("./fans-fixture-host.ts");
  server = await fixture.startFansFixtureHost();
  receipt.host = server.url;
  receipt.workStore = `${server.native.dir}/work`;
  await save();
  if (stopReason !== null) throw Error(stopReason);
  browser = await openBrowser({
    mode: "headless",
    home: join(dir, "browser"),
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  receipt.browser = browser.info;
  const page = await browser.page({ url: `${server.url}/fans` });
  receipt.target = page.targetId;
  await page.release();
  await sample();
  console.log(
    JSON.stringify({
      ready: true,
      run,
      url: server.url,
      endpoint: browser.info.endpoint,
      target: page.targetId,
      dir,
      curve,
    }),
  );
  await save();
  receipt.result = await ended;
  await writeFile(
    join(dir, "host-evidence.json"),
    JSON.stringify(
      {
        work: await server.native.saved.view(server.native.key, "ducts"),
        native: [...server.native.native],
        receipts: await server.native.journal.list(),
        events: server.native.events,
        dispatched: server.native.dispatched,
      },
      null,
      2,
    ),
  );
} catch (error) {
  receipt.result = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (timer) clearInterval(timer);
  input.close();
  const cleanupFailed = (error: unknown) => {
    receipt.result = `cleanup failed: ${String(error)}`;
    receipt.cleanup.push(String(error));
    process.exitCode = 1;
  };
  if (browser)
    await browser.close().then(() => receipt.cleanup.push("owned browser stopped"), cleanupFailed);
  if (server)
    await server
      .close()
      .then(() => receipt.cleanup.push("fixture host/web stopped"), cleanupFailed);
  await save();
  await writeFile(ledger, JSON.stringify([...previous, receipt], null, 2));
  await appendFile(
    queue,
    `\nFANS t3-1f3f475b ${stamp()}: RELEASED browser-heavy; run ${run}/3 ended ${receipt.result}; ${receipt.cleanup.join("; ")}\n`,
  );
}
