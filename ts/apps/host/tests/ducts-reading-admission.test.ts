import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import { DUCTS_BODY_VERSION_HEADER, DUCTS_REFRESH_HEADER, type Caller } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { RevitBridge, type HostBridgeEvent } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { asCaller, human, pea } from "./callers.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

test("every retained /call hit is admitted, SDK aliases share ownership, and response metadata remains native", async () => {
  const target = { session: "bridge-a", openId: "open-a" };
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  let reads = 0;
  const bridge = {
    list: Effect.succeed([
      {
        connected: true,
        sessionId: target.session,
        sdkSessionId: "dev",
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            {
              openId: target.openId,
              address: "C:/HVAC.rvt",
              title: "HVAC",
              isFamilyDocument: false,
            },
          ],
        },
      },
    ]),
    subscribe: (listener: (event: HostBridgeEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invoke: (key: string) =>
      Effect.sync(() =>
        key === "host.ops.catalog"
          ? {
              value: {
                operations: [
                  {
                    key: "ducts.snapshot",
                    intent: "Read",
                    needs: "project-document",
                    actor: "human",
                  },
                  { key: "ducts.tables", intent: "Read", needs: "nothing", actor: "human" },
                ],
              },
              target: null,
            }
          : {
              value: { nativeRead: ++reads },
              target: {
                session: target.session,
                document: "C:/HVAC.rvt",
                ...(key === "ducts.snapshot" ? { documentRef: target } : {}),
              },
            },
      ),
  } as unknown as RevitBridge["Service"];
  const web = HttpRouter.toWebHandler(
    makeCallRoute(
      undefined,
      undefined,
      { sdk: sdkSessions },
      {
        forwardBase: null,
        dispatch: () => Effect.die("No TS-only calls expected"),
        captureHostOp: () => {},
      },
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
  const post = (
    key: string,
    caller: Caller = human,
    extra: Record<string, string> = {},
    session = target.session,
  ) =>
    asCaller(caller, web.handler)(
      new Request("http://host/call", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HOST_RPC_BRIDGE_SESSION_HEADER]: session,
          ...(key === "ducts.snapshot" ? { [HOST_RPC_DOCUMENT_HEADER]: target.openId } : {}),
          ...extra,
        },
        body: JSON.stringify({ key, request: key === "ducts.tables" ? { ids: ["SD5-9"] } : {} }),
      }),
      Context.empty() as never,
    );
  try {
    for (const key of ["ducts.snapshot", "ducts.tables"]) {
      const first = await post(key);
      expect(first.status, await first.clone().text()).toBe(200);
      expect(first.headers.get("x-pe-ducts-reused")).toBe("false");
      const version = first.headers.get(DUCTS_BODY_VERSION_HEADER)!;
      const next = await post(key, human, { [DUCTS_BODY_VERSION_HEADER]: version }, "dev");
      expect(next.status, await next.clone().text()).toBe(200);
      expect(next.headers.get("x-pe-native-request-id")).toBe(
        first.headers.get("x-pe-native-request-id"),
      );
      expect(next.headers.get("x-pe-resolved-session")).toBe(target.session);
      expect(next.headers.get("x-pe-ducts-reused")).toBe("true");
      expect(await next.json()).toEqual(await first.json());
      expect((await post(key, pea(), { [DUCTS_BODY_VERSION_HEADER]: version })).status).toBe(403);
      const before = reads;
      expect((await post(key, human, { [DUCTS_BODY_VERSION_HEADER]: "missing" })).status).toBe(409);
      expect(reads).toBe(before);
      const [a, b] = await Promise.all([
        post(key, human, { [DUCTS_REFRESH_HEADER]: version }),
        post(key, human, { [DUCTS_REFRESH_HEADER]: version }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.headers.get(DUCTS_BODY_VERSION_HEADER)).toBe(
        b.headers.get(DUCTS_BODY_VERSION_HEADER),
      );
      expect(a.headers.get(DUCTS_BODY_VERSION_HEADER)).not.toBe(version);
      expect(reads).toBe(before + 1);
    }
    expect(reads).toBe(4);
  } finally {
    await web.dispose();
  }
});
