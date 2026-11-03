// RAM-1 red loop: load one route in a fresh headless Chrome and sample renderer memory every 15 s.
// node apps/web/scripts/ram1-probe.mjs --url <url> [--minutes 5] [--out dir] [--heap 60,180] [--eval file.js]
// Prints one JSON line per sample: JS heap (CDP Performance.getMetrics), DOM counters, and Windows
// working set per Chrome process type for this run's own profile. Aborts below 6 GiB free (BUDGET BROWSER_FIXTURE_STOP).
// ponytail: raw CDP over Node's global WebSocket; no @pe/browser so it runs on any sha.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, createWriteStream, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const url = arg("url");
if (!url) throw Error("--url required");
const minutes = Number(arg("minutes", "5"));
const out = arg("out", ".");
const heapAt = (arg("heap", "") || "").split(",").filter(Boolean).map(Number);
const evalFile = arg("eval");
const actFile = arg("act"); // evaluated once at --act-at seconds (default 15): drives the arm, e.g. sends a Pea prompt
const actAt = Number(arg("act-at", "15"));
const port = Number(arg("port", "9431"));
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "ram1-chrome-"));
const tag = basename(profile);
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freeGiB = () =>
  Number(
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB",
    ]).toString(),
  );
const chromeSets = () => {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? { $_.CommandLine -like '*${tag}*' } | % { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }; "$t $($_.WorkingSetSize) $($_.ProcessId)" }`;
  const sets = {};
  for (const line of execFileSync("powershell", ["-NoProfile", "-Command", ps]).toString().trim().split(/\r?\n/)) {
    const [type, bytes] = line.trim().split(" ");
    if (type) sets[type] = Math.round(((sets[type] ?? 0) + Number(bytes) / 2 ** 20) * 10) / 10;
  }
  return sets; // MiB per process type
};
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const waiting = new Map();
const listeners = new Set();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id) waiting.get(msg.id)?.(msg), waiting.delete(msg.id);
  else listeners.forEach((l) => l(msg));
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, (msg) => (msg.error ? reject(Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const heapSnapshot = async (file) => {
  const stream = createWriteStream(file);
  const chunk = (msg) => msg.method === "HeapProfiler.addHeapSnapshotChunk" && stream.write(msg.params.chunk);
  listeners.add(chunk);
  await send("HeapProfiler.collectGarbage");
  await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  listeners.delete(chunk);
  await new Promise((r) => stream.end(r));
};
const consoleErrors = [];
listeners.add((msg) => {
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.text);
});
await send("Performance.enable");
await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
await sleep(10_000);
if (evalFile) console.log(JSON.stringify({ eval: await evaluate(readFileSync(evalFile, "utf8")) }));
const start = Date.now();
let aborted = false;
try {
  for (let t = 0; t <= minutes * 60; t += 15) {
    while (Date.now() - start < t * 1000) await sleep(250);
    const metrics = Object.fromEntries((await send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const free = freeGiB();
    const sample = {
      t,
      free: Math.round(free * 100) / 100,
      jsHeapMiB: Math.round(metrics.JSHeapUsedSize / 2 ** 20),
      jsTotalMiB: Math.round(metrics.JSHeapTotalSize / 2 ** 20),
      nodes: metrics.Nodes,
      listeners: metrics.JSEventListeners,
      documents: metrics.Documents,
      layouts: metrics.LayoutCount,
      recalcs: metrics.RecalcStyleCount,
      taskSec: Math.round(metrics.TaskDuration),
      ws: chromeSets(),
      errors: consoleErrors.length,
      measures: await evaluate("performance.getEntriesByType('measure').length"),
    };
    console.log(JSON.stringify(sample));
    if (actFile && t === actAt) console.log(JSON.stringify({ act: await evaluate(readFileSync(actFile, "utf8")) }));
    if (heapAt.includes(t)) await heapSnapshot(join(out, `heap-${t}.heapsnapshot`));
    if (free < 6) {
      console.log(JSON.stringify({ abort: "free below BROWSER_FIXTURE_STOP 6 GiB", free }));
      aborted = true;
      break;
    }
  }
} finally {
  if (evalFile) console.log(JSON.stringify({ endEval: await evaluate(readFileSync(evalFile, "utf8")).catch((e) => String(e)) }));
  const shot = await send("Page.captureScreenshot", { format: "png" }).catch(() => null);
  if (shot) writeFileSync(join(out, "end.png"), Buffer.from(shot.data, "base64"));
  if (consoleErrors.length) console.log(JSON.stringify({ firstErrors: consoleErrors.slice(0, 5) }));
  ws.close();
  chrome.kill();
  await sleep(1500);
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? { $_.CommandLine -like '*${tag}*' } | % { Stop-Process -Id $_.ProcessId -Force }`,
    ]);
  } catch {}
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
process.exit(aborted ? 2 : 0);
