import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { expect } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";
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
    const bridge = {
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
      invoke: (_key: string, input: { requestId: string }) =>
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
    } as unknown as RevitBridge["Service"];
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
      const bridge = {
        list: Effect.succeed([
          {
            ...hostOwnership,
            connected: true,
            sessionId: "session",
            processId: process.pid,
            processStartUtcUnixMs: 1000,
            state: {
              openDocuments: [
                {
                  openId: "open-a",
                  isActive: true,
                  isFamilyDocument: false,
                  title: "Model",
                  address: "C:/model.rvt",
                },
              ],
            },
          },
        ]),
        subscribe: () => () => {},
      } as unknown as RevitBridge["Service"];
      const sdkDriver = () =>
        Effect.succeed(
          replay("doc-list", {
            result: { documents: [] },
            resolved: {
              payload: hostOwnership.lane === "dev" ? "checkout" : "installed",
              sourceRoot: hostOwnership.sourceRoot,
              installedRoot: hostOwnership.installedRoot,
              pid: process.pid,
              processStartUtc: new Date(1000).toISOString(),
              id: null,
              how: null,
              buildStamp: null,
              observedAtUtc: new Date(1000).toISOString(),
              origin: null,
            },
          }),
        );
      const web = HttpRouter.toWebHandler(
        makeCallRoute(journal, {} as TakeoffCaptures, {}, { sdkDriver }).pipe(
          HttpRouter.provideRequest(
            Layer.succeed(
              RequestIdentity,
              admittedRequestIdentity(
                { kind: "human", via: "local" },
                { bridgeSessionId: "session" },
              ),
            ),
          ),
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
            Context.empty(),
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
    }),
);
