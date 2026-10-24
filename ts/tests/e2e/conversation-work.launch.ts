// Optional owned session. The Vitest config itself also accepts explicitly borrowed resources.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { seedConversationWork } from "./conversation-work.fixture.ts";

const exec = promisify(execFile);
const ts = resolve(import.meta.dirname, "../..");
const source = resolve(ts, "..");
const dir = process.env.CONVERSATION_WORK_ARTIFACT_DIR;
if (!dir) throw Error("Set CONVERSATION_WORK_ARTIFACT_DIR to an explicit new run directory");
await mkdir(dir, { recursive: true });
const home = join(resolve(dir), "home");
const port = Number(process.env.CONVERSATION_WORK_CHROME_PORT ?? "9304");
if ([9292, 9222, 9223, 9231].includes(port) || !Number.isInteger(port) || port < 1024)
  throw Error("Protected or invalid Chrome port");
try {
  await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) });
  throw Error(`Port ${port} is already answering; never borrow it in owned mode`);
} catch (error) {
  if (String(error).includes("already answering")) throw error;
}
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PE_LANE: "dev",
  PE_TOOLS_PRODUCT_HOME: home,
  LOCALAPPDATA: join(dir, "localappdata"),
  APPDATA: join(dir, "appdata"),
  CONVERSATION_WORK_ARTIFACT_DIR: resolve(dir),
};
for (const key of [
  "PE_TOOLS_HOST_SERVICE_NAME",
  "PE_TOOLS_HOST_BASE_URL",
  "PE_TOOLS_FRONTEND_BASE_URL",
  "PE_SERVICE_LEASE_PATH",
  "PE_TEST_HOME_ROOT",
])
  delete env[key];
