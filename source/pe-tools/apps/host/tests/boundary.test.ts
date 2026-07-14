import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { expect, test } from "vite-plus/test";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import { makeHttpLive } from "../src/app.ts";
import { productRoot } from "../src/host-ownership.ts";
import { MastraRuntime } from "../src/mastra-runtime.ts";
import type { ServiceHostHandle } from "../src/pe-service-host.ts";
import { readServiceFile } from "../src/pe-service.ts";

/**
 * The one vertical boundary test (owner's philosophy: one seam test, no unit sprawl). It boots the
 * real `makeHttpLive` composition on an ephemeral port with a STUB Mastra tenant (a trivial Hono-
 * shaped fetch), then asserts the whole seam: service file, status, static SPA fallback, the Mastra
 * mount at its absolute path, and graceful token-authorized shutdown. The real pea runtime is
 * proven offline by `@pe/runtime`'s own `buildAgentControllerApp` test; here we only exercise the
 * host's mount/lifecycle plumbing, so the tenant is stubbed (keeps this hermetic — no product-home
 * writes, no model/auth). InstallGc is disabled so the test never spawns the install kernel.
 */
const StubMastraLive = Layer.succeed(MastraRuntime, {
  fetch: (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/pe/info") {
      return Promise.resolve(
        new Response(JSON.stringify({ controllerId: "pea", resourceId: "test-resource" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  },
});

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value != null) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("host boundary: service file, status, static SPA, mastra mount, graceful shutdown", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-host-boundary-"));
  const webDir = mkdtempSync(join(tmpdir(), "pe-host-web-"));
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>pe-spa</title>");
  writeFileSync(join(webDir, "a.txt"), "alpha");

  const prevLocalAppData = process.env.LOCALAPPDATA;
  const prevWebDist = process.env.PE_TOOLS_WEB_DIST;
  process.env.LOCALAPPDATA = localAppData;
  process.env.PE_TOOLS_WEB_DIST = webDir;
  // appBase is resolved the same way the running host resolves it (LOCALAPPDATA now = temp).
  const appBase = productRoot();

  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      const HttpLive = makeHttpLive({
        port: 0,
        mastraLayer: StubMastraLive,
        lifecycle: { latch, handle },
        webRoot: webDir,
        includeInstallGc: false,
      });
      yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
    }),
  );

  const done = Effect.runPromise(program);

  try {
    // (1) service file exists with the ACTUAL bound port + token.
    const file = await waitFor(() => readServiceFile(appBase, "host"));
    expect(file.port).toBeGreaterThan(0);
    expect(file.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(file.pid).toBe(process.pid);
    expect(file.lane).toBe("dev");

    const base = `http://127.0.0.1:${file.port}`;

    // (2) GET /host/status → 200 (confirms the recorded port is the real bound one).
    const status = await fetch(`${base}/host/status`);
    expect(status.status).toBe(200);
    expect(((await status.json()) as { lane?: string }).lane).toBe("dev");

    // Discovery uses the same selector surface as /call and echoes its resolved identity so
    // typegen can reject an accidental RRD-vs-sandbox lane mismatch.
    const ops = await fetch(`${base}/ops`, {
      headers: { [HOST_RPC_BRIDGE_SESSION_HEADER]: "sandbox:boundary" },
    });
    expect(ops.status).toBe(200);
    expect((await ops.json()) as { bridgeSessionId?: string }).toMatchObject({
      bridgeSessionId: "sandbox:boundary",
    });

    const conflictingOps = await fetch(`${base}/ops?session=rrd:other`, {
      headers: { [HOST_RPC_BRIDGE_SESSION_HEADER]: "sandbox:boundary" },
    });
    expect(conflictingOps.status).toBe(400);

    // (2b) /call envelope rejects unknown top-level body keys. A `bridgeSessionId` in the body
    // once silently mis-routed to the user's live Revit — it must 400 and point at the header.
    const misTargeted = await fetch(`${base}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "host.status", bridgeSessionId: "session-abc" }),
    });
    expect(misTargeted.status).toBe(400);
    const misTargetedBody = (await misTargeted.json()) as { message?: string };
    expect(misTargetedBody.message).toContain("bridgeSessionId");
    expect(misTargetedBody.message).toContain(HOST_RPC_BRIDGE_SESSION_HEADER);

    // A clean TS-only envelope still passes the key gate (no Revit session → Disconnected, not 400).
    const cleanCall = await fetch(`${base}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "host.status" }),
    });
    expect(cleanCall.status).toBe(200);

    // (3) static: /a.txt serves, and an unknown no-extension route falls back to index.html.
    const asset = await fetch(`${base}/a.txt`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("alpha");

    const spa = await fetch(`${base}/some/spa/route`, { headers: { accept: "text/html" } });
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("pe-spa");

    // (4) the Mastra mount answers /pe/info at its absolute path.
    const info = await fetch(`${base}/pe/info`);
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ controllerId: "pea" });

    // (5) graceful shutdown: the SDK claim token authorizes, then the server stops + file deleted.
    const shutdown = await fetch(`${base}/admin/shutdown`, {
      method: "POST",
      headers: {
        "x-pe-service-token": file.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(shutdown.status).toBe(200);

    await done; // scope teardown: graceful server close + service-file delete.

    expect(await readServiceFile(appBase, "host")).toBeNull();
    await expect(fetch(`${base}/host/status`)).rejects.toBeDefined();
  } finally {
    await done.catch(() => {});
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
    if (prevWebDist === undefined) delete process.env.PE_TOOLS_WEB_DIST;
    else process.env.PE_TOOLS_WEB_DIST = prevWebDist;
    rmSync(localAppData, { recursive: true, force: true });
    rmSync(webDir, { recursive: true, force: true });
  }
}, 30_000);
