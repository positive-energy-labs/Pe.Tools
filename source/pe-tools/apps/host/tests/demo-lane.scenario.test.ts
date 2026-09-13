/**
 * THE PROOF LANE. Every route manifest that declares `seeds`, every `[action, seed]` pair, in a
 * real browser against the real host: `?demo=<action>` mounts the seed in an isolated owner, the
 * head names the route, the action fires from its chord or its button, and the outcome line says
 * what happened. Seeds are plain data, so this file enumerates them from the manifests themselves
 * — a new seed is a new test with no edit here.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
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
  actions: Record<string, { label: string; chord?: string }>;
  seeds?: Record<string, { title: string; failure?: { action: string; message: string } }>;
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

/** `mod+shift+a` (the manifest's word) becomes `Control+Shift+A` (Playwright's). */
const playwrightChord = (chord: string): string =>
  chord
    .split("+")
    .map((part) =>
      part === "mod"
        ? "Control"
        : part.length === 1
          ? part.toUpperCase()
          : part[0]!.toUpperCase() + part.slice(1),
    )
    .join("+");

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
// biome-ignore lint/suspicious/noExplicitAny: playwright-core is imported by URL, untyped here.
let browser: { close(): Promise<void>; newPage(): Promise<any> } | undefined;
let hostDone: Promise<unknown> | undefined;
let serviceToken = "";

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
            includeInstallConverge: false,
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
            viteServer: vite,
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
  baseUrl = `http://127.0.0.1:${service.port}`;
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
  await fetch(`${baseUrl}/admin/shutdown`, {
    method: "POST",
    headers: { "x-pe-service-token": serviceToken },
  }).catch(() => undefined);
  await hostDone;
  await vite.close();
});

for (const { path, manifest } of ROUTES)
  for (const [action, seed] of Object.entries(manifest.seeds ?? {})) {
    if (!seed) continue;
    const declared = manifest.actions[action]!;
    test(
      `${manifest.key} ?demo=${action}`,
      async () => {
        const page = await browser!.newPage();
        // What the demo lane must not do: throw, or log an error. Route BODIES outside the
        // primitive still issue live host queries (`/call`, `/actions`) that 4xx/5xx without
        // Revit, and the browser logs one resource line per such response; those are recorded in
        // the report as an owed cut, not asserted here, because they are not the primitive's.
        const errors: string[] = [];
        page.on("pageerror", (error: { message: string }) => errors.push(`page error: ${error.message}`));
        page.on("console", (message: { type(): string; text(): string }) => {
          if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
            errors.push(message.text());
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
          // The door is the one control; the actions live behind it.
          await page
            .getByRole("button", { name: new RegExp(`${manifest.name}$`) })
            .first()
            .click();
          const outcome = page.getByLabel("Action outcome").first();
          const button = page
            .getByRole("button", { name: new RegExp(`^${declared.label}`) })
            .first();
          await button.waitFor({ timeout: 15_000 });

          // 4. Parity FIRST, while nothing has run: a refused action is `aria-disabled` with its
          // refusal sentence on the button, and its chord says exactly the same sentence.
          const refused = (await button.getAttribute("aria-disabled")) === "true";
          const sentence = (await button.getAttribute("title")) ?? "";
          if (refused) expect(sentence, `${manifest.key}.${action} refusal sentence`).not.toBe("");
          if (refused && declared.chord) {
            await page.keyboard.press(playwrightChord(declared.chord));
            await expect.poll(() => outcome.innerText(), { timeout: 15_000 }).toContain(sentence);
          }
          // A seed that leaves its own action refused is a defect in the seed, not in the proof:
          // the seed IS the moment the action is for.
          expect(
            refused,
            `${manifest.key}.${action} seed leaves its own action refused: ${sentence}`,
          ).toBe(false);

          // 2. Fire it the way the manifest declares it: the chord when there is one, the button
          // otherwise.
          if (declared.chord) await page.keyboard.press(playwrightChord(declared.chord));
          else await button.click();

          // 3. The outcome line is the receipt: the seed's injected failure, or the action ran.
          const expected = seed.failure ? seed.failure.message : `${declared.label} · ran`;
          await expect.poll(() => outcome.innerText(), { timeout: 30_000 }).toContain(expected);
          expect(errors, `${manifest.key}.${action} threw or logged`).toEqual([]);
        } finally {
          await page.close();
        }
      },
      120_000,
    );
  }
