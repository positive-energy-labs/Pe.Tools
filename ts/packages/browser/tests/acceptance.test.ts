import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { productRoot, osUserProductRoot } from "@pe/host-contracts/service-identity";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, access, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  openBrowser,
  attachBrowser,
  connectBrowser,
  connectCdp,
  connectCdpEffect,
  getBrowserEndpoint,
  getProtocol,
  listBrowsers,
  type BrowserSession,
  type BrowserPage,
  type SessionInfo,
  type CdpEvent,
} from "../src/index.ts";
import { fixtureServer } from "./fixtures/server.ts";
import { actionTrace } from "./fixtures/action-trace.ts";
import { readSessionReceipt } from "../src/receipts.ts";
import { assertProfileAvailable } from "../src/platform.ts";
import {
  processIdentities,
  sameProcess,
  rescueProcess,
  type ProcessIdentity,
} from "./fixtures/process-custody.ts";

const receipts: Record<string, unknown> = {
  source: resolve(import.meta.dirname, "../../../.."),
  started: new Date().toISOString(),
  manual: {
    google:
      "UNPROVEN: human must sign in through the retained profile's native Google UI, close and reopen, then confirm signed-in UI; no credentials are read by automation.",
    consent:
      "PROVEN by parent: personal-attach-proof.json records the real human-approved default autoConnect path with source hashes, trusted input, pre-existing tab preservation, own tab removal and closed keeper. personal-chrome-after.json records PID 70468 alive. This suite never contacts personal Chrome.",
  },
};
const receiptPath =
  process.env.PE_BROWSER_ACCEPTANCE_RECEIPT ??
  resolve(import.meta.dirname, "../../../../.artifacts/runs/browser-20261024-port/acceptance.json");
const sessions = new Set<BrowserSession>();
const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function cli(...args: string[]) {
  const result = await exec(process.execPath, [cliPath, "--home", home, ...args], {
    timeout: 30_000,
    windowsHide: true,
  });
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const children = new Set<ChildProcess>();
const processIds = new Set<number>();
const processHistory: ProcessIdentity[] = [];
const pidReassignments: { expected: ProcessIdentity; actual: ProcessIdentity }[] = [];
let home: string;
let server: Awaited<ReturnType<typeof fixtureServer>>;
const previousEnvironment = {
  PE_BROWSER_HOME: process.env.PE_BROWSER_HOME,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  PE_TOOLS_PRODUCT_HOME: process.env.PE_TOOLS_PRODUCT_HOME,
};
async function sourceHashes() {
  const paths = [
    ...(await readdir(new URL("../src", import.meta.url), { recursive: true }))
      .filter((path) => path.endsWith(".ts"))
      .map((path) => "../src/" + path.replaceAll("\\", "/")),
    "./acceptance.test.ts",
    "./fixtures/page.html",
    "./fixtures/server.ts",
    "./fixtures/worker.ts",
    "./fixtures/action-trace.ts",
    "./fixtures/public-types.typecheck.ts",
    "./fixtures/process-custody.ts",
    "../tsconfig.build.json",
    "../tsconfig.typing.json",
    "../package.json",
    "../vite.config.ts",
    "../../../tests/isolated-home/global-setup.ts",
    "../../../tests/isolated-home/setup.ts",
    "../../../pnpm-lock.yaml",
    "../../../tests/e2e/cdp.ts",
    "../../host-contracts/src/service-identity.ts",
    "../../host-contracts/src/product-paths.ts",
    "../../host-contracts/src/contracts/product.ts",
    "../../host-contracts/src/vendor/pe-service.ts",
    "../../host-contracts/src/vendor/generated/product.g.ts",
  ];
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(new URL(path, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  );
}
type ProcessRow = { ProcessId: number; ParentProcessId: number };
async function browserCensus(): Promise<ProcessRow[]> {
  if (process.platform !== "win32") return [];
  const result = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe' OR name = 'msedge.exe'\" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, timeout: 10_000 },
  );
  const rows = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(rows) ? rows : [rows];
}
const alive = (pid?: number) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(
  read: () => Promise<T> | T,
  label: string,
  ms = 15_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    await pause(50);
  }
  throw new Error(`Acceptance deadline: ${label}`);
}
async function remember(info: SessionInfo) {
  const pids = [info.pid, info.keeperPid, info.guardianPid].filter((pid): pid is number => !!pid);
  const identities = await processIdentities(pids);
  expect(
    identities.map((identity) => identity.pid).sort((a, b) => a - b),
    "ready session process identities must be captured",
  ).toEqual([...pids].sort((a, b) => a - b));
  for (const identity of identities) {
    const provenance = identity.pid === info.pid ? info.profile : resolve(info.receipt, "..");
    expect(
      identity.command.toLowerCase(),
      "live process must match this session's provenance",
    ).toContain(provenance!.toLowerCase());
    if (!processHistory.some((previous) => sameProcess(previous, identity)))
      processHistory.push(identity);
  }
  for (const pid of pids) processIds.add(pid);
}
async function ownedSurvivors() {
  const current = await processIdentities([...processIds].filter(alive));
  for (const actual of current) {
    for (const expected of processHistory.filter((previous) => previous.pid === actual.pid)) {
      if (
        !sameProcess(expected, actual) &&
        !pidReassignments.some((row) => sameProcess(row.actual, actual))
      )
        pidReassignments.push({ expected, actual });
    }
  }
  return current.filter((actual) =>
    processHistory.some((expected) => sameProcess(expected, actual)),
  );
}
async function launch(options: Parameters<typeof openBrowser>[0] = {}) {
  const session = await openBrowser({ home, ...options });
  sessions.add(session);
  await remember(session.info);
  return session;
}
function worker(mode: string, value = "", target = "") {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./fixtures/worker.ts", import.meta.url)), mode, home, value, target],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  children.add(child);
  const messages: any[] = [];
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("message", (message) => messages.push(message));
  return {
    child,
    async message(kind: string) {
      return until(
        () => {
          const index = messages.findIndex((message) => message.kind === kind);
          if (index >= 0) return messages.splice(index, 1)[0];
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error(`Worker exited before ${kind}: ${stderr}`);
        },
        `worker ${child.pid} ${kind}`,
        30_000,
      );
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.send("close");
      await until(() => child.exitCode !== null || child.signalCode !== null, "worker close");
    },
  };
}
async function evaluate<T>(page: BrowserPage, expression: string): Promise<T> {
  const result = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value as T;
}
async function point(page: BrowserPage, selector: string) {
  const result = await evaluate<{ x: number; y: number }>(
    page,
    `(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,selector:${JSON.stringify(selector)},hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,240),viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},visibility:document.visibilityState}})()`,
  );
  return { x: result.x, y: result.y };
}
async function click(page: BrowserPage, selector: string) {
  const position = await point(page, selector);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position });
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...position,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...position,
    button: "left",
    clickCount: 1,
  });
}

