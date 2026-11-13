import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callRouteOver, detachedBridge, journalAt, sessionView, testHostInputs } from "./effect-test.ts";
import { human, pea } from "./callers.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { nativeReadRoot } from "../src/native-read-root.ts";
import { RevitBridge } from "../src/bridge.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { admittedRequestIdentity, RequestIdentity } from "../src/request-services.ts";
import { httpProblems } from "../src/http-problems.ts";

// No shipped native op currently excludes Pea. Keep the real catalog/schema, narrowing only policy.
test.each(["/call", "/native"])("eligible caller witness at %s", async (door) => {
  const key = "settings.schema";
  const input = { schemaUrl: "/schemas/settings/ff/Family.json" };
  const definition = hostOpCatalog.find((row) => row.key === key)!;
  const find = hostOpCatalog.find.bind(hostOpCatalog);
  const policy = vi.spyOn(hostOpCatalog, "find").mockImplementation((predicate, thisArg) => {
    const row = find(predicate, thisArg);
    return row?.key === key ? { ...row, actor: "human" } : row;
  });
  const root = await mkdtemp(join(tmpdir(), "pe-eligible-caller-"));
  const journal = journalAt(join(root, "journal.jsonl"), Date.now);
  const dispatched: string[] = [];
  const answer = { value: { schemaJson: "{}" }, nativeRequestId: "witness",
    actualTarget: { processIncarnation: { pid: 42, startedAt: 1000 }, openDocumentLifetime: { openId: "open-a" } },
    freshness: { freshnessGeneration: "witness:0" }, cost: {}, outcome: "native-acknowledged" as const };
  const session = sessionView({ ...hostOwnership, connected: true, sessionId: "bridge-a", processId: 42, processStartUtcUnixMs: 1000,
    state: { openDocuments: [{ openId: "open-a", isActive: true }] } });
  const bridge = detachedBridge({
    invoke: (op) => Effect.die(new Error(`Unexpected bridge invoke: ${op}`)),
    list: Effect.succeed([session]),
    snapshot: () => Effect.succeed(session),
    invokeHandle: (op) => Effect.sync(() => {
      dispatched.push(op);
      return { answer: Effect.succeed({ ...answer, freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" as const } }), terminal: Effect.succeed("native-acknowledged" as const) };
    }),
  });
  const web = HttpRouter.toWebHandler(Layer.mergeAll(
    callRouteOver(journal, undefined, { sdk: sdkSessions }, {
      captureHostOp: () => {},
      // Isolate /call's gate: the second native-read gate must not rescue a deleted /call check.
      nativeBody: () => Effect.sync(() => { dispatched.push(key); return { answer }; }),
    }).pipe(Layer.provide(testHostInputs)),
    HttpRouter.add("POST", "/native", () => Effect.gen(function* () {
      const native = yield* HostNativeRead;
      const result = yield* native.read({ key, input, scope: { bridgeSessionId: "bridge-a", openDocumentId: "open-a" } });
      return HttpServerResponse.jsonUnsafe(result.value);
    })).pipe(Layer.provide(httpProblems)),
  ).pipe(
    HttpRouter.provideRequest(Layer.succeed(RevitBridge, bridge)),
    nativeReadRoot(Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args)))),
    HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
    Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
  ), { disableLogger: true });
  const send = (caller: typeof human) => web.handler(new Request(`http://host${door}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, request: input }),
  }), Context.make(RequestIdentity, admittedRequestIdentity(caller, { bridgeSessionId: "bridge-a", openDocumentId: "open-a" })));
  try {
    expect(definition.effect).toBe("Read");
    const refused = await send(pea());
    expect(refused.status, await refused.clone().text()).toBe(403);
    expect(await refused.json()).toMatchObject({ refusal: { code: "human.only", door: door === "/call" ? "/call" : "native-read" } });
    expect(dispatched).toEqual([]);
    expect(await journal.list()).toEqual([]);
    const allowed = await send(human);
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(await allowed.json()).toEqual(answer.value);
    expect(dispatched).toEqual([key]);
  } finally {
    await web.dispose();
    await journal.close();
    policy.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
