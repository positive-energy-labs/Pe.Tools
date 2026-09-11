import { mkdtempSync, rmSync } from "node:fs";
import { Agent, createServer as createNodeServer, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { expect, test } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { resolvePeaWorld } from "@pe/runtime/pea";
import { createDeterministicRuntime } from "@pe/runtime/testing";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { makeMastraRuntimeLive } from "../src/mastra-runtime.ts";

/**
 * Socket retirement at the shared runtime seam. A retired host must hold no keep-alive socket a
 * client can reuse: after shutdown the client's pooled socket is closed by the server, and the
 * next request on the same origin opens a fresh connection that reaches the successor. Without
 * this a browser reload after a same-port restart (the scenario's restart leg, and a dev-host
 * takeover in production) reuses the dead socket and waits forever.
 */
async function launchHost(databasePath: string, port: number, previousToken?: string) {
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
            // The real agent app: the socket under test carries a live controller session stream.
            mastraLayer: makeMastraRuntimeLive({ revit: false }, undefined, async () =>
              createDeterministicRuntime({
                databasePath,
                resourceId: resolvePeaWorld().id,
                responses: [{ text: "unused" }],
              }),
            ),
            nodeServer,
            port,
            webRoot: null,
          }),
        ),
        Deferred.await(latch),
      );
    }),
  );
  const done = Effect.runPromise(program);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const file = await readServiceFile(productRoot(), hostOwnership.serviceName);
    if (file && file.token !== previousToken) return { done, service: file };
    if (Date.now() > deadline) throw new Error("service file did not appear");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopHost(host: Awaited<ReturnType<typeof launchHost>>) {
  await fetch(`http://127.0.0.1:${host.service.port}/admin/shutdown`, {
    method: "POST",
    headers: { "x-pe-service-token": host.service.token },
  });
  await host.done;
}

type Probe = { status: number | "timeout"; reused: boolean; socketClosed: Promise<void> };

/** A controller session stream on the agent's one socket: the connection is ACTIVE when the host retires. */
function openStream(port: number, agent: Agent) {
  return new Promise<{ ended: Promise<void>; socketClosed: Promise<void> }>((resolve, reject) => {
    const request = get(
      `http://127.0.0.1:${port}/api/agent-controller/pea/sessions/${resolvePeaWorld().id}/stream`,
      { agent },
      (response) => {
        // A destroyed socket emits `close` without `end`; either means the stream is over.
        const ended = new Promise<void>((done) => {
          response.once("end", () => done());
          response.once("close", () => done());
        });
        response.once("data", () => resolve({ ended, socketClosed }));
        response.resume();
      },
    );
    let socketClosed: Promise<void> = Promise.resolve();
    request.on("socket", (socket) => {
      socketClosed = new Promise((done) => socket.once("close", () => done()));
    });
    request.on("error", reject);
  });
}

/** One request on a one-socket keep-alive agent; reports whether the pooled socket was reused. */
function probe(port: number, agent: Agent): Promise<Probe> {
  return new Promise((resolve) => {
    let reused = false;
    let socketClosed: Promise<void> = Promise.resolve();
    const request = get(`http://127.0.0.1:${port}/host/status`, { agent }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode ?? 0, reused, socketClosed }));
    });
    request.on("socket", (socket) => {
      reused = request.reusedSocket;
      socketClosed = new Promise((done) => socket.once("close", () => done()));
    });
    request.on("error", () => resolve({ status: "timeout", reused, socketClosed }));
    request.setTimeout(3_000, () => {
      resolve({ status: "timeout", reused, socketClosed });
      request.destroy();
    });
  });
}

test("a retired host closes its keep-alive sockets; the successor gets a fresh connection", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-socket-retire-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const previousPeRevitCmd = process.env.PE_REVIT_CMD;
  process.env.LOCALAPPDATA = localAppData;
  process.env.PE_REVIT_CMD = process.execPath;
  const databasePath = join(localAppData, "retire.db");
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  let host: Awaited<ReturnType<typeof launchHost>> | undefined;
  try {
    host = await launchHost(databasePath, 0);
    const port = host.service.port;
    await expect
      .poll(async () => (await fetch(`${`http://127.0.0.1:${port}`}/pe/inspect`)).status, {
        timeout: 15_000,
      })
      .toBe(200);
    const stream = await openStream(port, agent);

    const retired = host;
    host = undefined;
    await stopHost(retired);
    await stream.ended;
    // The socket that carried the stream is closed by the retired server, not left in the
    // client's pool for the next request to reuse.
    await expect(
      Promise.race([
        stream.socketClosed.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve("still open"), 5_000)),
      ]),
    ).resolves.toBe("closed");

    host = await launchHost(databasePath, port, retired.service.token);
    const second = await probe(port, agent);
    expect(second.reused).toBe(false);
    expect(second.status).toBe(200);
  } finally {
    agent.destroy();
    if (host) await stopHost(host).catch(() => undefined);
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    if (previousPeRevitCmd === undefined) delete process.env.PE_REVIT_CMD;
    else process.env.PE_REVIT_CMD = previousPeRevitCmd;
    try {
      rmSync(localAppData, { force: true, recursive: true, maxRetries: 50, retryDelay: 100 });
    } catch {
      // Windows can retain a just-closed handle past test teardown.
    }
  }
}, 40_000);