function futureEvent(page: BrowserPage, method: string, timeoutMs = 15_000) {
  let accept!: (event: CdpEvent) => void;
  let reject!: (error: Error) => void;
  const event = new Promise<CdpEvent>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  const unsubscribe = page.subscribe((value) => {
    if (value.method !== method) return;
    clearTimeout(timer);
    unsubscribe();
    accept(value);
  });
  const timer = setTimeout(() => {
    unsubscribe();
    reject(new Error(`Future event deadline: ${method}`));
  }, timeoutMs);
  return {
    event,
    cancel: () => {
      clearTimeout(timer);
      unsubscribe();
    },
  };
}

beforeAll(async () => {
  const testHomeRoot = process.env.PE_TEST_HOME_ROOT;
  if (!testHomeRoot) throw new Error("Browser acceptance requires isolated-home global setup.");
  home = await mkdtemp(join(testHomeRoot, "pe-browser-acceptance-"));
  process.env.PE_BROWSER_HOME = home;
  process.env.LOCALAPPDATA = join(home, "os-user");
  process.env.PE_TOOLS_PRODUCT_HOME = join(home, "product-home");
  await mkdir(osUserProductRoot(), { recursive: true });
  receipts.storageEnvironment = {
    testHomeRoot,
    localAppData: process.env.LOCALAPPDATA,
    productHome: process.env.PE_TOOLS_PRODUCT_HOME,
  };
  receipts.browserCensusBefore = await browserCensus();
  receipts.sourceHashes = await sourceHashes();
  receipts.checkoutHead = (
    await exec("git", ["rev-parse", "HEAD"], { cwd: resolve(import.meta.dirname, "../../../..") })
  ).stdout.trim();
  server = await fixtureServer();
  receipts.home = home;
  receipts.fixture = server.url;
});
afterAll(async () => {
  try {
    const cleanup: string[] = [];
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const session of sessions) {
      if (!alive(session.info.keeperPid)) continue;
      const receipt = await readSessionReceipt(session.info.receipt);
      if (receipt?.status !== "closed")
        await session.close().catch((error) => cleanup.push(String(error)));
    }
    // Recover published worker receipts even if the public list operation itself is broken.
    for (const id of await readdir(home)) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) continue;
      try {
        const receipt = await readSessionReceipt(join(home, id, "session.json"));
        if (!receipt) continue;
        if (receipt.status !== "active") continue;
        await remember(receipt.info);
        const session = await connectBrowser(id, { home });
        await session.close();
      } catch (error) {
        cleanup.push(String(error));
      }
    }
    await until(
      async () => (await ownedSurvivors()).length === 0,
      "final owned process census",
      5000,
    ).catch(() => undefined);
    // Windows can reuse an exited keeper PID while later cases are still running.
    const survivorIdentities = await ownedSurvivors();
    const survivors = survivorIdentities.map((identity) => identity.pid);
    receipts.unexpectedSurvivorsBeforeRescue = survivors;
    receipts.processHistory = processHistory;
    receipts.pidReassignments = pidReassignments;
    receipts.survivorIdentities = survivorIdentities;
    for (const identity of survivorIdentities) {
      try {
        await rescueProcess(identity);
      } catch {}
    }
    await server?.close();
    receipts.browserCensusAfter = await browserCensus();
    receipts.sourceHashesAfter = await sourceHashes();
    receipts.cleanupErrors = cleanup;
    receipts.finished = new Date().toISOString();
    const output = receiptPath;
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(output, JSON.stringify(receipts, null, 2));
    if (!survivors.length && !cleanup.length) await rm(home, { recursive: true, force: true });
    expect(survivors, "owned process census must be empty before rescue").toEqual([]);
    expect(cleanup, "session cleanup must not require rescue").toEqual([]);
    expect(receipts.sourceHashesAfter, "source must stay stable during browser acceptance").toEqual(
      receipts.sourceHashes,
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    receipts.environmentRestored = Object.entries(previousEnvironment).every(
      ([key, value]) => process.env[key] === value,
    );
    await mkdir(resolve(receiptPath, ".."), { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipts, null, 2));
  }
});

