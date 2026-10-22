import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { withInvocationContext } from "@pe/runtime/context";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { ductsNativeRead } from "../src/ducts-analysis.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { mintContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import type { RevitBridge } from "../src/bridge.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { serveRoutes } from "./real-server.ts";

test("the analysis read adapter preserves Pea admission and never borrows a human principal", async () => {
  let nativeReads = 0;
  const bridge = {
    subscribe: () => () => {},
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
            { openId: "open-a", address: "C:/HVAC.rvt", title: "HVAC", isFamilyDocument: false },
          ],
        },
      },
    ]),
    invoke: (key: string) =>
      Effect.promise(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (key === "host.ops.catalog")
          return {
            value: {
              operations: [
                {
                  key: "ducts.snapshot",
                  intent: "Read",
                  needs: "project-document",
                  actor: "human",
                },
              ],
            },
            target: null,
          };
        nativeReads++;
        return {
          value: { fixture: true },
          target: {
            session: "bridge-a",
            document: "C:/HVAC.rvt",
            documentRef: { session: "bridge-a", openId: "open-a" },
          },
        };
      }),
  } as unknown as RevitBridge["Service"];
  const server = await serveRoutes(
    makeCallRoute(undefined, undefined, { sdk: sdkSessions }),
    bridge,
  );
  try {
    const call = ductsNativeRead(server.base);
    const target = { session: "bridge-a", openId: "open-a" };
    const pea = await withInvocationContext(
      {
        hostBaseUrl: server.base,
        headers: {
          [HOST_CONTEXT_HEADER]: mintContext({ kind: "pea", thread: "analysis-fixture" }),
        },
      },
      () => call("ducts.snapshot", {}, target),
    );
    expect(pea.status).toBe(403);
    expect(nativeReads).toBe(0);
    const human = await withInvocationContext(
      {
        hostBaseUrl: server.base,
        headers: { [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }) },
      },
      () => call("ducts.snapshot", {}, target),
    );
    expect(human.status, await human.clone().text()).toBe(200);
    expect(human.headers.get("x-pe-native-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(nativeReads).toBe(1);
  } finally {
    await server.close();
  }
}, 30_000);
