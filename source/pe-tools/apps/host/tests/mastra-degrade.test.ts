import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import { makeHttpLive } from "../src/app.ts";
import { MastraRuntime } from "../src/mastra-runtime.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import type { ServiceHostHandle } from "../src/pe-service-host.ts";
import { readServiceFile } from "../src/pe-service.ts";

/**
 * The degrade-path boundary test. A broken agent runtime must NOT take the host down: the SDK
 * supervisor treats a missing service claim as "'host' did not become healthy within 15s", so an
 * agent-runtime init defect that collapses `makeHttpLive`'s merged layer is the primary beta-user
 * failure. Here the injected `mastraLayer` throws a DEFECT during build — the case the tenant's own
 * failure-only `Effect.catch` cannot recover, and exactly what escaped it in the shipped SEA
 * (`TypeError: (void 0) is not a function`). We assert the composition-boundary containment
 * (`withMastraDegrade`) holds: the host still binds, the service claim IS written, and every agent
 * route answers 503 instead of the process dying before it can claim.
 */
const DyingMastraLive = Layer.effect(
  MastraRuntime,
  Effect.gen(function* () {
    // Same dependency as the real tenant (built after bind), so the failure is on the real seam.
    yield* HttpServer.HttpServer;
    const notAFunction = undefined as unknown as () => void;
    notAFunction(); // TypeError -> a defect, NOT a recoverable failure
    return { fetch: async () => new Response("unreachable") };
  }),
);

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value != null) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("mastra init defect degrades to 503 without taking the host down", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-host-degrade-"));
  const prevLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  const appBase = productRoot();

  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      const HttpLive = makeHttpLive({
        port: 0,
        mastraLayer: DyingMastraLive,
        lifecycle: { latch, handle },
        webRoot: null,
        includeInstallGc: false,
      });
      yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
    }),
  );

  const done = Effect.runPromise(program);

  try {
    // (1) the service claim IS written despite the tenant defect — the host became healthy.
    const file = await waitFor(() => readServiceFile(appBase, hostOwnership.serviceName));
    expect(file.port).toBeGreaterThan(0);
    expect(file.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(file.pid).toBe(process.pid);

    const base = `http://127.0.0.1:${file.port}`;

    // (2) the host is bound and serving its own routes (proves it did not die on the defect).
    const status = await fetch(`${base}/host/status`);
    expect(status.status).toBe(200);
    // /host/status reflects the degraded agent surface (D4 observability).
    expect((await status.json()) as { agentRuntime?: { available?: boolean } }).toMatchObject({
      agentRuntime: { available: false },
    });

    // (3) an agent route answers 503 (degraded), not a crash and not a 200.
    const agent = await fetch(`${base}/pe/info`);
    expect(agent.status).toBe(503);
    expect((await agent.json()) as { error?: string }).toMatchObject({
      error: "Agent runtime unavailable on this host.",
    });

    // (4) graceful shutdown via the SDK claim token; the service file is then deleted.
    const shutdown = await fetch(`${base}/admin/shutdown`, {
      method: "POST",
      headers: { "x-pe-service-token": file.token, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(shutdown.status).toBe(200);

    await done;
    expect(await readServiceFile(appBase, hostOwnership.serviceName)).toBeNull();
  } finally {
    await done.catch(() => {});
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
    rmSync(localAppData, { recursive: true, force: true });
  }
}, 30_000);