test("A0 default browser home uses the canonical isolated product root", async () => {
  const expectedProductRoot = productRoot();
  const namespace = osUserProductRoot();
  const override = process.env.PE_TOOLS_PRODUCT_HOME;
  try {
    delete process.env.PE_TOOLS_PRODUCT_HOME;
    expect(productRoot()).toBe(namespace);
  } finally {
    process.env.PE_TOOLS_PRODUCT_HOME = override;
  }
  const browser = await openBrowser();
  sessions.add(browser);
  await remember(browser.info);
  expect(browser.info.receipt).toBe(
    join(expectedProductRoot, "state", "browser", browser.info.id, "session.json"),
  );
  expect(await exists(browser.info.receipt)).toBe(true);
  expect((await listBrowsers()).map((info) => info.id)).toEqual([browser.info.id]);
  const page = await browser.page();
  expect(await evaluate(page, "1+1")).toBe(2);
  await browser.close();
  expect(await listBrowsers()).toEqual([]);
  expect((await readSessionReceipt(browser.info.receipt))?.status).toBe("closed");
  receipts.A0 = {
    productRoot: expectedProductRoot,
    osUserProductRoot: namespace,
    info: browser.info,
    targetId: page.targetId,
  };
});

test("A1 typed/raw forwarding, concurrent replies, isolated events and live schema", async () => {
  expect(await cli("list")).toEqual([[]]);
  const browser = await launch();
  const page = await browser.page({ url: server.url });
  await page.send("Runtime.enable");
  const events: string[] = [];
  const throwing = page.subscribe(() => {
    throw new Error("deliberate subscriber fault");
  });
  const unsubscribe = page.subscribe((event) => events.push(event.method));
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, value) => evaluate<number>(page, String(value))),
  );
  expect(results).toEqual(Array.from({ length: 20 }, (_, value) => value));
  await page.sendRaw("Runtime.evaluate", { expression: "console.log('event-witness')" });
  await until(
    () => events.includes("Runtime.consoleAPICalled"),
    "event delivered despite subscriber throw",
  );
  throwing();
  unsubscribe();
  const before = events.length;
  await page.sendRaw("Runtime.evaluate", { expression: "console.log('after-unsubscribe')" });
  await pause(100);
  expect(events.length).toBe(before);
  await expect(page.sendRaw("PeAcceptance.newerUnknownCommand")).rejects.toMatchObject({
    code: "ProtocolError",
    method: "PeAcceptance.newerUnknownCommand",
    outcome: "rejected",
  });
  const protocol = await browser.protocol();
  expect(
    (protocol.domains as { domain: string }[]).some((domain) => domain.domain === "Page"),
  ).toBe(true);
  const direct = await connectCdp(await getBrowserEndpoint(browser.info.endpoint));
  expect((await direct.send("Browser.getVersion")).product).toContain("Chrome");
  await direct.close();
  let scoped!: Awaited<ReturnType<typeof connectCdp>>;
  const endpoint = await getBrowserEndpoint(browser.info.endpoint);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        scoped = yield* connectCdpEffect(endpoint);
        yield* Effect.promise(() => scoped.send("Browser.getVersion"));
      }),
    ),
  );
  await expect(scoped.send("Browser.getVersion")).rejects.toMatchObject({ code: "Closed" });
  receipts.A1 = {
    info: browser.info,
    targetId: page.targetId,
    concurrentReplies: results,
    protocolDomains: (protocol.domains as unknown[]).length,
  };
  await page.close();
  const help = await cli("help", browser.info.id, "Page.navigate");
  expect(help[0].help).toContain("Page.navigate");
  expect(help[0].help).toContain("url: string");
  const cliPage = await browser.page();
  const cliTarget = cliPage.targetId;
  await cliPage.send("Runtime.evaluate", {
    expression: "setTimeout(()=>console.log('cli-event-witness'),1500)",
  });
  await cliPage.release();
  const paramsFile = join(home, "cli-params.json");
  await writeFile(paramsFile, JSON.stringify({ expression: "6*7", returnByValue: true }));
  const forwarded = await cli(
    browser.info.id,
    "Runtime.evaluate",
    "--target",
    cliTarget,
    "--params-file",
    paramsFile,
  );
  expect(forwarded[0].result.value).toBe(42);
  const stream = await cli(
    "events",
    browser.info.id,
    "--target",
    cliTarget,
    "--method",
    "Runtime.consoleAPICalled",
    "--duration-ms",
    "2200",
  );
  expect(stream.some((event) => JSON.stringify(event).includes("cli-event-witness"))).toBe(true);
  receipts.cli = { help, forwarded, stream };
  await browser.close();
});

