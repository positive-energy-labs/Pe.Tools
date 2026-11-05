import { opsCatalogRoute } from "../src/ops-catalog.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { nativeReadRoot, settingsSchemaRoute } from "../src/app.ts";
import { testHostInputs } from "./effect-test.ts";
import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { expect } from "vite-plus/test";
import { detachedBridge, sessionView, effectTest } from "./effect-test.ts";
import { NativeReads, NativeReadLimits } from "../src/native-reads.ts";
import { RevitBridge } from "../src/bridge.ts";
import { prepareRead } from "../../../packages/host-internal/src/read-admission.ts";
import type { DoorFailure, NativeAnswer, NativeOutcome } from "@pe/host-internal/request-contracts";
import { HttpRouter } from "effect/http";
import { makeCallRoute } from "../src/call-route.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { replay } from "./sdk-replay.ts";
import type { ActionJournal } from "../src/action-journal.ts";
import type { TakeoffCaptures } from "../src/takeoff-captures.ts";

const descriptor = {
  operationKey: "read",
  operation: { key: "read", intent: "Read" as const },
  processIncarnation: { pid: 42, startedAt: 1000 },
  openDocumentLifetime: { openId: "open-a" },
  freshnessGeneration: "generation:0",
  representation: "overview" as const,
  responseSchemaVersion: "1",
};
const prepare = (input: Schema.Json = {}, overrides = {}) =>
  prepareRead({ ...descriptor, ...overrides }, input, Schema.Json, Schema.Json);
const until = (ready: () => boolean): Effect.Effect<void> =>
  Effect.suspend(() =>
    ready() ? Effect.void : Effect.yieldNow.pipe(Effect.andThen(until(ready))),
  );

const makeHarness = (holdCancel = false) =>
  Effect.gen(function* () {
    const jobs: {
      id: string;
      answer: Deferred.Deferred<NativeAnswer<unknown, "unavailable">, DoorFailure>;
      terminal: Deferred.Deferred<NativeOutcome>;
    }[] = [];
    const cancels: string[] = [];
    let cancelWaiters = 0;
    const bridge = detachedBridge({
      invokeHandle: (
        _key: string,
        _input: unknown,
        _session?: string,
        _open?: string | null,
        id?: string,
      ) =>
        Effect.gen(function* () {
          const job = {
            id: id!,
            answer: yield* Deferred.make<NativeAnswer<unknown, "unavailable">, DoorFailure>(),
            terminal: yield* Deferred.make<NativeOutcome>(),
          };
          jobs.push(job);
          return { answer: Deferred.await(job.answer), terminal: Deferred.await(job.terminal) };
        }),
      invoke: (_key: string, input: any) =>
        Effect.gen(function* () {
          cancels.push(input.requestId);
          if (holdCancel) {
            cancelWaiters++;
            yield* Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  cancelWaiters--;
                }),
              ),
            );
          }
          return { value: {}, target: { session: "session", document: null } };
        }),
    });
    const services = yield* Layer.build(
      NativeReads.layer.pipe(Layer.provide(Layer.succeed(RevitBridge, bridge))),
    );
    const reads = Context.get(services, NativeReads);
    const answer = (index: number, value: Schema.Json = {}) =>
      Deferred.succeed(jobs[index]!.answer, {
        value,
        nativeRequestId: jobs[index]!.id,
        actualTarget: {
          processIncarnation: descriptor.processIncarnation,
          openDocumentLifetime: descriptor.openDocumentLifetime,
        },
        freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" },
        cost: {},
        outcome: "native-acknowledged",
      });
    return { reads, jobs, cancels, answer, cancelWaiters: () => cancelWaiters };
  });
const harness = makeHarness();

