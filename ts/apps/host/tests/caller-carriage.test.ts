import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Deferred, Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { createServer } from "node:http";
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node";
import { HttpRouter } from "effect/unstable/http";
import { makeHttpLive } from "../src/app.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { CaptureStore } from "../src/captures-route.ts";
import { mintContext } from "../src/control.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";

vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

/**
 * F1 (acceptance 2026-10-13): every caller reached `/actions` as anonymous on the real host. The
 * caller lives in AsyncLocalStorage, and the Node request body arrives on a socket callback that
 * runs outside it, so a handler that reads the caller after awaiting the body sees nobody. Only a
 * real Node server reproduces that; `toWebHandler` and direct `admit()` calls do not.
 */
test("/actions sees each principal's real carriage through the real HTTP server", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-host-carriage-"));
  const webDir = mkdtempSync(join(tmpdir(), "pe-host-carriage-web-"));
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>pe-spa</title>");
  const prevLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  const appBase = productRoot();
  const latch = Effect.runSync(Deferred.make<void>());
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Deferred.make<ServiceHostHandle>();
        const HttpLive = makeHttpLive({
          capabilities: { revit: true },
          port: 0,
          lifecycle: { latch, handle },
          webRoot: webDir,
        });
        yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
      }),
    ),
  );
  try {
    let file = await readServiceFile(appBase, hostOwnership.serviceName);
    for (let i = 0; !file && i < 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      file = await readServiceFile(appBase, hostOwnership.serviceName);
    }
    const base = `http://127.0.0.1:${file!.port}`;
    const terminal = readFileSync(hostContextTokenPath(hostOwnership.serviceName), "utf8");
    const destination = {
      kind: "document",
      ref: { session: "session-carriage", openId: "carriage-open-id" },
    };
    const post = async (headers: Record<string, string>) => {
      const response = await fetch(`${base}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          id: randomUUID(),
          kind: "operation",
          key: "revit.apply.parameter-values",
          destination,
          input: { edits: [{ elementId: 1, parameterName: "View Name" }], dryRun: true },
        }),
      });
      const body = (await response.json()) as { refusal?: { code?: string } };
      return body.refusal?.code ?? `admitted:${response.status}`;
    };
    const browser = {
      [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
      origin: base,
      "sec-fetch-site": "same-origin",
    };

    // Control: nobody stays nobody.
    expect(await post({})).toBe("context.missing");
    // Human CLI: the context file the host writes beside its receipt.
    expect(await post({ [HOST_CONTEXT_HEADER]: terminal })).not.toBe("context.missing");
    // Pea and external MCP: a minted header token.
    expect(
      await post({ [HOST_CONTEXT_HEADER]: mintContext({ kind: "pea", thread: "t-carriage" }) }),
    ).toBe("grant.required");
    expect(
      await post({ [HOST_CONTEXT_HEADER]: mintContext({ kind: "external-mcp", label: "ext" }) }),
    ).toBe("grant.context-cannot-hold");
    // Human browser: runtime marker plus a same-origin Referer outside /pages/.
    expect(await post({ ...browser, referer: `${base}/open` })).not.toBe("context.missing");
    // Page: the page key its Referer carries; the generic door sends it to its own.
    expect(await post({ ...browser, referer: `${base}/pages/carriage/` })).toBe(
      "page.use-page-door",
    );
  } finally {
    Effect.runSync(Deferred.succeed(latch, undefined));
    await done.catch(() => {});
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
    rmSync(localAppData, { recursive: true, force: true });
    rmSync(webDir, { recursive: true, force: true });
  }
}, 30_000);

/** `/call` reads the caller after the body and the bridge answer: a capture's origin is the caller. */
test("/call attributes a view-image capture to the caller it was carried by", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-host-carriage-call-"));
  writeFileSync(join(dir, "L1.png"), "png-l1");
  const store = new CaptureStore(join(dir, "store"));
  const bridge = {
    list: Effect.succeed([
      {
        sessionId: "bridge-a",
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            {
              openId: "open-a",
              address: "C:/HVAC.rvt",
              title: "HVAC.rvt",
              isFamilyDocument: false,
            },
          ],
        },
      },
    ]),
    invoke: (key: string) =>
      Effect.promise(async () => {
        // A macrotask hop, as a real bridge answer arrives on a socket callback.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return key === "host.ops.catalog"
          ? {
              value: {
                operations: [
                  { key: "revit.context.view-image", intent: "Read", needs: "document" },
                ],
              },
              target: null,
            }
          : {
              value: {
                view: { kind: "View", elementId: 7, label: "Floor Plan: L1" },
                filePath: join(dir, "L1.png"),
                byteSize: 6,
                pixelSize: 1500,
                registrationRefusal: "NoCrop",
              },
              target: { session: "bridge-a", document: "C:/HVAC.rvt" },
            };
      }),
  } as unknown as RevitBridge["Service"];
  const nodeServer = createServer();
  const port = () => {
    const address = nodeServer.address();
    return address && typeof address !== "string" ? address.port : 0;
  };
  const latch = Effect.runSync(Deferred.make<void>());
  const done = Effect.runPromise(
    Effect.raceFirst(
      Layer.launch(
        HttpRouter.serve(
          Layer.mergeAll(
            requestIdentityLayer({
              port,
              frontendOrigin: () => undefined,
              share: {
                read: async () => {
                  throw Error("loopback only");
                },
                observe: () => {},
              },
            }),
            makeCallRoute(undefined, undefined, { captureStore: store, sdk: sdkSessions }),
          ),
          { disableLogger: true },
        ).pipe(
          Layer.provide(Layer.succeed(RevitBridge, bridge)),
          Layer.provide(NodeHttpClient.layerUndici),
          Layer.provide(NodeHttpServer.layer(() => nodeServer, { host: "127.0.0.1", port: 0 })),
        ),
      ),
      Deferred.await(latch),
    ),
  );
  try {
    for (let i = 0; !port() && i < 200; i++) await new Promise((r) => setTimeout(r, 25));
    const capture = async (token: string) => {
      const response = await fetch(`http://127.0.0.1:${port()}/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HOST_CONTEXT_HEADER]: token,
          "x-pe-bridge-session-id": "bridge-a",
          "x-pe-open-document-id": "open-a",
        },
        body: JSON.stringify({ key: "revit.context.view-image", request: {} }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    await capture(mintContext({ kind: "human", via: "cli" }));
    await capture(mintContext({ kind: "pea", thread: "t-carriage" }));
    const origins = readFileSync(join(dir, "store", "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { origin: string }).origin);
    expect(origins).toEqual(["human", "agent"]);
  } finally {
    Effect.runSync(Deferred.succeed(latch, undefined));
    await done.catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