test("A2 real headless and visible owned launch with target provenance", async () => {
  const results = [];
  for (const mode of ["headless", "visible"] as const) {
    const browser = await launch({
      mode,
      args: ["--window-position=40,40", "--window-size=800,600"],
    });
    const page = await browser.page({ url: server.url });
    await until(
      () =>
        evaluate<string>(page, "document.title").then(
          (value) => value === "Pe browser native acceptance",
        ),
      "native page title",
    );
    expect(browser.info.custody).toBe("owned");
    expect(browser.info.mode).toBe(mode);
    expect(alive(browser.info.pid)).toBe(true);
    if (mode === "visible") await page.send("Page.bringToFront");
    results.push({ info: browser.info, targetId: page.targetId });
    await browser.close();
    await until(() => !alive(browser.info.pid), "owned browser process closed");
  }
  receipts.A2 = results;
});

test("A3 four independent workers and two attached clients with target contention", async () => {
  const workers = Array.from({ length: 4 }, () => worker("owned"));
  const ready = await Promise.all(workers.map((item) => item.message("ready")));
  for (const item of ready) await remember(item.info);
  expect(new Set(ready.map((item) => item.info.pid)).size).toBe(4);
  expect(new Set(ready.map((item) => item.info.profile)).size).toBe(4);
  for (const item of workers) item.child.send("read");
  const reads = await Promise.all(workers.map((item) => item.message("read")));
  reads.forEach((row, index) => expect(row.value).toBe(`worker-${workers[index]!.child.pid}`));
  await Promise.all(workers.map((item) => item.stop()));
  for (const item of ready)
    await until(() => !alive(item.info.pid), "parallel worker browser closed");
  const foreign = await launch();
  const attachedSession = await attachBrowser({ endpoint: foreign.info.endpoint, home });
  sessions.add(attachedSession);
  await remember(attachedSession.info);
  const competingHome = join(home, "other-client-home");
  await expect(
    attachBrowser({ endpoint: foreign.info.endpoint, home: competingHome }),
  ).rejects.toMatchObject({
    code: "AttachmentBusy",
    data: { existing: { id: attachedSession.info.id, home } },
  });
  const cliBusy = await exec(
    process.execPath,
    [cliPath, "--home", competingHome, "attach", "--endpoint", foreign.info.endpoint],
    {
      timeout: 30_000,
      windowsHide: true,
    },
  ).then(
    () => {
      throw new Error("Duplicate CLI attachment unexpectedly succeeded");
    },
    (error) => {
      expect(error.code).toBe(1);
      return JSON.parse(String(error.stderr).trim());
    },
  );
  expect(cliBusy.error).toMatchObject({
    code: "AttachmentBusy",
    data: { existing: { id: attachedSession.info.id, home } },
  });
  const secondProductHome = join(home, "second-product-home");
  const crossProductBusy = await exec(
    process.execPath,
    [cliPath, "--home", competingHome, "attach", "--endpoint", foreign.info.endpoint],
    {
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, PE_TOOLS_PRODUCT_HOME: secondProductHome },
    },
  ).then(
    async (result) => {
      const unexpected = JSON.parse(result.stdout);
      const session = await connectBrowser(unexpected.id, { home: competingHome });
      sessions.add(session);
      await remember(session.info);
      await session.close();
      throw new Error("Cross-product-home attachment unexpectedly succeeded");
    },
    (error) => {
      expect(error.code).toBe(1);
      return JSON.parse(String(error.stderr).trim());
    },
  );
  expect(crossProductBusy.error).toMatchObject({
    code: "AttachmentBusy",
    data: { existing: { id: attachedSession.info.id, home } },
  });
  const clients = [
    worker("connect", attachedSession.info.id),
    worker("connect", attachedSession.info.id),
  ];
  const attached = await Promise.all(clients.map((item) => item.message("ready")));
  expect(attached[0].targetId).not.toBe(attached[1].targetId);
  const contender = await connectBrowser(attached[0].info.id, { home, clientId: "contender" });
  await expect(contender.page({ targetId: attached[0].targetId })).rejects.toMatchObject({
    code: "PageBusy",
  });
  await contender.disconnect();
  clients.forEach((item) => item.child.send("read"));
  const attachedReads = await Promise.all(clients.map((item) => item.message("read")));
  attachedReads.forEach((row, index) =>
    expect(row.value).toBe(`worker-${clients[index]!.child.pid}`),
  );
  clients[0]!.child.kill("SIGKILL");
  await until(
    async () =>
      !(await attachedSession.targets()).some((target) => target.id === attached[0].targetId),
    "killed shared client created target cleanup",
  );
  clients[1]!.child.send("navigate");
  await clients[1]!.message("navigated");
  clients[1]!.child.send("read");
  const survivor = await clients[1]!.message("read");
  expect(survivor.value).toBe("surviving-client");
  await clients[1]!.stop();
  await attachedSession.close();
  expect(alive(foreign.info.pid)).toBe(true);
  receipts.A3 = {
    workers: ready,
    reads,
    attached,
    attachedReads,
    survivor,
    cliBusy,
    crossProductBusy,
    productHomes: [process.env.PE_TOOLS_PRODUCT_HOME, secondProductHome],
    osUserProductRoot: osUserProductRoot(),
  };
  await foreign.close();
});

