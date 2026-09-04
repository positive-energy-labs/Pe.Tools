import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { expect, test } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { resolvePeaWorld } from "@pe/runtime/pea";
import { createDeterministicRuntime } from "@pe/runtime/testing";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { makeMastraRuntimeLive, type RuntimeFactory } from "../src/mastra-runtime.ts";

const responseText = "PERSISTED_AFTER_HELD_FETCH";

const scenarioRuntime =
  (databasePath: string): RuntimeFactory =>
  async () =>
    createDeterministicRuntime({
      databasePath,
      resourceId: resolvePeaWorld().id,
      responses: [{ text: responseText }],
    });

async function waitForService(appBase: string) {
  await expect
    .poll(() => readServiceFile(appBase, hostOwnership.serviceName), { timeout: 10_000 })
    .toBeTruthy();
  return (await readServiceFile(appBase, hostOwnership.serviceName))!;
}

test("an invalidation supersedes a held initial thread fetch", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-chat-stale-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  const webRoot = resolve(import.meta.dirname, "..", "..", "web");
  const nodeServer = createNodeServer();
  const vite = await createViteServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    server: { hmr: false, middlewareMode: true },
  });
  const appBase = productRoot();
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const latch = yield* Deferred.make<void>();
        const handle = yield* Deferred.make<ServiceHostHandle>();
        yield* Effect.raceFirst(
          Layer.launch(
            makeHttpLive({
              capabilities: { revit: false },
              includeInstallConverge: false,
              lifecycle: { handle, latch },
              mastraLayer: makeMastraRuntimeLive(
                { revit: false },
                undefined,
                scenarioRuntime(":memory:"),
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
    ),
  );
  let service: Awaited<ReturnType<typeof waitForService>> | undefined;
  let browser: { close(): Promise<void> } | undefined;

  try {
    service = await waitForService(appBase);
    const baseUrl = `http://127.0.0.1:${service.port}`;
    const { chromium } = await import(
      pathToFileURL(
        resolve(
          import.meta.dirname,
          "../../../node_modules/.pnpm/node_modules/playwright-core/index.mjs",
        ),
      ).href
    );
    const executablePath = [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ].find(existsSync);
    if (!executablePath) throw new Error("chat scenario needs Chrome or Edge");
    const launched = await chromium.launch({ executablePath, headless: true });
    browser = launched;
    const page = await launched.newPage();
    const threadId = crypto.randomUUID();
    let threadFetches = 0;
    let releaseFirst!: () => Promise<void>;
    const firstHeld = new Promise<void>((resolveHeld) => {
      void page.route(
        "**/pe/thread/*",
        async (route: {
          continue(): Promise<void>;
          fetch(): Promise<unknown>;
          fulfill(options: { response: unknown }): Promise<void>;
        }) => {
          threadFetches++;
          if (threadFetches > 1) return route.continue();
          const response = await route.fetch();
          releaseFirst = () => route.fulfill({ response });
          resolveHeld();
        },
      );
    });

    await page.goto(`${baseUrl}/chat?thread=${threadId}`, { waitUntil: "domcontentloaded" });
    await firstHeld;
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("persist while hydration is held");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect
      .poll(
        async () =>
          JSON.stringify(
            (
              (await fetch(`${baseUrl}/pe/thread/${encodeURIComponent(threadId)}`).then((r) =>
                r.json(),
              )) as { messages: unknown[] }
            ).messages,
          ),
        { timeout: 15_000 },
      )
      .toContain(responseText);

    await expect
      .poll(() => threadFetches, {
        timeout: 2_000,
        message: "message_end invalidation did not supersede the held initial fetch",
      })
      .toBeGreaterThan(1);
    await releaseFirst();
  } finally {
    await browser?.close();
    if (service)
      await fetch(`http://127.0.0.1:${service.port}/admin/shutdown`, {
        method: "POST",
        headers: { "x-pe-service-token": service.token },
      }).catch(() => undefined);
    await done.catch(() => undefined);
    await vite.close();
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    rmSync(localAppData, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
}, 45_000);