effectTest(
  "joiners detach independently; last departure cancels once and retirement lasts until terminal, not answer",
  () =>
    Effect.gen(function* () {
      const { reads, jobs, cancels, cancelWaiters } = yield* makeHarness(true);
      const read = yield* prepare();
      const one = yield* reads.join(read, "session").pipe(Effect.forkScoped);
      yield* until(() => jobs.length === 1);
      const two = yield* reads.join(read, "session").pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect((yield* reads.retained).joiners).toBe(2);
      yield* Fiber.interrupt(one);
      expect(cancels).toEqual([]);
      yield* Fiber.interrupt(two);
      yield* until(() => cancels.length === 1);
      expect(cancels).toEqual([jobs[0]!.id]);
      expect(cancelWaiters()).toBe(1);
      yield* Deferred.fail(jobs[0]!.answer, {
        _tag: "BridgeError",
        message: "unknown",
        status: 503,
        problem: "native.unknown",
      } as DoorFailure);
      yield* Effect.yieldNow;
      const refused = yield* reads.join(read, "session").pipe(Effect.result);
      expect(refused._tag).toBe("Failure");
      if (refused._tag === "Failure") expect(refused.failure._tag).toBe("ReadRetiring");
      expect(jobs).toHaveLength(1);
      expect((yield* reads.retained).entries).toBe(1);
      yield* Deferred.succeed(jobs[0]!.terminal, "native-acknowledged");
      yield* Effect.yieldNow;
      expect((yield* reads.retained).entries).toBe(0);
      yield* until(() => cancelWaiters() === 0);
    }),
);

effectTest(
  "canonical objects share; array order, incarnation, open lifetime and freshness do not",
  () =>
    Effect.gen(function* () {
      const { reads, jobs } = yield* harness;
      const input = { nested: { b: 2, a: 1 }, ids: [1, 2] };
      yield* reads.join(yield* prepare(input), "session").pipe(Effect.forkScoped);
      yield* until(() => jobs.length === 1);
      yield* reads
        .join(yield* prepare({ ids: [1, 2], nested: { a: 1, b: 2 } }), "session")
        .pipe(Effect.forkScoped);
      for (const read of [
        yield* prepare({ ...input, ids: [2, 1] }),
        yield* prepare(input, { freshnessGeneration: "generation:1" }),
        yield* prepare(input, { processIncarnation: { pid: 42, startedAt: 2000 } }),
        yield* prepare(input, { openDocumentLifetime: { openId: "open-b" } }),
      ])
        yield* reads.join(read, "session").pipe(Effect.forkScoped);
      yield* until(() => jobs.length === 5);
      expect((yield* reads.retained).joiners).toBe(6);
    }),
);

effectTest("successful values reach surviving joiners and are never cached after terminal", () =>
  Effect.gen(function* () {
    const { reads, jobs, answer, cancels } = yield* harness;
    const read = yield* prepare();
    const leaving = yield* reads.join(read, "session").pipe(Effect.forkScoped);
    const staying = yield* reads.join(read, "session").pipe(Effect.forkScoped);
    yield* until(() => jobs.length === 1);
    yield* Fiber.interrupt(leaving);
    yield* answer(0, { result: true });
    expect((yield* Fiber.join(staying)).value).toEqual({ result: true });
    expect(cancels).toEqual([]);
    yield* Deferred.succeed(jobs[0]!.terminal, "native-acknowledged");
    yield* Effect.yieldNow;
    yield* reads.join(read, "session").pipe(Effect.forkScoped);
    yield* until(() => jobs.length === 2);
  }),
);