test("A4 abort, deadline, disconnect, assertion/launch failure and hard-kill cleanup", async () => {
  const browser = await launch();
  const page = await browser.page();
  await expect(
    page.sendRaw(
      "Runtime.evaluate",
      {
        expression:
          "globalThis.timeoutMutations=(globalThis.timeoutMutations??0)+1;new Promise(()=>{})",
        awaitPromise: true,
      },
      { timeoutMs: 100 },
    ),
  ).rejects.toMatchObject({ code: "Timeout", outcome: "unknown" });
  await pause(200);
  expect(await evaluate(page, "globalThis.timeoutMutations")).toBe(1);
  const abort = new AbortController();
  const aborted = page.sendRaw(
    "Runtime.evaluate",
    { expression: "new Promise(()=>{})", awaitPromise: true },
    { signal: abort.signal },
  );
  const abortCheck = expect(aborted).rejects.toMatchObject({ code: "Aborted", outcome: "unknown" });
  abort.abort();
  await abortCheck;
  const direct = await connectCdp(
    (await browser.targets()).find((target) => target.id === page.targetId)!.webSocketDebuggerUrl!,
  );
  const pending = direct.sendRaw("Runtime.evaluate", {
    expression: "new Promise(()=>{})",
    awaitPromise: true,
  });
  const dropped = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
  await direct.close();
  await dropped;
  await browser.close();
  const badHome = join(home, "failed-launch");
  await expect(
    openBrowser({
      home: badHome,
      executablePath: join(home, "missing-browser.exe"),
      timeoutMs: 500,
    }),
  ).rejects.toBeDefined();
  expect(await listBrowsers({ home: badHome })).toEqual([]);
  let failed!: SessionInfo;
  try {
    const owned = await launch();
    failed = owned.info;
    try {
      expect(false, "forced assertion failure").toBe(true);
    } finally {
      await owned.close();
    }
  } catch (error) {
    expect(String(error)).toContain("forced assertion failure");
  }
  expect(alive(failed.pid)).toBe(false);
  const kills = [];
  for (const killed of ["worker", "keeper"] as const) {
    const item = worker("owned");
    const ready = await item.message("ready");
    await remember(ready.info);
    if (killed === "worker") item.child.kill("SIGKILL");
    else {
      expect(ready.info.keeperPid).toBeTypeOf("number");
      process.kill(ready.info.keeperPid, "SIGKILL");
    }
    await until(() => !alive(ready.info.pid), `${killed} hard kill reaps owned Chrome`, 20_000);
    await until(
      async () => !(await exists(ready.info.profile)),
      `${killed} hard kill deletes disposable profile`,
      20_000,
    );
    if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill("SIGKILL");
    kills.push({ killed, ...ready });
  }
  receipts.A4 = { failedLaunch: badHome, assertionFailure: failed, kills };
});

