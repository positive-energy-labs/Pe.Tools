import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { settle } from "./effect-test.ts";

vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

const claim = vi.hoisted(() => ({ before: async () => {} }));
vi.mock("@pe/host-contracts/pe-service-host", async (original) => {
  const sdk = await original<typeof import("@pe/host-contracts/pe-service-host")>();
  return {
    ...sdk,
    claimServiceHost: async (...args: Parameters<typeof sdk.claimServiceHost>) => {
      await claim.before();
      return sdk.claimServiceHost(...args);
    },
  };
});

test("HTTP requests answer during claim acquisition and discovery only publishes a serving host", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-startup-ready-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  const nodeServer = createServer();
  let enterClaim!: () => void;
  let releaseClaim!: () => void;
  const entered = new Promise<void>((resolve) => {
    enterClaim = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseClaim = resolve;
  });
  claim.before = async () => {
    enterClaim();
    await released;
  };
  // effect-edge: island, phase 5
  const handle = Effect.runSync(Deferred.make<ServiceHostHandle>());
  // effect-edge: island, phase 5
  const latch = Effect.runSync(Deferred.make<void>());
  // effect-edge: island, phase 5
  const fiber = Effect.runFork(
    Layer.launch(
      makeHttpLive({
        capabilities: { revit: false },
        lifecycle: { handle, latch },
        nodeServer,
        port: 0,
        webRoot: null,
      }),
    ),
  );
  try {
    await entered;
    const address = nodeServer.address();
    if (!address || typeof address === "string") throw new Error("host did not bind TCP");
    const base = `http://127.0.0.1:${address.port}`;
    expect(await readServiceFile(hostOwnership.rootPath, hostOwnership.serviceName)).toBeNull();
    const response = await fetch(`${base}/host/status`, { signal: AbortSignal.timeout(1_000) });
    expect(response.status).toBe(200);
    expect((await response.json()).processId).toBe(process.pid);
    releaseClaim();
    // effect-edge: island, phase 5
    const acquired = await Effect.runPromise(Deferred.await(handle));
    expect(acquired.serviceFile.port).toBe(address.port);
    const refused = await fetch(`${base}/admin/shutdown`, { method: "POST" });
    expect(refused.status).toBe(403);
    const shutdown = await fetch(`${base}/admin/shutdown`, {
      method: "POST",
      headers: { "x-pe-service-token": acquired.serviceFile.token },
    });
    expect(shutdown.status).toBe(200);
    // effect-edge: island, phase 5
    await Effect.runPromise(Deferred.await(latch));
  } finally {
    releaseClaim();
    nodeServer.closeAllConnections();
    // effect-edge: island, phase 5
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(await readServiceFile(hostOwnership.rootPath, hostOwnership.serviceName)).toBeNull();
    claim.before = async () => {};
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    rmSync(localAppData, { recursive: true, force: true });
  }
}, 15_000);

test("HTTP response lifetime is reader-owned while request upload limits stay bounded", async () => {
  const nodeServer = createServer();
  nodeServer.setTimeout(120_000);
  const uploadTimeout = nodeServer.requestTimeout;
  const headersTimeout = nodeServer.headersTimeout;
  const handle = await settle(Deferred.make<ServiceHostHandle>());
  const latch = await settle(Deferred.make<void>());
  makeHttpLive({
    capabilities: { revit: false },
    lifecycle: { handle, latch },
    nodeServer,
    port: 0,
    webRoot: null,
  });
  expect(nodeServer.timeout).toBe(0);
  expect(nodeServer.requestTimeout).toBe(uploadTimeout);
  expect(nodeServer.headersTimeout).toBe(headersTimeout);
});
