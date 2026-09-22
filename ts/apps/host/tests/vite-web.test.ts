import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { expect, test } from "vite-plus/test";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { MastraRuntime } from "../src/mastra-runtime.ts";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { devHostProxy } from "../../web/dev-proxy.ts";

const StubMastraLive = Layer.succeed(MastraRuntime, {
  fetch: async (req) =>
    Response.json({
      url: req.url,
      body: await req.text(),
      selector: req.headers.get("x-pe-bridge-session-id"),
    }),
});

function socketMessage(socket: WebSocket, predicate: (data: string) => boolean) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket message timed out"));
    }, 5_000);
    const message = (event: MessageEvent) => {
      if (predicate(String(event.data))) {
        cleanup();
        resolve(String(event.data));
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", message);
    };
    socket.addEventListener("message", message);
  });
}

test("Vite owns HMR, proxies the claimed backend, and restarts without replacing it", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-host-vite-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  const webRoot = join(localAppData, "web");
  mkdirSync(webRoot);
  writeFileSync(
    join(webRoot, "index.html"),
    '<main>frontend</main><script type="module" src="/main.js"></script>',
  );
  writeFileSync(join(webRoot, "main.js"), 'import "/style.css";');
  writeFileSync(join(webRoot, "style.css"), "body { color: red; }");
  const webUrl = Deferred.makeUnsafe<string>();
  const latch = Deferred.makeUnsafe<void>();
  const handle = Deferred.makeUnsafe<ServiceHostHandle>();
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: true },
            lifecycle: { handle, latch },
            mastraLayer: StubMastraLive,
            port: 0,
            webRoot: null,
            webUrl,
          }),
        ),
        Deferred.await(latch),
      ),
    ),
  );
  const appBase = productRoot();
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    const claimed = await Effect.runPromise(
      Deferred.await(handle).pipe(Effect.timeout("10 seconds")),
    );
    const backend = `http://127.0.0.1:${claimed.serviceFile.port}`;
    vite = await createViteServer({
      appType: "spa",
      configFile: false,
      root: webRoot,
      cacheDir: join(localAppData, "cache"),
      server: { host: "127.0.0.1", port: 0, proxy: devHostProxy(backend) },
    });
    await vite.listen();
    const browser = vite.resolvedUrls!.local[0]!.replace(/\/$/, "");
    await Effect.runPromise(Deferred.succeed(webUrl, browser));
    expect(browser).not.toBe(backend);
    expect(await fetch(browser).then((r) => r.text())).toContain("frontend");
    const navigation = { headers: { accept: "text/html" } };
    const redirected = await fetch(`${backend}/chat?thread=kept`, {
      ...navigation,
      redirect: "manual",
    });
    expect(redirected.headers.get("location")).toBe(`${browser}/chat?thread=kept`);
    expect(await fetch(`${browser}/ops`, navigation).then((r) => r.text())).toContain("frontend");
    expect(await fetch(`${browser}/ops`).then((r) => r.json())).toHaveProperty("operations");
    expect(await fetch(`${browser}/host/status`).then((r) => r.json())).toEqual(
      await fetch(`${backend}/host/status`).then((r) => r.json()),
    );
    for (const path of ["/pe/thread/one?x=1", "/api/agent-controller/threads"]) {
      expect(
        await fetch(browser + path, {
          method: "POST",
          body: "body",
          headers: { "x-pe-bridge-session-id": "selected-session" },
        }).then((r) => r.json()),
      ).toEqual({ url: backend + path, body: "body", selector: "selected-session" });
    }
    const events = await fetch(`${browser}/events`);
    const reader = events.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(": open");
    await reader.cancel();
    const bridge = new WebSocket(browser.replace("http:", "ws:") + "/api/bridge");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        bridge.close();
        reject(new Error("Bridge proxy timed out"));
      }, 5_000);
      bridge.addEventListener("open", () => {
        clearTimeout(timer);
        bridge.close();
        resolve();
      });
      bridge.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Bridge proxy failed"));
      });
    });
    await fetch(`${browser}/main.js`);
    await fetch(`${browser}/style.css`);
    const client = await fetch(`${browser}/@vite/client`).then((r) => r.text());
    const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
    socket = new WebSocket(
      browser.replace("http:", "ws:") + (token ? `/?token=${token}` : "/"),
      "vite-hmr",
    );
    await socketMessage(socket, (data) => data.includes('"connected"'));
    const update = socketMessage(socket, (data) => data.includes('"update"'));
    writeFileSync(join(webRoot, "style.css"), "body { color: blue; }");
    expect(await update).toContain("style.css");
    socket.close();
    await vite.restart();
    expect(await fetch(`${browser}/host/status`).then((r) => r.status)).toBe(200);
    expect((await readServiceFile(appBase, hostOwnership.serviceName))?.instanceId).toBe(
      claimed.serviceFile.instanceId,
    );
  } finally {
    socket?.close();
    await vite?.close();
    await Effect.runPromise(Deferred.succeed(latch, undefined));
    await done;
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    rmSync(localAppData, { force: true, recursive: true });
  }
}, 30_000);