const receipt = {
  source,
  startedAt: new Date().toISOString(),
  mode: "owned-source-no-revit-no-tray",
  hostPid: 0,
  service: "",
  web: "",
  chrome: "",
  port,
  target: "",
  result: "UNPROVEN_STARTUP",
  cleanup: [] as string[],
};
const save = () => writeFile(join(dir, "custody.json"), JSON.stringify(receipt, null, 2));
let host: ChildProcess | undefined;
let runner: ChildProcess | undefined;
let token = "";
let hostPort = 0;
let output = "";
let cancelled = false;
let chromeAttempted = false;
const stopOwned = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32")
    await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 10_000,
    });
  else child.kill("SIGKILL");
};
const interrupt = () => {
  cancelled = true;
  if (runner?.exitCode === null)
    void stopOwned(runner).catch((error) => receipt.cleanup.push(String(error)));
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
async function waitFor<A>(
  read: () => Promise<A | undefined>,
  label: string,
  milliseconds = 90_000,
): Promise<A> {
  const until = Date.now() + milliseconds;
  while (!cancelled && Date.now() < until) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw Error(`UNPROVEN_STARTUP: ${label} did not become ready`);
}
async function exited(child: ChildProcess, milliseconds: number) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(
      () => reject(Error(`Owned PID ${child.pid} did not exit`)),
      milliseconds,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}
try {
  await seedConversationWork(home, dir);
  await mkdir(env.LOCALAPPDATA!, { recursive: true });
  await mkdir(env.APPDATA!, { recursive: true });
  host = spawn(
    process.execPath,
    ["--import", "jiti/register", "src/dev.ts", "--no-revit", "--no-tray"],
    {
      cwd: join(ts, "apps/host"),
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  receipt.hostPid = host.pid ?? 0;
  const log = (bytes: Buffer) => {
    output += bytes.toString();
    void writeFile(join(dir, "host.log"), output);
  };
  host.stdout?.on("data", log);
  host.stderr?.on("data", log);
  await save();
  const service = await waitFor(async () => {
    if (host!.exitCode !== null)
      throw Error(`UNPROVEN_STARTUP: source host exited ${host!.exitCode}`);
    const serviceDir = join(home, ".local-state/state/service");
    for (const file of (await readdir(serviceDir).catch(() => [])).filter((file) =>
      file.endsWith("-no-revit.json"),
    )) {
      const value = JSON.parse(await readFile(join(serviceDir, file), "utf8"));
      if (
        value.pid === host!.pid &&
        resolve(value.sourceRoot).toLowerCase() === source.toLowerCase()
      ) {
        receipt.service = join(serviceDir, file);
        return value;
      }
    }
  }, "identity-verified source service");
  token = service.token;
  hostPort = service.port;
  receipt.web = await waitFor(
    async () => /Browser: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1],
    "source frontend",
  );
  await save();
  const ready = await fetch(new URL("/pea", receipt.web), { signal: AbortSignal.timeout(90_000) });
  const html = await ready.text();
  await writeFile(
    join(dir, "startup-response.json"),
    JSON.stringify(
      {
        url: new URL("/pea", receipt.web).href,
        status: ready.status,
        contentType: ready.headers.get("content-type"),
        bytes: Buffer.byteLength(html),
      },
      null,
      2,
    ),
  );
  await writeFile(join(dir, "startup-response.html"), html);
  if (!ready.ok || !html.includes("<html"))
    throw Error("UNPROVEN_STARTUP: frontend did not serve HTML");
  chromeAttempted = true;
  const launch = await exec(
    "chrome-agent",
    [
      "launch",
      "--port",
      String(port),
      "--",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
    { timeout: 45_000, windowsHide: true },
  );
  const chrome = JSON.parse(launch.stdout);
  if (!chrome.name || chrome.port !== port)
    throw Error("Owned Chrome returned an unexpected identity");
  receipt.chrome = chrome.name;
  const targets = (await fetch(`http://127.0.0.1:${port}/json`).then((response) =>
    response.json(),
  )) as { type: string; id: string }[];
  const pages = targets.filter((target) => target.type === "page");
  if (pages.length !== 1) throw Error("Owned Chrome must have exactly one empty page");
  receipt.target = pages[0]!.id;
  await save();
  runner = spawn(
    process.execPath,
    [
      "node_modules/vite-plus/bin/vp",
      "test",
      "run",
      "--config",
      "tests/e2e/conversation-work.config.ts",
    ],
    {
      cwd: ts,
      env: {
        ...env,
        WEB_BASE_URL: receipt.web,
        CDP_PORT: String(port),
        CDP_TARGET: receipt.target,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  // Use the workspace Vite+ binary through its actual CLI entry; a missing entry is a startup boundary.
  const code = await new Promise<number>((done, reject) => {
    const timer = setTimeout(() => {
      void stopOwned(runner!).catch((error) => receipt.cleanup.push(String(error)));
      reject(Error("Vitest deadline exceeded"));
    }, 300_000);
    runner!.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    runner!.once("exit", (value) => {
      clearTimeout(timer);
      done(value ?? 1);
    });
  });
  process.exitCode = code;
  receipt.result = code === 0 ? "PROVEN_BROWSER_SOURCE" : "FALSIFIED_OR_UNPROVEN_JOURNEY";
} catch (error) {
  receipt.result = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  if (runner?.exitCode === null && runner.signalCode === null) {
    await stopOwned(runner).catch((error) => receipt.cleanup.push(String(error)));
    await exited(runner, 5000).catch((error) => receipt.cleanup.push(String(error)));
  }
  if (!receipt.chrome && chromeAttempted) {
    try {
      const status = await exec("chrome-agent", ["status"], {
        timeout: 10_000,
        windowsHide: true,
      }).catch(() => null);
      if (status?.stdout.trim().startsWith("["))
        receipt.chrome =
          (JSON.parse(status.stdout) as { name: string; port: number }[]).find(
            (row) => row.port === port,
          )?.name ?? "";
    } catch (error) {
      receipt.cleanup.push(`Partial Chrome custody read failed: ${String(error)}`);
      process.exitCode = 1;
    }
  }
  if (receipt.chrome)
    await exec("chrome-agent", ["stop", receipt.chrome], {
      timeout: 20_000,
      windowsHide: true,
    }).then(
      () => receipt.cleanup.push(`stopped ${receipt.chrome}`),
      (error) => {
        receipt.cleanup.push(String(error));
        process.exitCode = 1;
      },
    );
  if (host) {
    if (token)
      await fetch(`http://127.0.0.1:${hostPort}/admin/shutdown`, {
        method: "POST",
        headers: { "x-pe-service-token": token },
        signal: AbortSignal.timeout(10_000),
      }).catch((error) => receipt.cleanup.push(String(error)));
    await exited(host, 15_000)
      .catch(async () => {
        if (host!.connected) host!.disconnect();
        await exited(host!, 5000);
      })
      .catch((error) => {
        receipt.cleanup.push(String(error));
        process.exitCode = 1;
      });
    if (host.exitCode === null && host.signalCode === null)
      await stopOwned(host)
        .then(() => exited(host!, 5000))
        .catch((error) => {
          receipt.cleanup.push(String(error));
          process.exitCode = 1;
        });
    receipt.cleanup.push(`owned host ${host.pid} exited=${host.exitCode ?? host.signalCode}`);
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await save();
  console.log(`Conversation Work custody: ${dir}`);
}
