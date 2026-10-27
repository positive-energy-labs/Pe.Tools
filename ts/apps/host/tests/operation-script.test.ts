import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { freezeScript } from "../src/operation-script.ts";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Deferred, Effect, Layer } from "effect";
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node";
import { HttpRouter } from "effect/unstable/http";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { mintContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

it.each([
  ["Succeeded", "succeeded"],
  ["RuntimeFailed", "failed"],
  ["Cancelled", "cancelled"],
  ["UnexpectedStatus", "failed"],
  [undefined, "failed"],
])(
  "HTTP script outcome %s settles the durable action as %s",
  async (status, state) => {
    const dir = await mkdtemp(join(tmpdir(), "pe-script-outcome-"));
    const journal = new ActionJournal(join(dir, "actions.json"));
    const result = {
      ...(status === undefined ? {} : { status }),
      diagnostics: [{ stage: "policy", message: "diagnostic kept" }],
    };
    const invoke = vi.fn((key: string) =>
      Effect.succeed({
        value:
          key === "host.ops.catalog"
            ? {
                operations: [
                  {
                    key: "scripting.execute",
                    intent: "Mutate",
                    needs: "document",
                    requestSchemaJson: JSON.stringify({ type: "object" }),
                  },
                ],
              }
            : result,
        target: null,
      }),
    );
    const bridge = {
      list: Effect.succeed([
        {
          sessionId: "bridge-script",
          connected: true,
          lane: hostOwnership.lane,
          sourceRoot: hostOwnership.sourceRoot,
          serviceName: hostOwnership.serviceName,
          processId: 42,
          processStartUtcUnixMs: 1000,
          state: {
            openDocuments: [
              {
                openId: "open-script",
                address: "C:/Copy.rvt",
                title: "Copy",
                isFamilyDocument: false,
              },
            ],
          },
        },
      ]),
      invoke,
    } as unknown as RevitBridge["Service"];
    const server = createServer();
    const port = () => {
      const address = server.address();
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
              makeCallRoute(journal, undefined, { sdk: sdkSessions }),
            ),
            { disableLogger: true },
          ).pipe(
            Layer.provide(Layer.succeed(RevitBridge, bridge)),
            Layer.provide(NodeHttpClient.layerUndici),
            Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 })),
          ),
        ),
        Deferred.await(latch),
      ),
    );
    try {
      for (let i = 0; !port() && i < 200; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(port()).toBeGreaterThan(0);
      const id = randomUUID();
      const response = await fetch(`http://127.0.0.1:${port()}/actions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }),
        },
        body: JSON.stringify({
          id,
          key: "scripting.execute",
          target: {
            kind: "document",
            ref: { session: "bridge-script", openId: "open-script" },
          },
          input: { scriptContent: "WriteLine(1);" },
        }),
      });
      expect([200, 202], await response.clone().text()).toContain(response.status);
      const receipt = await journal.wait(id);
      expect(invoke.mock.calls.some(([key]) => key === "scripting.execute")).toBe(true);
      expect(receipt.state).toBe(state);
      expect(receipt.steps.at(-1)?.state).toBe(state);
      if (state === "failed") {
        expect(receipt).toMatchObject({ evidence: { result } });
        expect(receipt.steps.at(-1)).toMatchObject({ evidence: { result } });
        const reloaded = new ActionJournal(join(dir, "actions.json"));
        expect(await reloaded.wait(id)).toMatchObject({ state, evidence: { result } });
      }
      const read = await fetch(`http://127.0.0.1:${port()}/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }),
          "x-pe-bridge-session-id": "bridge-script",
          "x-pe-open-document-id": "open-script",
        },
        body: JSON.stringify({
          key: "scripting.execute",
          request: { scriptContent: "WriteLine(1);" },
        }),
      });
      // The query door relays native data; command settlement interprets its typed outcome.
      expect(read.status, await read.clone().text()).toBe(200);
      expect(await read.json()).toEqual(result);
    } finally {
      Effect.runSync(Deferred.succeed(latch, undefined));
      await done;
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);

it("freezes a supplied snapshot without reading disk and rejects ambiguous or authority bytes", async () => {
  const files = [{ path: "src/Run.cs", bytesBase64: Buffer.from("original").toString("base64") }];
  const frozen = await freezeScript({ sourcePath: "src/Run.cs", sourceBundle: { files } });
  files[0]!.bytesBase64 = "";
  expect(Buffer.from(frozen!.sourceBundle.files[0]!.bytesBase64, "base64").toString()).toBe(
    "original",
  );
  for (const paths of [
    ["src/A.cs", "src/a.cs"],
    ["src/A.cs", "Src/B.cs"],
    ["src", "src/A.cs"],
    ["pages/tour/.state/binding.json"],
    ["src/../A.cs"],
  ]) {
    await expect(
      freezeScript({
        sourcePath: "src/A.cs",
        sourceBundle: { files: paths.map((path) => ({ path, bytesBase64: "" })) },
      }),
    ).rejects.toThrow();
  }
});