effectTest("entry, joiner, encoded key and result bounds refuse without duplicate dispatch", () =>
  Effect.gen(function* () {
    const { reads, jobs, answer } = yield* harness;
    const read = yield* prepare();
    const waiting = yield* reads.join(read, "session").pipe(Effect.result, Effect.forkScoped);
    yield* until(() => jobs.length === 1);
    expect((yield* reads.join(read, "session").pipe(Effect.result))._tag).toBe("Failure");
    expect(
      (yield* reads.join(yield* prepare({ other: true }), "session").pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect(
      (yield* reads.join(yield* prepare({ data: "x".repeat(2000) }), "session").pipe(Effect.result))
        ._tag,
    ).toBe("Failure");
    expect(jobs).toHaveLength(1);
    yield* answer(0, { data: "x".repeat(2000) });
    const oversized = yield* Fiber.join(waiting);
    expect(oversized._tag).toBe("Failure");
    if (oversized._tag === "Failure") expect(oversized.failure._tag).toBe("ReadBusy");
    expect((yield* reads.retained).entries).toBe(1);
  }).pipe(
    Effect.provideService(NativeReadLimits, {
      entries: 1,
      joiners: 1,
      keyBytes: 1024,
      resultBytes: 1024,
    }),
  ),
);

effectTest(
  "the host resolve door canonicalizes admitted input, resolves an implicit document and advances on journal acceptance",
  () =>
    Effect.gen(function* () {
      let accepted: (() => void) | undefined;
      const journal = {
        bindCommands: () => {},
        subscribe: (query: unknown, listener: () => void) => {
          expect(query).toEqual({ kinds: ["action"] });
          accepted = listener;
          return () => {
            accepted = undefined;
          };
        },
      } as unknown as ActionJournal;
      let activeOpen = "open-a";
      let processStart = 1000;
      let connected = true;
      let sdkCalls = 0;
      let sharedReads: NativeReads["Service"] | undefined;
      const jobs: { id: string; openId: string; start: number; answer: Deferred.Deferred<NativeAnswer<unknown, "unavailable">, DoorFailure>; terminal: Deferred.Deferred<NativeOutcome> }[] = [];
      const bridge = detachedBridge({
        invokeHandle: (_key, _input, _session, openId, id) => Effect.gen(function* () {
          const job = { id: id!, openId: openId!, start: processStart,
            answer: yield* Deferred.make<NativeAnswer<unknown, "unavailable">, DoorFailure>(),
            terminal: yield* Deferred.make<NativeOutcome>() };
          jobs.push(job);
          return { answer: Deferred.await(job.answer), terminal: Deferred.await(job.terminal) };
        }),
        list: Effect.sync(() => connected ? [
          sessionView({
            ...hostOwnership,
            connected: true,
            sessionId: "session",
            processId: process.pid,
            processStartUtcUnixMs: processStart,
            state: {
              openDocuments: [
                {
                  openId: activeOpen,
                  isActive: true,
                  isFamilyDocument: false,
                  title: "Model",
                  address: "C:/model.rvt",
                },
              ],
            },
          }),
        ] : []),
      });
      const sdkDriver = () => {
        sdkCalls++;
        return Effect.succeed(
          replay("doc-list", {
            result: { documents: [] },
            resolved: {
              payload: hostOwnership.lane === "dev" ? "checkout" : "installed",
              sourceRoot: hostOwnership.sourceRoot,
              installedRoot: hostOwnership.installedRoot,
              pid: process.pid,
              processStartUtc: new Date(processStart).toISOString(),
              id: null,
              how: null,
              buildStamp: null,
              observedAtUtc: new Date(1000).toISOString(),
              origin: null,
            },
          }),
        );
      };
      const web = HttpRouter.toWebHandler(
        Layer.mergeAll(
          makeCallRoute(journal, {} as TakeoffCaptures, {}).pipe(Layer.provide(testHostInputs)),
          settingsSchemaRoute,
          opsCatalogRoute(() => Effect.die("not navigation")),
          Layer.effectDiscard(Effect.gen(function* () { sharedReads = yield* NativeReads; })),
        ).pipe(nativeReadRoot(Layer.succeed(SdkDriver, sdkDriver))).pipe(
          HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
          Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
        ),
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
      const resolve = (input: object, operationKey = "revit.detail.space-scene") =>
        Effect.promise(async () => {
          const response = await web.handler(
            new Request("http://host/pe/reads/resolve", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ operationKey, input }),
            }),
            Context.make(RequestIdentity, admittedRequestIdentity({ kind: "human", via: "local" }, { bridgeSessionId: "session" })),
          );
          return { status: response.status, body: await response.json() };
        });
      const first = yield* resolve({ elementIds: [3, 2], contextRepresentation: "overview" });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.openDocumentLifetime).toEqual({ openId: "open-a" });
      expect(first.body.processIncarnation).toEqual({ pid: process.pid, startedAt: 1000 });
      expect(first.body.normalizedInput).toBe(
        '{"contextRepresentation":"overview","elementIds":[3,2]}',
      );
      const reordered = yield* resolve({ contextRepresentation: "overview", elementIds: [3, 2] });
      expect(reordered.body).toEqual(first.body);
      accepted!();
      const afterWrite = yield* resolve({ elementIds: [3, 2], contextRepresentation: "overview" });
      expect(afterWrite.body.freshnessGeneration).not.toBe(first.body.freshnessGeneration);
      expect((yield* resolve({}, "missing.operation")).status).toBe(409);
      const schemaUrl = "http://host/schemas/settings/ff/Family.json";
      const request = (call = false, anonymous = false) => Effect.promise(() => web.handler(
        call ? new Request("http://host/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "settings.schema", request: { schemaUrl } }) }) : new Request(schemaUrl),
        Context.make(RequestIdentity, admittedRequestIdentity(anonymous ? { kind: "anonymous" } : { kind: "human", via: "local" }, { bridgeSessionId: "session" })),
      ));
      const call = yield* request(true).pipe(Effect.forkScoped);
      yield* until(() => jobs.length === 1);
      const sibling = yield* request().pipe(Effect.forkScoped);
      while ((yield* sharedReads!.retained).joiners !== 2) yield* Effect.yieldNow;
      expect(jobs).toHaveLength(1);
      expect((yield* request(false, true)).status).toBe(403);
      expect(jobs).toHaveLength(1);
      activeOpen = "open-b";
      const replacementDoc = yield* request().pipe(Effect.forkScoped);
      yield* until(() => jobs.length === 2);
      accepted!();
      const nextGeneration = yield* request().pipe(Effect.forkScoped);
      yield* until(() => jobs.length === 3);
      processStart = 2000;
      const replacementProcess = yield* request().pipe(Effect.forkScoped);
      yield* until(() => jobs.length === 4);
      expect(jobs.map((job) => [job.openId, job.start])).toEqual([
        ["open-a", 1000], ["open-b", 1000], ["open-b", 1000], ["open-b", 2000],
      ]);
      for (const job of jobs) {
        yield* Deferred.succeed(job.answer, { value: { schemaJson: "{}" }, nativeRequestId: job.id,
          actualTarget: { processIncarnation: { pid: process.pid, startedAt: job.start }, openDocumentLifetime: { openId: job.openId } },
          freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" }, cost: {}, outcome: "native-acknowledged" });
        yield* Deferred.succeed(job.terminal, "native-acknowledged");
      }
      const callResponse = yield* Fiber.join(call);
      expect(callResponse.status).toBe(200);
      expect(yield* Effect.promise(() => callResponse.json())).toEqual({ schemaJson: "{}" });
      for (const fiber of [sibling, replacementDoc, nextGeneration, replacementProcess]) {
        const response = yield* Fiber.join(fiber);
        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.text())).toBe("{}");
      }

      const conflict = yield* Effect.promise(() => web.handler(new Request("http://host/ops?session=other", { headers: { "x-pe-bridge-session-id": "session" } }),
        Context.make(RequestIdentity, admittedRequestIdentity({ kind: "human", via: "local" }, {}))));
      expect(conflict.status).toBe(400);
      connected = false;
      const beforeFallback = sdkCalls;
      const fallback = yield* Effect.promise(() => web.handler(new Request("http://host/ops"),
        Context.make(RequestIdentity, admittedRequestIdentity({ kind: "human", via: "local" }, {}))));
      expect(fallback.status).toBe(200);
      const catalog = yield* Effect.promise(() => fallback.json());
      expect(catalog.operations.some((op: { key: string }) => op.key === "revit.detail.elements")).toBe(true);
      expect(catalog.bridgeCatalogError).toBe("No Revit session is connected to the bridge.");
      expect(sdkCalls).toBe(beforeFallback);

    }),
);
