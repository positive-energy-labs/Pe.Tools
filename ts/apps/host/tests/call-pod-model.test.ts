import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { expect, test, vi } from "vite-plus/test";
import {
  callRouteOver,
  detachedBridge,
  journalAt,
  sessionView,
  testHostInputs,
} from "./effect-test.ts";
import { pea } from "./callers.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { nativeReadRoot } from "../src/native-read-root.ts";
import { RevitBridge } from "../src/bridge.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { admittedRequestIdentity, RequestIdentity } from "../src/request-services.ts";

const manifest = {
  id: "tour",
  for: { title: "Chadds", probes: [{ elementId: 42, uniqueId: "chadds-42" }] },
};
const sourceBundle = {
  files: [
    { path: "pod.json", bytesBase64: Buffer.from(JSON.stringify(manifest)).toString("base64") },
  ],
};

test.each(["bundle", "source-path", "unscoped"] as const)(
  "C3: Pea /call refuses a wrong-model or unresolved Pod through %s",
  async (door) => {
    await withCall(async (send, calls, root) => {
      if (door === "source-path") {
        const home = join(root, "home");
        vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
        await mkdir(join(home, "Pods", "Tour", "src"), { recursive: true });
        await writeFile(join(home, "pe-home.json"), '{"tier":"user"}');
        await writeFile(join(home, "Pods", "Tour", "pod.json"), JSON.stringify(manifest));
        await writeFile(join(home, "Pods", "Tour", "src", "Run.cs"), "class Run {}");
      }
      const response = await send(
        {
          sourcePath: "src/Run.cs",
          workspaceKey: "Tour",
          // A Pod run is a read at /call only when it says so: native takes the declared mode otherwise.
          permissionMode: "ReadOnly",
          ...(door === "source-path" ? {} : { sourceBundle }),
        },
        door !== "unscoped",
      );
      expect(response.status, await response.clone().text()).toBe(409);
      if (door === "unscoped") {
        // Before gatewayTarget can resolve the active document, /call requires an exact read target.
        expect(await response.json()).toMatchObject({
          message:
            "Submit the original exact admission to /actions; raw mutation dispatch is retired",
          notDispatched: true,
        });
        expect(calls).toEqual([]);
        return;
      }
      expect(await response.json()).toMatchObject({
        kind: "InvalidRequest",
        message: "this Pod is for Chadds; the bound document is Other",
      });
      expect(calls).toEqual(["revit.detail.elements"]);
    });
  },
);

test.each([{ input: [] }, { input: { sourceBundle: { files: "invalid" } } }])(
  "/call refuses malformed script input with typed 400: $input",
  async ({ input }) => {
    await withCall(async (send, calls) => {
      const response = await send(input);
      expect(response.status, await response.clone().text()).toBe(400);
      expect(await response.json()).toMatchObject({ kind: "InvalidRequest" });
      expect(calls).toEqual([]);
    });
  },
);

async function withCall(
  run: (
    send: (input: unknown, scoped?: boolean) => Promise<Response>,
    calls: string[],
    root: string,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "pe-call-pod-"));
  const journal = journalAt(join(root, "journal.jsonl"), Date.now);
  const calls: string[] = [];
  const session = sessionView({
    ...hostOwnership,
    connected: true,
    sessionId: "bridge-a",
    processId: 42,
    processStartUtcUnixMs: 1000,
    state: { openDocuments: [{ openId: "open-a", isActive: true }] },
  });
  const bridge = detachedBridge({
    list: Effect.succeed([session]),
    snapshot: () => Effect.succeed(session),
    invoke: (key) =>
      Effect.sync(() => {
        calls.push(key);
        return {
          value:
            key === "revit.detail.elements"
              ? { documentTitle: "Other", entries: [] }
              : { status: "Succeeded" },
          target: { session: "bridge-a", document: null },
        };
      }),
  });
  const web = HttpRouter.toWebHandler(
    callRouteOver(journal, undefined, { sdk: sdkSessions }, { captureHostOp: () => {} }).pipe(
      Layer.provide(testHostInputs),
      HttpRouter.provideRequest(Layer.succeed(RevitBridge, bridge)),
      nativeReadRoot(Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args)))),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ),
    { disableLogger: true },
  );
  const send = (input: unknown, scoped = true) =>
    web.handler(
      new Request("http://host/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "scripting.execute", request: input }),
      }),
      Context.make(
        RequestIdentity,
        admittedRequestIdentity(
          pea(),
          scoped ? { bridgeSessionId: "bridge-a", openDocumentId: "open-a" } : {},
        ),
      ),
    );
  try {
    await run(send, calls, root);
  } finally {
    await web.dispose();
    await journal.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}
