import { HostReceipts } from "../src/gateway-owner.ts";
/** Real isolated-host browser proof: draft retention and durable-thread recovery. */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { devHostProxy } from "../../web/dev-proxy.ts";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/service-identity";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership } from "../src/host-ownership.ts";

const webRoot = resolve(import.meta.dirname, "..", "..", "web");

async function waitForService(appBase: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const file = await readServiceFile(appBase, hostOwnership.serviceName);
    if (file) return file;
    await new Promise((wait) => setTimeout(wait, 50));
  }
  throw new Error("service file did not appear");
}

let baseUrl = "";
// The host's own origin: `/admin/shutdown` is not one of the paths `devHostProxy` forwards, so
// posting it at `baseUrl` (the browser's vite server) 404s and `hostDone` never settles.
let hostUrl = "";
// biome-ignore lint/suspicious/noExplicitAny: the page type is not threaded through here.
let browser: { close(): Promise<void>; newPage(): Promise<any> } | undefined;
let hostDone: Promise<unknown> | undefined;
let serviceToken = "";
let browserVite: Awaited<ReturnType<typeof createViteServer>> | undefined;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "pe-demo-lane-"));
  const nodeServer = createNodeServer();
  // The dev host's shape: the frontend origin is recorded once the browser's Vite listens.
  // effect-edge: island, phase 5
  const webUrl = Effect.runSync(Deferred.make<string>());
  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      yield* Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: false },
            lifecycle: { handle, latch },
            nodeServer,
            port: 0,
            webRoot: null,
            webUrl,
          }).pipe(Layer.provide(HostReceipts.layer(null))),
        ),
        Deferred.await(latch),
      );
    }),
  );
  // effect-edge: island, phase 5
  hostDone = Effect.runPromise(program);
  const service = await waitForService(hostOwnership.rootPath);
  serviceToken = service.token;
  hostUrl = `http://127.0.0.1:${service.port}`;
  browserVite = await createViteServer({
    root: webRoot,
    // Keep the embedded SSR config in one module graph under Vitest (bundling produced HTTP 500).
    configLoader: "runner",
    configFile: join(webRoot, "vite.config.ts"),
    server: {
      host: "127.0.0.1",
      // This Vite reads port 0 as "unset" and starts at 5173, and the app config is strictPort, so a
      // running dev server made the suite fail. Let it walk to the next free port instead.
      strictPort: false,
      hmr: false,
      proxy: devHostProxy(`http://127.0.0.1:${service.port}`),
    },
  });
  await browserVite.listen();
  baseUrl = browserVite.resolvedUrls!.local[0]!.replace(/\/$/, "");
  // effect-edge: island, phase 5
  Effect.runSync(Deferred.succeed(webUrl, baseUrl));
  // As in route-chaos-launch, a bound port precedes the first SSR document compilation.
  // Leave Accept unset: text/html asks ingress for a browser-only human-session mint.
  const bootstrap = await fetch(baseUrl);
  const html = await bootstrap.text();
  expect(bootstrap.status).toBe(200);
  expect(bootstrap.headers.get("content-type")).toContain("text/html");
  expect(html).toMatch(/<html\b/i);
  const { chromium } = await import("playwright-core");
  const executablePath = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
  if (!executablePath) throw new Error("the demo lane needs Chrome or Edge");
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await fetch(`${hostUrl}/admin/shutdown`, {
    method: "POST",
    headers: { "x-pe-service-token": serviceToken },
  }).catch(() => undefined);
  await hostDone;
  await browserVite?.close();
}, 200_000);

// biome-ignore lint/suspicious/noExplicitAny: the page type is not threaded through here.
type Page = any;

const SCRATCH = process.env.PE_DEMO_LANE_SHOTS;

