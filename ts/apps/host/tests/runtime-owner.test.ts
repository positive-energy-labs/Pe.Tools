import { Effect, Queue, Layer, Fiber } from "effect";
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { HttpRouter } from "effect/unstable/http";
import { createServer, request } from "node:http";
import { once } from "node:events";
import {
  BRIDGE_CONTRACT_VERSION,
  BRIDGE_PATH,
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import { expect, test } from "vite-plus/test";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { hostStatusRoute } from "../src/app.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sourceHostServiceName } from "@pe/host-contracts/service-identity";

test.each([
  { lane: "installed", sourceRoot: null, serviceName: "host" },
  { sourceRoot: "C:/checkout-B" },
  { serviceName: "host-source-other" },
  { lane: null },
  { sourceRoot: null },
  { serviceName: null },
  { installedRoot: "C:/installation" },
  { processStartUtcUnixMs: null },
  { processId: 0 },
])("bridge refuses wrong or unknown owner %j before dispatch", (ownership) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, ack, outgoing, target } = yield* connectTestBridge(42, ownership);
        expect(ack.registrationAck?.accepted).toBe(false);
        expect(yield* bridge.list).toEqual([]);
        const result = yield* Effect.result(
          bridge.invoke("revit.context.summary", {}, target.session),
        );
        expect(result._tag).toBe("Failure");
        expect(yield* Queue.size(outgoing)).toBe(0);
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  ),
);

test("same checkout bridge exposes owner match separately from build freshness", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, ack } = yield* connectTestBridge();
        expect(ack.registrationAck?.accepted).toBe(true);
        expect(yield* bridge.list).toMatchObject([{ runtimeMatch: "verified", buildStamp: null }]);
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  ));

test("real loopback HTTP and WebSocket refuse a foreign checkout before routing", async () => {
  const server = createServer();
  const port = () => (server.address() as { port: number }).port;
  const routes = Layer.mergeAll(
    hostStatusRoute,
    HttpRouter.add("GET", BRIDGE_PATH, (req) =>
      Effect.flatMap(RevitBridge, (bridge) => bridge.handleConnection(req)),
    ),
    requestIdentityLayer({
      port,
      frontendOrigin: () => undefined,
      share: {
        read: async () => {
          throw Error("No share in this loopback proof");
        },
        observe: () => {},
      },
    }),
  );
  const fiber = Effect.runFork(
    Layer.launch(
      HttpRouter.serve(routes).pipe(
        Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 })),
        Layer.provide(RevitBridgeLive),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
  let socket: WebSocket | undefined;
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${port()}`;
    const own = await fetch(`${base}/host/status`, {
      headers: { [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName },
    });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      serviceName: hostOwnership.serviceName,
      runtimeMatch: "disconnected",
    });
    const foreign = sourceHostServiceName("C:/checkout-B");
    const wrong = await fetch(`${base}/host/status`, {
      headers: { [HOST_RUNTIME_SERVICE_HEADER]: foreign },
    });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ refusal: { code: "runtime.owner-mismatch" } });
    const refusedUpgrade = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${base}${BRIDGE_PATH}`,
        {
          headers: {
            [HOST_RUNTIME_SERVICE_HEADER]: foreign,
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-version": "13",
            "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      req.on("upgrade", (_response, upgraded) => {
        upgraded.destroy();
        reject(Error("Foreign checkout upgraded"));
      });
      req.on("error", reject);
      req.end();
    });
    expect(refusedUpgrade).toBe(403);
    socket = new WebSocket(
      `${base.replace("http:", "ws:")}${BRIDGE_PATH}?${HOST_RUNTIME_SERVICE_QUERY}=${hostOwnership.serviceName}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", reject, { once: true });
    });
    const ack = new Promise<unknown>((resolve) =>
      socket!.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), {
        once: true,
      }),
    );
    socket.send(
      JSON.stringify({
        kind: "Registration",
        registration: {
          contractVersion: BRIDGE_CONTRACT_VERSION,
          processId: 42,
          processStartUtcUnixMs: 1000,
          lane: hostOwnership.lane,
          sourceRoot: hostOwnership.sourceRoot,
          serviceName: hostOwnership.serviceName,
          state: {
            activeDocumentIsFamilyDocument: false,
            activeDocumentIsModelInCloud: false,
            activeDocumentIsWorkshared: false,
            activeDocumentObservedAtUnixMs: 1,
            hasActiveDocument: false,
            revitVersion: "controlled transport",
            runtimeFramework: "test",
            runtimeAssemblies: [],
            openDocuments: [],
          },
        },
      }),
    );
    expect(await ack).toMatchObject({
      kind: "RegistrationAck",
      registrationAck: { accepted: true },
    });
    const connected = await fetch(`${base}/host/status`, {
      headers: { [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName },
    });
    expect(await connected.json()).toMatchObject({ runtimeMatch: "verified" });
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const closed = new Promise<void>((resolve) =>
        socket!.addEventListener("close", () => resolve(), { once: true }),
      );
      socket.close();
      await closed;
    }
    server.closeAllConnections();
    await Effect.runPromise(Fiber.interrupt(fiber));
  }
}, 10_000);
