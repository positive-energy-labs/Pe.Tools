/**
 * THE PROOF LANE. Every route manifest that declares `seeds`, every `[action, seed]` pair, in a
 * real browser against the real host: `?demo=<action>` mounts the seed in an isolated owner and
 * the head draws the seed's words. A seed is a READ-ONLY proof input — `useRoute` refuses every
 * action under `?demo=` ("frozen seed is read-only") — so this lane proves render and parity, not
 * execution: the Situation renders, every verb is disabled with that one sentence, nothing throws
 * and nothing is POSTed. Seeds are plain data, so this file enumerates them from the manifests
 * themselves — a new seed is a new test with no edit here.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { devHostProxy } from "../../web/dev-proxy.ts";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { createDeterministicRuntime } from "@pe/runtime/testing";
import { resolvePeaWorld } from "@pe/runtime/pea";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { makeMastraRuntimeLive } from "../src/mastra-runtime.ts";

type AnyManifest = {
  key: string;
  name: string;
  actions: Record<string, { label: string }>;
  seeds?: Record<string, { title: string }>;
};

/**
 * The manifests are loaded THROUGH VITE, not imported: `apps/host` compiles on nodenext and a web
 * module's extensionless `#/` specifier does not resolve there (see review-0910/reconcile.md). One
 * dev server, loaded once at collection time, gives the same objects the browser will mount — so a
 * new seed on any manifest is a new test here with no edit to this file.
 */
const webRoot = resolve(import.meta.dirname, "..", "..", "web");
const vite = await createViteServer({
  root: webRoot,
  configFile: join(webRoot, "vite.config.ts"),
  server: { hmr: false, middlewareMode: true },
});
const load = async (module: string): Promise<Record<string, unknown>> =>
  (await vite.ssrLoadModule(module)) as Record<string, unknown>;
type Factory = (deps: unknown) => AnyManifest;

/** Route path per manifest; `key` is the manifest's word, the path is the router's. */
const ROUTES: readonly { path: string; manifest: AnyManifest }[] = [
  {
    path: "/chat",
    manifest: ((await load("/src/chat/manifest.ts")).chatManifest as Factory)({ thread: "" }),
  },
  {
    path: "/settings",
    manifest: ((await load("/src/settings/manifest.ts")).settingsManifest as Factory)({
      scope: { route: "settings", target: null },
    }),
  },
  {
    path: "/instances",
    manifest: (await load("/src/instances/manifest.ts")).instancesManifest as AnyManifest,
  },
  { path: "/takeoffs", manifest: (await load("/src/takeoff/manifest.ts")).manifest as AnyManifest },
  { path: "/family", manifest: (await load("/src/family/manifest.ts")).manifest as AnyManifest },
  {
    path: "/families",
    manifest: (await load("/src/families/manifest.ts")).manifest as AnyManifest,
  },
];

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
// biome-ignore lint/suspicious/noExplicitAny: playwright-core is imported by URL, untyped here.
let browser: { close(): Promise<void>; newPage(): Promise<any> } | undefined;
let hostDone: Promise<unknown> | undefined;
let serviceToken = "";
let browserVite: Awaited<ReturnType<typeof createViteServer>> | undefined;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "pe-demo-lane-"));
  const databasePath = join(mkdtempSync(join(tmpdir(), "pe-demo-db-")), "demo-lane.db");
  const nodeServer = createNodeServer();
  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      yield* Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: false },
            lifecycle: { handle, latch },
            // The demo lane never asks the model anything; the runtime only has to boot.
            mastraLayer: makeMastraRuntimeLive({ revit: false }, undefined, async () =>
              createDeterministicRuntime({
                databasePath,
                resourceId: resolvePeaWorld().id,
                responses: [],
              }),
            ),
            nodeServer,
            port: 0,
            webRoot: null,
          }),
        ),
        Deferred.await(latch),
      );
    }),
  );
  hostDone = Effect.runPromise(program);
  const service = await waitForService(productRoot());
  serviceToken = service.token;
  hostUrl = `http://127.0.0.1:${service.port}`;
  browserVite = await createViteServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      proxy: devHostProxy(`http://127.0.0.1:${service.port}`),
    },
  });
  await browserVite.listen();
  baseUrl = browserVite.resolvedUrls!.local[0]!.replace(/\/$/, "");
  const playwrightUrl = pathToFileURL(
    resolve(
      import.meta.dirname,
      "../../../node_modules/.pnpm/node_modules/playwright-core/index.mjs",
    ),
  );
  const { chromium } = await import(playwrightUrl.href);
  const executablePath = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
  if (!executablePath) throw new Error("the demo lane needs Chrome or Edge");
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await fetch(`${hostUrl}/admin/shutdown`, {
    method: "POST",
    headers: { "x-pe-service-token": serviceToken },
  }).catch(() => undefined);
  await hostDone;
  await browserVite?.close();
  await vite.close();
}, 200_000);

