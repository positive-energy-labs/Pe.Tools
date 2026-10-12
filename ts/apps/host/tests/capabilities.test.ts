import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { documentsRootEnvVar } from "@pe/host-contracts/product-paths";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";

/**
 * Host boundary: on a no-Revit host, the one capability catalog answers
 * in under 3 s, names the sources that did not answer, and still lists every route row and skill
 * row; route Work, Readings and the thread head answer from the host itself.
 */
test("the host-owned /pe surface answers without Revit", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-caps-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  vi.stubEnv(documentsRootEnvVar, join(localAppData, "Documents"));
  const appBase = productRoot();
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
            nodeServer,
            port: 0,
            webRoot: null,
          }),
        ),
        Deferred.await(latch),
      );
    }),
  );
  const done = Effect.runPromise(program);
  try {
    const deadline = Date.now() + 10_000;
    let service = await readServiceFile(appBase, hostOwnership.serviceName);
    while (!service && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      service = await readServiceFile(appBase, hostOwnership.serviceName);
    }
    if (!service) throw new Error("service file did not appear");
    const base = `http://127.0.0.1:${service.port}`;
    const started = Date.now();
    const response = await fetch(
      `${base}/pe/capabilities?doc=${encodeURIComponent("C:\\Models\\A.rvt")}&pin=pe.app-25`,
    );
    const elapsed = Date.now() - started;
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(3_000);
    const catalog = (await response.json()) as {
      sources: Record<string, string>;
      sessions: unknown[];
      capabilities: { key: string }[];
    };
    expect(catalog.sources["route registry"]).toBe("ok");
    expect(catalog.sources.skills).toBe("ok");
    expect(catalog.sources.catalog).toMatch(/bridge catalog unavailable|did not answer/);
    // pod.list is host-local: the pods answer with Revit closed.
    expect(catalog.sources["pod.json"]).toBe("ok");
    expect(catalog.sessions).toEqual([]);
    const keys = catalog.capabilities.map((row) => row.key);
    expect(keys).toContain("op:host.shell.open");
    expect(keys).toContain("workflow:instances.start");
    expect(keys.some((key) => key.startsWith("route:ops"))).toBe(false);
    // The member Work route is named for the pods its members live in.
    expect(keys).toContain("route:pods.propose");
    expect(keys).toContain("op:pod.list");
    expect(keys).not.toContain("route:pods.open");
    expect(keys).toContain("skill:build-pod");
    expect(keys.some((key) => key.startsWith("op:revit."))).toBe(false);

    // The thread head, its Reading, and route Work, with no tenant behind them.
    const put = await fetch(`${base}/pe/scope/t1`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTarget: null, expectedRevision: 0 }),
    });
    expect(await put.json()).toMatchObject({ ok: true, head: { revision: 1 } });
    const resources = await fetch(
      `${base}/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "thread-head", thread: "t1" }]))}`,
    );
    const reader = resources.body!.getReader();
    const frame = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(JSON.parse(frame.slice(frame.indexOf("data: ") + 6))).toMatchObject({
      kind: "snapshot",
      value: { defaultTarget: null, revision: 1 },
    });
    const routeList = await fetch(`${base}/pe/route-state`);
    expect(routeList.status).toBe(200);
    expect(((await routeList.json()) as unknown[]).length).toBeGreaterThan(0);
    expect((await fetch(`${base}/pe/access`)).status).toBe(200);

    await fetch(`${base}/admin/shutdown`, {
      method: "POST",
      headers: { "x-pe-service-token": service.token },
    });
    await done;
  } finally {
    vi.unstubAllEnvs();
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    for (const directory of [localAppData])
      try {
        rmSync(directory, { force: true, recursive: true, maxRetries: 50, retryDelay: 100 });
      } catch {
        // Windows can retain a just-closed LibSQL handle past test teardown.
      }
  }
}, 40_000);
