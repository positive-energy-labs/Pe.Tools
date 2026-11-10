import { Deferred, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { addressSchema } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import { CANCEL_OPERATION_KEY } from "../src/bridge.ts";
import { retainedDuctsRead } from "../src/call-route.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { HostNativeReadLive } from "../src/native-read.ts";
import { NativeReads } from "../src/native-reads.ts";
import { mintContext, retireContext } from "../src/control.ts";
import { RequestIdentity } from "../src/request-services.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { detachedBridge, sessionView, settle } from "./effect-test.ts";
import { serveRoutes } from "./real-server.ts";
import { replay } from "./sdk-replay.ts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";

test.each([false, true])("retained Ducts abort both=%s preserves shared native custody and request admission", async (both) => {
  let dispatches = 0, cancels = 0;
  const identities: string[] = [];
  let reads: NativeReads["Service"];
  let finish = () => {};
  const bridge = detachedBridge({
    list: Effect.succeed([sessionView({ ...hostOwnership, connected: true, sessionId: "session", processId: 42,
      processStartUtcUnixMs: 1000, state: { openDocuments: [{ openId: "open-a", isActive: true, title: "Model", address: "C:/model.rvt" }] } })]),
    invokeHandle: (_key, _input, _session, _open, id) => Effect.gen(function* () {
      dispatches++;
      const gate = yield* Deferred.make<void>();
      finish = () => { void settle(Deferred.succeed(gate, undefined)); };
      return { answer: Deferred.await(gate).pipe(Effect.as({ value: snapshot, nativeRequestId: id!,
        actualTarget: { processIncarnation: { pid: 42, startedAt: 1000 }, openDocumentLifetime: { openId: "open-a" } },
        freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" as const }, cost: {}, outcome: "native-acknowledged" as const })),
        terminal: Deferred.await(gate).pipe(Effect.as("native-acknowledged" as const)) };
    }),
    invoke: (key) => Effect.sync(() => {
      expect(key).toBe(CANCEL_OPERATION_KEY); cancels++;
      return { value: {}, target: { session: "session", document: null } };
    }),
  });
  const decorated = Layer.effect(HostNativeRead, Effect.gen(function* () {
    const native = yield* HostNativeRead;
    reads = yield* NativeReads;
    return { ...native, read: (input: Parameters<typeof native.read>[0]) => Effect.gen(function* () {
      identities.push((yield* RequestIdentity).requestId);
      return yield* native.read(input);
    }) };
  })).pipe(Layer.provide(HostNativeReadLive));
  const owner = new DuctsReadings();
  const server = await serveRoutes(HttpRouter.add("POST", "/call", () => retainedDuctsRead(owner,
    { key: "ducts.snapshot.roster", input: { selector: { kind: "roster" } }, scope: { bridgeSessionId: "session", openDocumentId: "open-a" } }, {},
    { document: () => Effect.succeed({ session: "session", openId: "open-a", address: addressSchema.parse("C:/model.rvt") }) },
  )).pipe(HttpRouter.provideRequest(decorated)), bridge,
    Layer.succeed(SdkDriver, () => Effect.succeed(replay("doc-list", { result: { documents: [] }, resolved: {
      payload: hostOwnership.lane === "dev" ? "checkout" : "installed", sourceRoot: hostOwnership.sourceRoot,
      installedRoot: hostOwnership.installedRoot, pid: 42, processStartUtc: new Date(1000).toISOString(),
      id: null, how: null, buildStamp: null, observedAtUtc: new Date(1000).toISOString(), origin: null,
    } }))));
  const controllers = [new AbortController(), new AbortController()];
  const token = mintContext({ kind: "human", via: "cli" });
  const responses = controllers.map((controller) => fetch(`${server.base}/call`, { method: "POST", signal: controller.signal,
    headers: { "x-pe-context": token } }).catch(() => undefined));
  try {
    await expect.poll(async () => reads && (await settle(reads.retained)).joiners).toBe(2);
    expect(new Set(identities).size).toBe(2);
    controllers[0]!.abort(); await responses[0];
    await expect.poll(async () => (await settle(reads.retained)).joiners).toBe(1);
    expect(cancels).toBe(0);
    if (both) {
      controllers[1]!.abort(); await responses[1];
      await expect.poll(() => cancels).toBe(1);
    } else {
      finish();
      const response = (await responses[1])!;
      expect(response.status).toBe(200); expect(await response.json()).toEqual(snapshot);
      expect(cancels).toBe(0);
    }
    expect(dispatches).toBe(1);
  } finally {
    controllers.forEach((controller) => controller.abort()); finish();
    retireContext(token); await server.close();
  }
});
