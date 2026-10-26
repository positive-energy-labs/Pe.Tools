// One owned demo runtime, or an explicit borrowed browser/server. Never starts Revit.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { openBrowser, type BrowserSession, type SessionInfo } from "@pe/browser";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { emptyThreadLifecycle } from "../../packages/agent-contracts/src/harness-thread.ts";

const exec = promisify(execFile);
const { values } = parseArgs({
  args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
  options: {
    attached: { type: "boolean" },
    source: { type: "string" },
    url: { type: "string" },
    port: { type: "string" },
    target: { type: "string" },
    suite: { type: "string", default: "chaos" },
    seed: { type: "string", default: "20261023" },
    require: { type: "string", default: "refresh,reconnect,worker" },
  },
});
if (values.suite !== "chaos" && values.suite !== "selection")
  throw new Error("--suite must be chaos or selection");
if (values.suite === "selection" && (values.attached || values.url || values.port || values.target))
  throw new Error("The required selection suite owns its isolated runtime and browser");
const testTs = resolve(import.meta.dirname, "../..");
const source = resolve(values.source ?? join(testTs, ".."));
const leaseThread = "caa00000-0000-4000-8000-000000000001";
const dir = join(
  testTs,
  "..",
  ".artifacts",
  "runs",
  `browser-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-route-launch`,
  `${values.seed}-${Date.now()}`,
);
await mkdir(dir, { recursive: true });
const receipt = {
  suite: values.suite,
  mode: values.attached ? "attached" : "demo",
  source,
  seed: values.seed,
  started: new Date().toISOString(),
  hostPid: 0,
  hostPort: 0,
  web: "",
  browser: "",
  browserInfo: undefined as SessionInfo | undefined,
  browserPort: 0,
  target: "",
  documentReady: undefined as
    | { url: string; status: number; elapsedMs: number; bytes: number }
    | undefined,
  tray: undefined as
    | { before: string | null; after: string | null; changed: boolean; sampleMs: number }
    | undefined,
  result: "running",
  cleanup: [] as string[],
};
const save = () => writeFile(join(dir, "custody.json"), JSON.stringify(receipt, null, 2));
const journeyResultPath = join(dir, "journey-result.json");
const env: NodeJS.ProcessEnv = { ...process.env, PE_BROWSER_HOME: join(dir, "browser-home") };
let host: ChildProcess | undefined;
let testProcess: ChildProcess | undefined;
let hostLog = "";
let cancelled = false;
let documentAbort: AbortController | undefined;
let token = "";
let browser: BrowserSession | undefined;
let trayMonitor: ReturnType<typeof setInterval> | undefined;
const trayHash = async () => {
  const bytes = await readFile(join(source, ".artifacts", "dev-tray", "session.json")).catch(
    (error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
};
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function wait<T>(
  read: () => Promise<T | undefined>,
  label: string,
  timeout: number,
): Promise<T> {
  const end = Date.now() + timeout;
  while (!cancelled && Date.now() < end) {
    const result = await read();
    if (result !== undefined) return result;
    await pause(100);
  }
  throw new Error(`${cancelled ? "Interrupted" : "Timed out"}: ${label}`);
}
async function exited(child: ChildProcess, timeout: number) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Owned process ${child.pid} did not exit`)),
      timeout,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}
const interrupt = () => {
  cancelled = true;
  documentAbort?.abort(new Error("Interrupted during source document readiness"));
  if (testProcess)
    void stopOwned(testProcess).catch((error) => receipt.cleanup.push(String(error)));
};
async function stopOwned(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32")
    await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      timeout: 10_000,
      windowsHide: true,
    });
  else child.kill("SIGKILL");
  await exited(child, 5000);
}
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  let web = values.url;
  let port = Number(values.port);
  let target = values.target;
  if (values.attached) {
    if (!web || !port || !target || !values.source)
      throw new Error(
        "Attached mode requires --url, --port, --target and --source for served-build provenance; it borrows them without lifecycle changes",
      );
  } else {
    if (values.suite === "chaos") {
      receipt.tray = { before: await trayHash(), after: null, changed: false, sampleMs: 1000 };
      trayMonitor = setInterval(() => {
        void trayHash()
          .then((hash) => {
            if (hash !== receipt.tray!.before) receipt.tray!.changed = true;
          })
          .catch((error) => {
            receipt.tray!.changed = true;
            receipt.cleanup.push(`Tray observation: ${String(error)}`);
          });
      }, 1000);
    }
    const home = join(dir, "home");
    env.PE_TOOLS_PRODUCT_HOME = home;
    env.LOCALAPPDATA = join(dir, "localappdata");
    env.APPDATA = join(dir, "appdata");
    env.PE_LANE = "dev";
    // Discard inherited bindings. The source entrypoint creates its canonical isolated receipt.
    for (const key of [
      "PE_TOOLS_HOST_SERVICE_NAME",
      "PE_TOOLS_HOST_BASE_URL",
      "PE_TOOLS_FRONTEND_BASE_URL",
      "PE_SERVICE_LEASE_PATH",
      "PE_TEST_HOME_ROOT",
    ])
      delete env[key];
    await mkdir(home, { recursive: true });
    await mkdir(env.LOCALAPPDATA!, { recursive: true });
    await mkdir(env.APPDATA!, { recursive: true });
    // The lease witness explicitly selects an existing conversation. Tool entry itself creates none.
    const threadDir = join(home, ".local-state", "state", "harness-threads", leaseThread);
    await mkdir(threadDir, { recursive: true });
    const at = new Date().toISOString();
    await writeFile(
      join(threadDir, "meta.json"),
      JSON.stringify({
        id: leaseThread,
        harness: "codex",
        providerId: "codex",
        providerName: "Codex",
        title: "Route continuity proof",
        createdAt: at,
        updatedAt: at,
        modelId: null,
        acpSessionId: null,
        models: [],
        traits: [],
        traitValues: {},
        head: { targets: [], revision: 0 },
        forkOf: null,
        promptCapabilities: null,
        lifecycle: emptyThreadLifecycle(),
        tabs: [],
      }),
    );
    await writeFile(join(threadDir, "events.jsonl"), "");
    host = spawn(
      process.execPath,
      ["--import", "jiti/register", "src/dev.ts", "--no-revit", "--no-tray"],
      {
        cwd: join(source, "ts", "apps", "host"),
        env,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    host.once("error", (error) => {
      hostLog += `\n${String(error)}`;
    });
    const log = (chunk: Buffer) => {
      hostLog += chunk.toString();
      void writeFile(join(dir, "host.log"), hostLog);
    };
    host.stdout?.on("data", log);
    host.stderr?.on("data", log);
    receipt.hostPid = host.pid ?? 0;
    await save();
    const serviceDir = join(home, ".local-state", "state", "service");
    const service = await wait(
      async () => {
        if (host!.exitCode !== null) throw new Error(`Source host exited: ${hostLog.slice(-3000)}`);
        const files = await readdir(serviceDir).catch(() => []);
        for (const file of files.filter((file) => file.endsWith("-no-revit.json"))) {
          const row = JSON.parse(await readFile(join(serviceDir, file), "utf8"));
          if (
            row.pid === host!.pid &&
            resolve(row.sourceRoot).toLowerCase() === source.toLowerCase()
          )
            return row;
        }
      },
      "isolated no-Revit host service receipt",
      90_000,
    );
    token = service.token;
    receipt.hostPort = service.port;
    web = await wait(
      async () => {
        if (host!.exitCode !== null) throw new Error(`Source host exited: ${hostLog.slice(-3000)}`);
        return /Browser: (http:\/\/127\.0\.0\.1:\d+)/.exec(hostLog)?.[1];
      },
      "source web origin",
      90_000,
    );
    web = new URL(`/ducts?demo=navigation&thread=${leaseThread}`, web).href;
    receipt.web = web;
    await save();
    // A bound Vite port precedes its first SSR import. Keep cold compilation outside
    // the CDP command deadline; this checks server readiness, never browser acceptance.
    const documentStart = Date.now();
    documentAbort = new AbortController();
    const document = await fetch(web, {
      signal: AbortSignal.any([AbortSignal.timeout(90_000), documentAbort.signal]),
    });
    const html = await document.text();
    documentAbort = undefined;
    receipt.documentReady = {
      url: web,
      status: document.status,
      elapsedMs: Date.now() - documentStart,
      bytes: Buffer.byteLength(html),
    };
    await save();
    if (
      !document.ok ||
      !document.headers.get("content-type")?.includes("text/html") ||
      !/<html\b/i.test(html)
    )
      throw new Error(`Source document readiness failed: HTTP ${document.status}`);
    browser = await openBrowser({
      mode: values.suite === "selection" ? "headless" : "visible",
      home: env.PE_BROWSER_HOME,
      args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    port = Number(new URL(browser.info.endpoint).port);
    receipt.browser = browser.info.id;
    receipt.browserInfo = browser.info;
    receipt.browserPort = port;
    const ownedPage = await browser.page();
    target = ownedPage.targetId;
    await ownedPage.release();
  }
  receipt.web = web!;
  receipt.browserPort = port;
  receipt.target = target!;
  await save();
  const testEnv = {
    ...env,
    CDP_PORT: String(port),
    CDP_TARGET: target!,
    E2E_WEB: web!,
    CHAOS_LANE: values.attached && !new URL(web!).searchParams.has("demo") ? "host" : "demo",
    CHAOS_SEED: values.seed,
    CHAOS_REQUIRE: values.require,
    CHAOS_PRODUCT_ROOT: source,
    CHAOS_RESULT_PATH: journeyResultPath,
    E2E_RESULT_PATH: journeyResultPath,
  };
  const config = values.suite === "selection" ? "product-selection" : "route-chaos";
  testProcess = spawn("vp", ["test", "run", "--config", `tests/e2e/${config}.config.ts`], {
    cwd: testTs,
    env: testEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise<number>((done, reject) => {
    const timer = setTimeout(() => {
      void stopOwned(testProcess!).catch((error) => receipt.cleanup.push(String(error)));
      reject(new Error("Vitest process deadline exceeded"));
    }, 360_000);
    testProcess!.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    testProcess!.once("exit", (code) => {
      clearTimeout(timer);
      done(code ?? 1);
    });
  });
  process.exitCode = code;
  receipt.result =
    code === 0
      ? (JSON.parse(await readFile(journeyResultPath, "utf8")) as { result: string }).result
      : "failed";
} catch (error) {
  receipt.result = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  if (testProcess && testProcess.exitCode === null && testProcess.signalCode === null) {
    await stopOwned(testProcess).catch((error) => {
      receipt.cleanup.push(String(error));
      process.exitCode = 1;
    });
  }
  try {
    if (browser) {
      await browser.close().then(
        () => receipt.cleanup.push(`stopped owned browser ${browser!.info.id}`),
        (error) => {
          receipt.cleanup.push(String(error));
          process.exitCode = 1;
        },
      );
    }
  } catch (error) {
    receipt.cleanup.push(`Chrome cleanup: ${String(error)}`);
    process.exitCode = 1;
  }
  try {
    if (host) {
      if (token && receipt.hostPort)
        await fetch(`http://127.0.0.1:${receipt.hostPort}/admin/shutdown`, {
          method: "POST",
          headers: { "x-pe-service-token": token },
          signal: AbortSignal.timeout(10_000),
        }).catch((error) => receipt.cleanup.push(`shutdown request: ${String(error)}`));
      await exited(host, 15_000).catch(async () => {
        receipt.cleanup.push("Host graceful shutdown deadline exceeded; disconnecting owned IPC");
        if (host!.connected) host!.disconnect();
        await exited(host!, 5000).catch(() => undefined);
        await stopOwned(host!).catch((error) => {
          receipt.cleanup.push(String(error));
          process.exitCode = 1;
        });
      });
      receipt.cleanup.push(
        `owned source host ${host.pid} exited=${host.exitCode ?? host.signalCode}`,
      );
      if (host.exitCode !== 0) {
        process.exitCode = 1;
        receipt.result = `failed: owned source host exited=${host.exitCode ?? host.signalCode}`;
      }
    }
  } catch (error) {
    receipt.cleanup.push(`Host cleanup: ${String(error)}`);
    process.exitCode = 1;
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  if (trayMonitor) clearInterval(trayMonitor);
  if (receipt.tray) {
    receipt.tray.after = await trayHash().catch((error) => {
      receipt.tray!.changed = true;
      receipt.cleanup.push(`Tray final observation: ${String(error)}`);
      return null;
    });
    receipt.tray.changed ||= receipt.tray.after !== receipt.tray.before;
    if (receipt.tray.changed) {
      process.exitCode = 1;
      receipt.result = "failed: shared tray bytes changed during owned --no-tray run";
    }
  }
  await save();
  console.log(`Route journey custody: ${dir}`);
}
