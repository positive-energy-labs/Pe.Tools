import { wait as waitFor, exited, stopOwned } from "../../../../tests/e2e/owned-runtime.ts";
// One no-Revit fixture-host command; reuse the canonical seed, navigation demo and journey helper.
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openBrowser } from "@pe/browser";
import { seedConversationWork, CONVERSATION_THREADS } from "../../../../tests/e2e/conversation-work.fixture.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const dir = join(root, ".artifacts", "jv7", String(Date.now()));
const home = join(dir, "home");
await mkdir(dir, { recursive: true });
await seedConversationWork(home, dir);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PE_TOOLS_PRODUCT_HOME: home,
  LOCALAPPDATA: join(dir, "localappdata"),
  APPDATA: join(dir, "appdata"),
  PE_LANE: "dev",
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
const host = spawn(
  process.execPath,
  ["--import", "jiti/register", "src/dev.ts", "--no-revit", "--no-tray"],
  {
    cwd: join(root, "ts/apps/host"),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  },
);
let log = "";
host.stdout!.on("data", (b) => {
  log += b;
});
host.stderr!.on("data", (b) => {
  log += b;
});
const wait = <T>(read: () => Promise<T | undefined>, name: string) => waitFor(async () => {
  if (host.exitCode !== null || host.signalCode !== null)
    throw Error(`PRECONDITION: host exited ${host.exitCode}: ${log.slice(-2000)}`);
  return read();
}, name, 120_000);
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
let service: any;
const receipt: any = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  started: new Date().toISOString(),
  dir,
  cleanup: [],
};
try {
  service = await wait(async () => {
    const folder = join(home, ".local-state/state/service");
    for (const file of await readdir(folder).catch(() => [])) {
      if (!file.endsWith("-no-revit.json")) continue;
      const row = JSON.parse(await readFile(join(folder, file), "utf8"));
      if (row.pid === host.pid && resolve(row.sourceRoot).toLowerCase() === root.toLowerCase())
        return row;
    }
  }, "owned service receipt");
  const web = await wait(
    async () => /Browser: (http:\/\/127\.0\.0\.1:\d+)/.exec(log)?.[1],
    "web origin",
  );
  const url = `${web}/fans?fixture=navigation&thread=${CONVERSATION_THREADS.empty}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !(await response.text()).includes("<html"))
    throw Error("PRECONDITION: source HTML unavailable");
  browser = await openBrowser({ mode: "headless", home: join(dir, "browser") });
  const tab = await browser.page();
  const target = tab.targetId;
  await tab.release();
  const child = spawn(process.execPath, ["--import", "jiti/register", "products/fans/web/journeys/jv7-fans.ts"], {
    cwd: join(root, "ts"),
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...env,
      E2E_LINKAGE_MODE: "fixture-linkage",
      E2E_TARGET: "", E2E_SESSION: "",
      E2E_WEB: url,
      E2E_LABEL: `base-${Date.now()}`,
      JV7_HOST: `http://127.0.0.1:${service.port}`,
      JV7_TOKEN: service.token,
      CDP_PORT: String(new URL(browser.info.endpoint).port),
      CDP_TARGET: target,
    },
  });
  await exited(child, 300_000).catch(async (error) => {
    await stopOwned(child);
    throw error;
  });
  receipt.code = child.exitCode ?? 1;
  process.exitCode = receipt.code;
} catch (error) {
  receipt.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
    receipt.cleanup.push("owned browser closed");
  }
  if (service)
    await fetch(`http://127.0.0.1:${service.port}/admin/shutdown`, {
      method: "POST",
      headers: { "x-pe-service-token": service.token },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  await exited(host, 15_000).catch(async () => {
    if (host.connected) host.disconnect();
    await exited(host, 5000).catch(() => stopOwned(host));
    receipt.cleanup.push("owned host terminated");
  });
  receipt.cleanup.push(`host exit=${host.exitCode}`);
  await writeFile(join(dir, "host.log"), log);
  await writeFile(join(dir, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(`J-V7 evidence: ${dir}`);
}
