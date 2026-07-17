import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { expect, test } from "vite-plus/test";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { MastraRuntime } from "../src/mastra-runtime.ts";
import type { ServiceHostHandle } from "../src/pe-service-host.ts";
import { readServiceFile } from "../src/pe-service.ts";
import { VITE_HMR_PATH } from "../src/vite-web.ts";

const StubMastraLive = Layer.succeed(MastraRuntime, {
  fetch: () => Promise.resolve(new Response("not found", { status: 404 })),
});

async function waitForService(appBase: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const file = await readServiceFile(appBase, hostOwnership.serviceName);
    if (file) return file;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("service file did not appear");
}

async function connectHmr(baseUrl: string): Promise<void> {
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + VITE_HMR_PATH, "vite-hmr");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Vite HMR WebSocket timed out")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.close();
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Vite HMR WebSocket failed"));
    });
  });
}

test("dev serves Vite and Effect from one Node server", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-host-vite-"));
  const webRoot = mkdtempSync(join(tmpdir(), "pe-host-vite-web-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  writeFileSync(join(webRoot, "index.html"), '<main id="shared-server">hello</main>', "utf8");

  const nodeServer = createNodeServer();
  const vite = await createViteServer({
    appType: "spa",
    configFile: false,
    root: webRoot,
    server: {
      hmr: { path: VITE_HMR_PATH, server: nodeServer },
      middlewareMode: true,
    },
  });
  const appBase = productRoot();
  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      yield* Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            includeInstallGc: false,
            lifecycle: { handle, latch },
            mastraLayer: StubMastraLive,
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
  const done = Effect.runPromise(program);

  try {
    const file = await waitForService(appBase);
    const baseUrl = `http://127.0.0.1:${file.port}`;
    const status = await fetch(`${baseUrl}/host/status`);
    const page = await fetch(baseUrl);
    const html = await page.text();

    expect(status.status).toBe(200);
    expect(page.status).toBe(200);
    expect(html).toContain("shared-server");
    expect(html).toContain("/@vite/client");
    expect((await fetch(`${baseUrl}/@vite/client`)).status).toBe(200);
    await expect(connectHmr(baseUrl)).resolves.toBeUndefined();

    const shutdown = await fetch(`${baseUrl}/admin/shutdown`, {
      method: "POST",
      headers: { "x-pe-service-token": file.token },
    });
    expect(shutdown.status).toBe(200);
    await done;
  } finally {
    await done.catch(() => {});
    await vite.close();
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    rmSync(localAppData, { force: true, recursive: true });
    rmSync(webRoot, { force: true, recursive: true });
  }
}, 30_000);