for (const { path, manifest } of ROUTES)
  for (const [action, seed] of Object.entries(manifest.seeds ?? {})) {
    if (!seed) continue;
    test(`${manifest.key} ?demo=${action}`, async () => {
      const page = await browser!.newPage();
      // What the demo lane must not do: throw, log an error, or write anything. Route BODIES
      // outside the primitive still issue live host queries that 4xx/5xx without Revit, and the
      // browser logs one resource line per such response; those are not the primitive's.
      const errors: string[] = [];
      const posts: string[] = [];
      page.on("pageerror", (error: { message: string }) =>
        errors.push(`page error: ${error.message}`),
      );
      page.on("console", (message: { type(): string; text(): string }) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
          errors.push(message.text());
      });
      // The two write lanes: a semantic action's receipt (`/actions`) and a route-state write
      // (`/route-state/...`). Route BODIES outside the primitive still POST `/call` to read the
      // live host under a seed; that is an owed cut, not a write, so it is not asserted here.
      page.on("request", (request: { method(): string; url(): string }) => {
        const url = request.url();
        if (request.method() === "POST" && /\/(actions|route-state)/.test(url)) posts.push(url);
      });
      try {
        await page.goto(`${baseUrl}${path}?demo=${encodeURIComponent(action)}`, {
          waitUntil: "domcontentloaded",
        });
        // 1. The head names the route: the shell's own landmark, which every route mounts
        // whatever its body prints as a title.
        await expect
          .poll(() => page.getByRole("region", { name: `${manifest.name} route` }).count(), {
            timeout: 30_000,
          })
          .toBeGreaterThan(0);
        // 2. Where the route draws the shared Situation's verb row (the rest still wear the
        // shell head), its meter says the seeded Work revision: a seed IS the Work, so r0.
        const body = page.locator("body");
        if ((await page.getByRole("button", { name: /verbs$/ }).count()) > 0)
          await expect.poll(() => body.innerText(), { timeout: 15_000 }).toContain("r0");
        // 3. Every verb the head draws is disabled by the one sentence the primitive refuses a
        // seed with. Nothing here can run, so nothing here is clicked.
        for (const [name, spec] of Object.entries(manifest.actions)) {
          const verb = page.getByRole("button", { name: new RegExp(`^${spec.label}`) }).first();
          if ((await verb.count()) === 0) continue;
          expect(
            await verb.getAttribute("aria-disabled"),
            `${manifest.key}.${name} is operable under a frozen seed`,
          ).toBe("true");
          expect(await verb.getAttribute("title"), `${manifest.key}.${name} refusal sentence`).toBe(
            "frozen seed is read-only",
          );
        }
        expect(errors, `${manifest.key}.${action} threw or logged`).toEqual([]);
        expect(posts, `${manifest.key}.${action} wrote under a frozen seed`).toEqual([]);
      } finally {
        await page.close();
      }
    }, 120_000);
  }