test("A5 retained authenticated HttpOnly cookie survives reopen; concurrent profile lock refuses", async () => {
  const profile = join(home, "retained profile Ω 雪");
  const browser = await launch({ profile });
  await writeFile(join(home, "ordinary-fixture.json"), "{}");
  await mkdir(join(home, "ordinary-profile-directory"));
  expect((await listBrowsers({ home })).map((info) => info.id)).toEqual([browser.info.id]);
  const page = await browser.page({ url: server.url });
  await until(
    () => evaluate<string>(page, "location.origin").then((origin) => origin === server.url),
    "retained origin",
  );
  await page.send("Runtime.evaluate", {
    expression: "localStorage.setItem('retained','native-profile-state')",
  });
  const authStart = server.authRequests.length;
  await click(page, "#sign-in");
  await until(
    () =>
      evaluate<string>(page, "document.body.innerText").then((text) =>
        text.includes("Signed in as fixture-operator"),
      ),
    "native sign-in rendered account",
  );
  expect(
    server.authRequests
      .slice(authStart)
      .some((request) => request.path === "/sign-in" && request.method === "POST"),
  ).toBe(true);
  expect(
    server.authRequests
      .slice(authStart)
      .some((request) => request.path === "/account" && request.authenticated),
  ).toBe(true);
  // The account cookie is HttpOnly: rendered authenticated UI and the server witness own this proof.
  expect(await evaluate<string>(page, "document.cookie")).not.toContain("pe_fixture_auth");
  await browser.close();
  expect(await exists(profile)).toBe(true);
  const reopened = await launch({ profile });
  const reread = await reopened.page({ url: server.url + "/account" });
  await until(
    () => evaluate<string>(reread, "location.origin").then((origin) => origin === server.url),
    "reopened origin",
  );
  expect(await evaluate(reread, "localStorage.getItem('retained')")).toBe("native-profile-state");
  await until(
    () =>
      evaluate<string>(reread, "document.body.innerText").then((text) =>
        text.includes("Signed in as fixture-operator"),
      ),
    "retained authenticated account after restart",
  );
  expect(
    server.authRequests
      .slice(authStart)
      .filter((request) => request.path === "/account" && request.authenticated).length,
  ).toBeGreaterThanOrEqual(2);
  receipts.A5 = {
    profile,
    first: browser.info,
    reopened: reopened.info,
    serverObservedAuth: server.authRequests.slice(authStart),
    googleSignIn: "manual checkpoint, not exercised",
  };
  await expect(assertProfileAvailable(profile)).rejects.toMatchObject({ code: "ProfileBusy" });
  await expect(openBrowser({ home, profile, timeoutMs: 1000 })).rejects.toMatchObject({
    code: "ProfileBusy",
  });
  await reopened.close();
  expect(await exists(profile)).toBe(true);
});

test("A6 attached close/client death preserve foreign browser and borrowed page", async () => {
  const foreign = await launch();
  const borrowed = await foreign.page({ url: server.url });
  const borrowedId = borrowed.targetId;
  await borrowed.release();
  const attached = await attachBrowser({ endpoint: foreign.info.endpoint, home });
  sessions.add(attached);
  const claim = await attached.page({ targetId: borrowedId });
  const created = await attached.page();
  await claim.release();
  await created.release();
  await attached.close();
  expect(alive(foreign.info.pid)).toBe(true);
  const targets = await foreign.targets();
  expect(targets.some((target) => target.id === borrowedId)).toBe(true);
  expect(targets.some((target) => target.id === created.targetId)).toBe(false);
  const dead = worker("attach", foreign.info.endpoint);
  const ready = await dead.message("ready");
  const deadSession = await connectBrowser(ready.info.id, { home });
  sessions.add(deadSession);
  await remember(ready.info);
  dead.child.kill("SIGKILL");
  await until(
    async () => !(await foreign.targets()).some((target) => target.id === ready.targetId),
    "failed attached client created tab cleanup",
    20_000,
  );
  expect(alive(foreign.info.pid)).toBe(true);
  expect((await foreign.targets()).some((target) => target.id === borrowedId)).toBe(true);
  receipts.A6 = {
    foreign: foreign.info,
    borrowedId,
    createdId: created.targetId,
    failedClient: ready,
    consent:
      "parent personal-attach-proof.json passed real consent; this test uses only an owned fixture browser",
  };
  await deadSession.close();
  await foreign.close();
});

