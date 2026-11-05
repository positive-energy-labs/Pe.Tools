import { NodeServices, NodeHttpClient } from "@effect/platform-node";
import { nativeReadRoot } from "../src/app.ts";
import { testHostInputs, detachedBridge, sessionView } from "./effect-test.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionJournal } from "../src/action-journal.ts";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { expect, test } from "vite-plus/test";
import { DUCTS_BODY_VERSION_HEADER, DUCTS_REFRESH_HEADER, type Caller } from "@pe/agent-contracts";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";
import { RevitBridge, type HostBridgeEvent } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { human, pea } from "./callers.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { SdkDriver, readSessionScope } from "../src/sdk-session.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";

test("retained /fans acquisition admits every caller and keeps miss, refresh and native identity truthful", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-ducts-reading-"));
  const target = { session: "bridge-a", openId: "open-a" };
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  const nativeIds: string[] = [];
  let observedStart = 1000;
  let wrongAnswer = false;
  let wait = Promise.resolve();
  let release = () => {};
  const bridge = detachedBridge({
    list: Effect.sync(() => [sessionView({
      connected: true, sessionId: target.session, sdkSessionId: "dev", ...hostOwnership,
      processId: 42, processStartUtcUnixMs: observedStart,
      state: { openDocuments: [{ openId: target.openId, address: "C:/HVAC.rvt", title: "HVAC", isFamilyDocument: false }] },
    })]),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invokeHandle: (key, _input, _session, openId, id) => Effect.gen(function* () {
      nativeIds.push(id!);
      const pending = wait;
      const start = wrongAnswer ? 2000 : observedStart;
      const answer = yield* Effect.cached(Effect.promise(async () => {
        await pending;
        return { value: key === "ducts.tables" ? { folder: "fixture", tables: {}, missing: [], unsupported: {} } : snapshot,
          nativeRequestId: id!, actualTarget: { processIncarnation: { pid: 42, startedAt: start },
            openDocumentLifetime: openId ? { openId } : { kind: "session-only" as const } },
          freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" as const }, cost: {}, outcome: "native-acknowledged" as const };
      }));
      return { answer, terminal: Effect.as(answer, "native-acknowledged" as const) };
    }),
  });
  const journal = new ActionJournal(join(dir, "journal.jsonl"), Date.now);
  const web = HttpRouter.toWebHandler(
    makeCallRoute(journal, undefined, { sdk: sdkSessions }, { captureHostOp: () => {} }).pipe(
      nativeReadRoot(Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args)))),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provide(testHostInputs), Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ), { disableLogger: true },
  );
  const post = (key: string, caller: Caller = human, extra: Record<string, string> = {}, session = target.session, input?: unknown) => {
    const headers = { "content-type": "application/json", [HOST_RPC_BRIDGE_SESSION_HEADER]: session,
      ...(key !== "ducts.tables" ? { [HOST_RPC_DOCUMENT_HEADER]: target.openId } : {}), ...extra };
    const identity = admittedRequestIdentity(caller, readSessionScope(headers));
    return web.handler(new Request("http://host/call", { method: "POST", headers,
      body: JSON.stringify({ key, request: input ?? (key === "ducts.tables" ? { ids: ["SD5-9"] } : { selector: { kind: "ids", ids: [1] } }) }),
    }), Context.make(RequestIdentity, identity));
  };
  try {
    for (const key of ["ducts.snapshot.walk", "ducts.tables"]) {
      const before = nativeIds.length;
      const cold = Promise.withResolvers<void>();
      wait = cold.promise;
      release = cold.resolve;
      const firstRead = post(key);
      const joinedRead = post(key);
      await expect.poll(() => nativeIds.length).toBe(before + 1);
      cold.resolve();
      const [first, joined] = await Promise.all([firstRead, joinedRead]);
      expect(joined.status, await joined.clone().text()).toBe(200);
      expect(joined.headers.get("x-pe-native-request-id")).toBe(first.headers.get("x-pe-native-request-id"));
      expect(joined.headers.get(DUCTS_BODY_VERSION_HEADER)).toBe(first.headers.get(DUCTS_BODY_VERSION_HEADER));
      expect([first, joined].map((response) => response.headers.get("x-pe-ducts-reused")).sort()).toEqual(["false", "true"]);
      wait = Promise.resolve();
      expect(first.status, await first.clone().text()).toBe(200);
      expect(first.headers.get("x-pe-ducts-reused")).toBe("false");
      expect(first.headers.get("x-pe-native-request-id")).toBe(nativeIds[before]);
      const version = first.headers.get(DUCTS_BODY_VERSION_HEADER)!;
      const next = await post(key, human, { [DUCTS_BODY_VERSION_HEADER]: version }, "dev");
      expect(next.status, await next.clone().text()).toBe(200);
      expect(next.headers.get("x-pe-native-request-id")).toBe(nativeIds[before]);
      expect(next.headers.get("x-pe-resolved-session")).toBe(target.session);
      expect(next.headers.get("x-pe-ducts-reused")).toBe("true");
      expect(await next.json()).toEqual(await first.json());
      expect(nativeIds).toHaveLength(before + 1);
      expect((await post(key, { kind: "anonymous" }, { [DUCTS_BODY_VERSION_HEADER]: version })).status).toBe(403);
      expect((await post(key, pea(), { [DUCTS_BODY_VERSION_HEADER]: version })).status).toBe(200);
      expect((await post(key, human, { [DUCTS_BODY_VERSION_HEADER]: "missing" })).status).toBe(409);
      expect((await post(key, human, {}, "foreign-session")).status).toBe(409);
      expect((await post(key, human, {}, target.session, { unexpected: true })).status).toBe(400);
      if (key !== "ducts.tables")
        expect((await post(key, human, { [HOST_RPC_DOCUMENT_HEADER]: "foreign-open" })).status).toBe(409);
      observedStart = 2000;
      expect((await post(key, human, { [DUCTS_BODY_VERSION_HEADER]: version })).status).toBe(409);
      observedStart = 1000;
      expect(nativeIds).toHaveLength(before + 1);
      const held = Promise.withResolvers<void>();
      wait = held.promise;
      release = held.resolve;
      const one = post(key, human, { [DUCTS_REFRESH_HEADER]: version });
      const two = post(key, human, { [DUCTS_REFRESH_HEADER]: version });
      await expect.poll(() => nativeIds.length).toBe(before + 2);
      held.resolve();
      const [a, b] = await Promise.all([one, two]);
      expect(a.status, await a.clone().text()).toBe(200);
      expect(b.status, await b.clone().text()).toBe(200);
      expect(a.headers.get(DUCTS_BODY_VERSION_HEADER)).toBe(b.headers.get(DUCTS_BODY_VERSION_HEADER));
      expect(a.headers.get(DUCTS_BODY_VERSION_HEADER)).not.toBe(version);
      expect(a.headers.get("x-pe-native-request-id")).toBe(b.headers.get("x-pe-native-request-id"));
      expect(nativeIds).toHaveLength(before + 2);
      wait = Promise.resolve();
    }
    const retained = await post("ducts.snapshot.walk");
    const version = retained.headers.get(DUCTS_BODY_VERSION_HEADER)!;
    wrongAnswer = true;
    const mismatched = await post("ducts.snapshot.walk", human, { [DUCTS_REFRESH_HEADER]: version });
    expect(mismatched.status).toBe(409);
    expect(await mismatched.text()).toContain("Native read target changed");
  } finally {
    release();
    await journal.close();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