test("unissued Pea draft survives Home and Back without creating a conversation", async () => {
  const page = await browser!.newPage();
  const draft = "Unsent Home Back draft: preserve the original composer.";
  const evidence: Record<string, unknown> = {};
  try {
    await page.goto(`${baseUrl}/pea`, { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => page.getByRole("textbox", { name: "Message", exact: true }).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    expect(new URL(page.url()).searchParams.has("thread")).toBe(false);
    const issuedThread = new URL(page.url()).searchParams.get("thread");
    // Closing the last Place reveals the unissued composer without choosing a conversation.
    await expect.poll(() => new URL(page.url()).pathname).toBe("/pea");
    expect(new URL(page.url()).searchParams.get("thread")).toBe(issuedThread);
    const address = page.url();
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    await composer.fill(draft);
    expect(await composer.inputValue()).toBe(draft);
    const original = await composer.elementHandle();
    evidence.before = {
      address,
      draft: await composer.inputValue(),
      connected: await original.evaluate((node: HTMLElement) => node.isConnected),
    };
    await page.getByRole("button", { name: "Home / tool directory", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    evidence.home = {
      url: page.url(),
      originalConnected: await original.evaluate((node: HTMLElement) => node.isConnected),
    };
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect.poll(() => page.url()).toBe(address);
    await expect.poll(() => composer.inputValue(), { timeout: 15_000 }).toBe(draft);
    expect(
      await composer.evaluate(
        (node: HTMLElement, original: HTMLElement) => node === original,
        original,
      ),
    ).toBe(true);
    evidence.after = {
      address: page.url(),
      draft: await composer.inputValue(),
      originalConnected: await original.evaluate((node: HTMLElement) => node.isConnected),
    };
  } finally {
    if (SCRATCH) {
      writeFileSync(join(SCRATCH, "draft-home-back.json"), JSON.stringify(evidence, null, 2));
      writeFileSync(join(SCRATCH, "draft-home-back.html"), await page.content());
      await page.screenshot({ path: join(SCRATCH, "draft-home-back.png") });
    }
    await page.close();
  }
}, 90_000);

test("unsent draft remains current across real offline/online stream recovery", async () => {
  const page = await browser!.newPage();
  const requests: { method: string; url: string }[] = [];
  const responses: { status: number; url: string }[] = [];
  const draft = "Unsent reconnect draft: keep this exact text.";
  const evidence: Record<string, unknown> = {};
  page.on("request", (request: any) =>
    requests.push({ method: request.method(), url: request.url() }),
  );
  page.on("response", (response: any) =>
    responses.push({ status: response.status(), url: response.url() }),
  );
  const streams = () =>
    responses.filter(
      (response) => response.status === 200 && response.url.includes("/pe/resources"),
    ).length;
  try {
    await page.goto(`${baseUrl}/pea`, { waitUntil: "domcontentloaded" });
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    await expect.poll(() => composer.isVisible(), { timeout: 30_000 }).toBe(true);
    expect(new URL(page.url()).searchParams.has("thread")).toBe(false);
    await expect
      .poll(() => page.getByRole("textbox", { name: "Message", exact: true }).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect.poll(streams, { timeout: 30_000 }).toBeGreaterThan(0);
    await composer.fill(draft);
    const thread = new URL(page.url()).searchParams.get("thread");
    expect(thread).toBeNull();
    const before = streams();
    evidence.before = { thread, streams: before, draft: await composer.inputValue() };
    await page.context().setOffline(true);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await page.context().setOffline(false);
    await expect.poll(streams, { timeout: 15_000 }).toBeGreaterThan(before);
    await expect
      .poll(() => page.locator("[data-composer-send] [role='alert']").allTextContents(), {
        timeout: 15_000,
      })
      .not.toContain("This thread is not current; re-reading it from the host.");
    expect(await composer.inputValue()).toBe(draft);
    expect(new URL(page.url()).searchParams.get("thread")).toBe(thread);
    expect(
      requests.filter((request) => new URL(request.url).pathname === `/pe/threads/${thread}`),
    ).toEqual([]);
    expect(
      requests.filter(
        (request) => request.method === "POST" && /\/prompt(?:\?|$)/.test(request.url),
      ),
    ).toEqual([]);
    evidence.after = { thread, streams: streams(), draft: await composer.inputValue() };
  } finally {
    await page.context().setOffline(false);
    if (SCRATCH) {
      writeFileSync(
        join(SCRATCH, "thread-reconnect.json"),
        JSON.stringify({ ...evidence, requests, responses }, null, 2),
      );
      writeFileSync(join(SCRATCH, "thread-reconnect.html"), await page.content());
      await page.screenshot({ path: join(SCRATCH, "thread-reconnect.png") });
    }
    await page.close();
  }
}, 90_000);

test("empty persisted thread stays fenced until its real host reread lands", async () => {
  const page = await browser!.newPage();
  const responses: { status: number; url: string }[] = [];
  const evidence: Record<string, unknown> = {};
  const draft = "Unsent durable-thread draft: do not send.";
  let release = () => {};
  page.on("response", (response: any) =>
    responses.push({ status: response.status(), url: response.url() }),
  );
  try {
    await page.goto(`${baseUrl}/pea`, { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => page.getByRole("textbox", { name: "Message", exact: true }).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    // Real public host calls create an empty thread without starting a harness turn.
    const marker = { name: HOST_RUNTIME_SERVICE_HEADER, service: hostOwnership.serviceName };
    const created = await page.evaluate(async (marker: { name: string; service: string }) => {
      const headers = { [marker.name]: marker.service, "content-type": "application/json" };
      const providers = await fetch("/pe/providers", { headers }).then((response) =>
        response.json(),
      );
      const response = await fetch("/pe/threads", {
        method: "POST",
        headers,
        body: JSON.stringify({ providerId: providers[0].id }),
      });
      if (!response.ok) throw Error(`Create thread: ${response.status} ${await response.text()}`);
      const thread = await response.json();
      return fetch(`/pe/threads/${thread.id}`, { headers }).then((response) => response.json());
    }, marker);
    expect(created.events).toEqual([]);
    const bodyPath = `/pe/threads/${created.id}`;
    const bodies = () =>
      responses.filter(
        (response) => response.status === 200 && new URL(response.url).pathname === bodyPath,
      ).length;
    const before = bodies();
    await page.goto(`${baseUrl}/pea?thread=${created.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect.poll(bodies, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect
      .poll(() => page.getByRole("textbox", { name: "Message", exact: true }).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const follows = () =>
      responses.filter((response) => {
        const url = new URL(response.url);
        return (
          url.pathname === "/pe/resources" &&
          JSON.parse(url.searchParams.get("keys") ?? "[]").some(
            (key: { kind: string; thread?: string }) =>
              key.kind === "thread" && key.thread === created.id,
          )
        );
      }).length;
    // TODO: full host run intermittently sees no empty-thread /pe/resources response in 15 s; instrumented rerun passes. Prove attachment versus response flushing before changing this wait.
    await expect.poll(follows, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        (id: string) => sessionStorage.getItem(`pe.routeThread.${id}`),
        created.id,
      ),
    ).toBeNull();
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    await composer.fill(draft);
    evidence.selection = {
      created,
      url: page.url(),
      follows: follows(),
      draft: await composer.inputValue(),
    };
    let blocked = 0;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url: URL) => url.pathname === bodyPath,
      async (route: any) => {
        blocked++;
        await held;
        await route.continue();
      },
    );
    await page.context().setOffline(true);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await page.context().setOffline(false);
    await expect.poll(() => blocked, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect
      .poll(() => page.locator("[data-composer-send] [role='alert']").allTextContents(), {
        timeout: 15_000,
      })
      .toContain("This thread is not current; re-reading it from the host.");
    expect(await composer.inputValue()).toBe(draft);
    evidence.held = { head: created.head, blocked, draft: await composer.inputValue() };
    if (SCRATCH) await page.screenshot({ path: join(SCRATCH, "durable-thread-held.png") });
    const reads = bodies();
    release();
    await expect.poll(bodies, { timeout: 15_000 }).toBeGreaterThan(reads);
    await expect
      .poll(() => page.locator("[data-composer-send] [role='alert']").allTextContents(), {
        timeout: 15_000,
      })
      .toEqual([]);
    expect(await composer.inputValue()).toBe(draft);
    const fresh = await page.evaluate(
      ({ path, marker }: { path: string; marker: { name: string; service: string } }) =>
        fetch(path, { headers: { [marker.name]: marker.service } }).then((response) =>
          response.json(),
        ),
      { path: bodyPath, marker },
    );
    expect(fresh.head).toEqual(created.head);
    // Opening a real thread may discover models/commands; it still has no prompt or turn.
    expect(
      fresh.events.filter((event: { kind: string }) =>
        ["prompt", "turn_start", "turn_end"].includes(event.kind),
      ),
    ).toEqual([]);
    evidence.after = { head: fresh.head, draft: await composer.inputValue(), bodyReads: bodies() };
  } finally {
    release();
    await page.context().setOffline(false);
    if (SCRATCH) {
      writeFileSync(
        join(SCRATCH, "durable-thread-reconnect.json"),
        JSON.stringify({ ...evidence, responses }, null, 2),
      );
      writeFileSync(join(SCRATCH, "durable-thread-reconnect.html"), await page.content());
      await page.screenshot({ path: join(SCRATCH, "durable-thread-reconnect.png") });
    }
    await page.close();
  }
}, 90_000);

/** The app bar folds the Situation into a drawer that is inert until pinned (Ctrl+.); pin it so
 * its head, verbs and ladder are on the page. Pinning is page state, so every load pins again. */