test("A7 native full-page journey: trusted input, frames, dialogs, files, network and screenshots", async () => {
  const browser = await launch();
  const trace = await actionTrace(receiptPath.replace(/\.json$/, "") + "-a7-trace.jsonl");
  const page = trace.page(await browser.page());
  receipts.A7Trace = trace.path;
  try {
    await trace.phase("setup", { info: browser.info, targetId: page.targetId });
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Network.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1400,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const events: { method: string; params: Record<string, unknown> }[] = [];
    const unsubscribe = page.subscribe((event) => events.push(event));
    await trace.phase("navigate");
    await page.send("Page.navigate", { url: server.url });
    await until(
      () => evaluate<boolean>(page, "document.readyState==='complete'"),
      "native fixture load",
    );
    await trace.phase("text-and-keyboard");
    await click(page, "#name");
    await page.send("Input.insertText", { text: "Native Ada" });
    await page.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "End",
      windowsVirtualKeyCode: 35,
    });
    await page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "End",
      windowsVirtualKeyCode: 35,
    });
    await trace.phase("checkbox-and-native-select");
    await click(page, "#check");
    await click(page, "#choice");
    await page.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await page.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await trace.phase("submit-and-trust-readback");
    await click(page, "#submit");
    expect(await evaluate(page, "document.querySelector('#result').textContent")).toBe(
      "Native Ada|true|Second|trusted=true",
    );
    expect(await evaluate(page, "document.querySelector('#input-trust').textContent")).toBe(
      "input-trusted=true",
    );
    expect(await evaluate(page, "document.querySelector('#keyboard-trust').textContent")).toBe(
      "keyboard-trusted=true",
    );
    await trace.phase("hover");
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...(await point(page, "#hover")),
    });
    expect(
      await evaluate(page, "getComputedStyle(document.querySelector('#tip')).visibility"),
    ).toBe("visible");
    await trace.phase("native-range-drag");
    const start = await point(page, "#drag"),
      end = { ...start, x: start.x + 115 };
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
    await page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...start,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 10; step++)
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: start.x + ((end.x - start.x) * step) / 10,
        y: start.y + ((end.y - start.y) * step) / 10,
        button: "left",
        buttons: 1,
      });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...end,
      button: "left",
      clickCount: 1,
    });
    receipts.dragWitness = {
      start,
      end,
      native: await evaluate(
        page,
        "({...document.documentElement.dataset,hit:document.elementFromPoint(" +
          start.x +
          "," +
          start.y +
          ")?.outerHTML,scrollY,innerHeight})",
      ),
    };
    expect(
      await evaluate<number>(page, "Number(document.querySelector('#drag').value)"),
    ).toBeGreaterThanOrEqual(90);
    expect(await evaluate(page, "document.querySelector('#drop').textContent")).toMatch(
      /^Dragged\|trusted=true\|value=/,
    );
    await trace.phase("native-dialog");
    const dialogOpened = futureEvent(page, "Page.javascriptDialogOpening");
    const dialogResult = click(page, "#dialog").then(
      () => ({ error: undefined }),
      (error) => ({ error }),
    );
    try {
      await dialogOpened.event;
      await page.send("Page.handleJavaScriptDialog", { accept: true });
      const result = await dialogResult;
      if (result.error) throw result.error;
    } finally {
      dialogOpened.cancel();
    }
    expect(await evaluate(page, "document.querySelector('#dialog-result').textContent")).toBe(
      "accepted",
    );
    await trace.phase("popup");
    await click(page, "#popup");
    const popup = await until(
      async () => (await browser.targets()).find((target) => target.url.endsWith("/popup")),
      "native popup target",
    );
    const popupPage = trace.page(await browser.page({ targetId: popup.id }));
    expect(await evaluate(popupPage, "document.body.innerText")).toContain("Native popup");
    await popupPage.release();
    await trace.phase("file-upload");
    const document = await page.send("DOM.getDocument");
    const input = await page.send("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: "#upload",
    });
    const upload = join(home, "native-upload.txt");
    await writeFile(upload, "native upload\n");
    await page.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [upload] });
    expect(await evaluate(page, "document.querySelector('#file-result').textContent")).toBe(
      "native-upload.txt",
    );
    await trace.phase("network-success");
    await click(page, "#network");
    await until(
      () =>
        evaluate<string>(page, "document.querySelector('#network').textContent").then(
          (value) => value === "Resource loaded",
        ),
      "rendered network response",
    );
    expect(server.requests).toContain("/resource");
    expect(
      events.some(
        (event) =>
          event.method === "Network.responseReceived" &&
          (event.params.response as { url?: string })?.url?.endsWith("/resource"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.method === "Runtime.consoleAPICalled")).toBe(true);
    await trace.phase("network-failure");
    await click(page, "#network-failure");
    await until(
      () =>
        evaluate<string>(
          page,
          "document.querySelector('#network-failure-result').textContent",
        ).then((text) => text === "Network failed"),
      "native failed network renders failure",
    );
    expect(events.some((event) => event.method === "Network.loadingFailed")).toBe(true);
    await trace.phase("console-and-page-exception");
    await click(page, "#console-failure");
    await click(page, "#page-failure");
    await until(
      () => events.some((event) => event.method === "Runtime.exceptionThrown"),
      "uncaught native page exception observed",
    );
    expect(
      events.some(
        (event) => event.method === "Runtime.consoleAPICalled" && event.params.type === "error",
      ),
    ).toBe(true);
    await trace.phase("iframe-trusted-input");
    const frames = await page.send("Page.getFrameTree");
    const frame = frames.frameTree.childFrames![0]!.frame.id;
    const world = await page.send("Page.createIsolatedWorld", { frameId: frame });
    const frameBox = await point(page, "iframe");
    await page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: frameBox.x - 240,
      y: frameBox.y - 40,
      button: "left",
      clickCount: 1,
    });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: frameBox.x - 240,
      y: frameBox.y - 40,
      button: "left",
      clickCount: 1,
    });
    const frameRead = await page.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      contextId: world.executionContextId,
      returnByValue: true,
    });
    expect(frameRead.result.value).toContain("Frame trusted");
    await trace.phase("file-download");
    const downloads = join(home, "downloads");
    await mkdir(downloads);
    const browserCdp = trace.client(
      await connectCdp(await getBrowserEndpoint(browser.info.endpoint)),
    );
    await browserCdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
    });
    await click(page, "#download");
    await until(
      async () => (await readdir(downloads)).includes("fixture.txt"),
      "native downloaded file",
    );
    expect(await readFile(join(downloads, "fixture.txt"), "utf8")).toBe("Pe native download\n");
    const downloadEvidence = resolve(receiptPath, "../native-download.txt");
    await mkdir(resolve(downloadEvidence, ".."), { recursive: true });
    await writeFile(downloadEvidence, await readFile(join(downloads, "fixture.txt")));
    await browserCdp.close();
    const foregroundBefore = await evaluate<{ visibility: string; focused: boolean }>(
      page,
      "({visibility:document.visibilityState,focused:document.hasFocus()})",
    );
    const foregroundTargets = await browser.targets();
    await trace.phase("wheel-foreground-observation", {
      before: foregroundBefore,
      targets: foregroundTargets,
    });
    if (foregroundBefore.visibility !== "visible" || !foregroundBefore.focused)
      await page.send("Page.bringToFront");
    const foregroundAfter = await until(async () => {
      const value = await evaluate<{ visibility: string; focused: boolean }>(
        page,
        "({visibility:document.visibilityState,focused:document.hasFocus()})",
      );
      return value.visibility === "visible" && value.focused ? value : undefined;
    }, "original page foreground after popup and download");
    receipts.A7Foreground = {
      before: foregroundBefore,
      after: foregroundAfter,
      targets: foregroundTargets,
    };
    await trace.phase("wheel-and-bottom-control");
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 900,
      y: 800,
      deltaX: 0,
      deltaY: 1400,
    });
    await until(() => evaluate<boolean>(page, "scrollY>500"), "trusted wheel scroll");
    await click(page, "#bottom");
    expect(await evaluate(page, "document.querySelector('#scroll-result').textContent")).toBe(
      "scrolled=true|trusted=true",
    );
    await trace.phase("full-page-screenshot");
    const layout = await page.send("Page.getLayoutMetrics");
    const screenshot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: layout.cssContentSize.width,
        height: layout.cssContentSize.height,
        scale: 1,
      },
    });
    const bytes = Buffer.from(screenshot.data, "base64");
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(1000);
    const image = resolve(receiptPath, "../native-full-page.png");
    await mkdir(resolve(image, ".."), { recursive: true });
    await writeFile(image, bytes);
    unsubscribe();
    receipts.A7 = {
      info: browser.info,
      targetId: page.targetId,
      popupId: popup.id,
      frameId: frame,
      image,
      download: downloadEvidence,
      eventMethods: [...new Set(events.map((event) => event.method))],
      requests: server.requests,
    };
    await trace.phase("session-cleanup");
    await browser.close();
  } finally {
    await trace.finish();
  }
});

test("A8 route adapter uses the frozen API; live route replay remains an independent gate", async () => {
  const helper = await import("../../../tests/e2e/cdp.ts");
  const browser = await launch();
  const target = await browser.page();
  const targetId = target.targetId;
  await target.release();
  const port = Number(new URL(browser.info.endpoint).port);
  const page = await helper.connect(port, targetId);
  try {
    await page.open(server.url);
    await page.clickAt("#name");
    await page.type("Route adapter");
    await page.click("Submit");
    expect(await page.textOf("#result")).toContain("Route adapter");
  } finally {
    await page.close();
    await browser.close();
  }
  receipts.A8 = {
    adapter: "trusted fixture journey passed",
    routeReplay:
      "UNPROVEN: parent runs journey:routes during quiet source window; original route-chaos assertions retained",
  };
  expect((await getProtocol(port).catch(() => ({ closed: true }))).closed).toBe(true);
});
