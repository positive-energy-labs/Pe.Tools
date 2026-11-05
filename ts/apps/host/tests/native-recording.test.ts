/**
 * A recording answers HostNativeRead from its own takings and never reaches a live input (ADR 0031
 * rules 1, 2 and 5). Capture runs around the real HostNativeReadLive admission.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { expect } from "vite-plus/test";
import type { Caller } from "@pe/agent-contracts";
import { BridgeError } from "@pe/host-internal/dispatch";
import { HostNativeRead } from "@pe/host-internal/native-read";
import type { RequestIdentity as IdentityKey } from "@pe/host-internal/request-contracts";
import { effectTest } from "./effect-test.ts";
import { HostNativeReadLive } from "../src/native-read.ts";
import {
  hostNativeReadFor,
  nativeCatalogIdentity,
  nativeInputIdentity,
  openRecordingStore,
  type InputLane,
} from "../src/native-recording.ts";
import { NativeReads } from "../src/native-reads.ts";
import {
  admittedRequestIdentity,
  ReadFreshness,
  RequestIdentity,
} from "../src/request-services.ts";
import { SdkSession } from "../src/sdk-session.ts";

const pea = { kind: "pea", thread: "t1" } as Caller;
const identity = { build: "build-1", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
const catalogAnswer = { operations: [], constants: {} };

/** The real live admission over a fake SDK and native join; `built` counts live SDK acquisitions. */
function live() {
  const counts = { built: 0, joins: 0 };
  const session = {
    sessionId: "bridge-1",
    processId: 7,
    processStartUtcUnixMs: 1_000,
    state: { openDocuments: [{ openId: "doc-A", isActive: true, isFamilyDocument: false }] },
  };
  const layer = HostNativeReadLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReadFreshness.layer,
        Layer.effect(
          SdkSession,
          Effect.sync(() => {
            counts.built++;
            return {
              resolve: () => Effect.succeed(session as never),
              resolveAttachment: () => Effect.succeed(session as never),
            };
          }),
        ),
        Layer.succeed(NativeReads, {
          join: (read) =>
            Effect.suspend(() => {
              counts.joins++;
              return read.descriptor.operationKey === "host.ops.catalog"
                ? Effect.succeed({
                    value: catalogAnswer,
                    nativeRequestId: `native-${counts.joins}`,
                    actualTarget: {
                      processIncarnation: { pid: 7, startedAt: 1_000 },
                      openDocumentLifetime: { kind: "session-only" },
                    },
                    freshness: { freshnessGeneration: "g1" },
                    cost: { elapsed: 3 },
                    outcome: "committed",
                  } as never)
                : Effect.fail(
                    new BridgeError({
                      message: "socket closed mid-read",
                      status: 502,
                      problem: "bridge.lost",
                      nativeOutcome: "unknown-until-reconciled",
                    }),
                  );
            }),
          retained: Effect.succeed({ entries: 0, joiners: 0 }),
        }),
      ),
    ),
  );
  return { counts, layer };
}

const run =
  (lane: InputLane, source = live()) =>
  <A, E>(effect: Effect.Effect<A, E, IdentityKey | HostNativeRead>) =>
    effect.pipe(
      Effect.provideService(RequestIdentity, admittedRequestIdentity(pea, {})),
      Effect.provide(hostNativeReadFor(lane, source.layer)),
    );
const read = (key: string, input: unknown = {}) =>
  Effect.flatMap(Effect.service(HostNativeRead), (reads) => reads.read({ key, input, scope: {} }));
const outcome = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.map((answer) => ({ ok: answer })),
    Effect.catch((error: unknown) =>
      Effect.succeed({
        problem: (error as { problem?: string }).problem,
        native: (error as { nativeOutcome?: string }).nativeOutcome,
      }),
    ),
  );
const bundle = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "pe-recording-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

effectTest(
  "a reopened recording replays answered, refused and unknown takings without a live SDK",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const capture = {
        kind: "live",
        capture: yield* openRecordingStore(dir, identity, bounds),
      } as const;
      const recorded = live();
      const answered = yield* run(capture, recorded)(read("host.ops.catalog"));
      expect(yield* outcome(run(capture, recorded)(read("nope.key")))).toMatchObject({
        problem: "read.intent",
      });
      expect(yield* outcome(run(capture, recorded)(read("ducts.snapshot.roster")))).toMatchObject({
        problem: "bridge.lost",
      });

      const replayed = live();
      const lane = {
        kind: "recording",
        store: yield* openRecordingStore(dir, identity, bounds),
      } as const;
      const again = yield* run(lane, replayed)(read("host.ops.catalog"));
      expect(again).toEqual({ ...answered, value: catalogAnswer });
      expect(yield* outcome(run(lane, replayed)(read("nope.key")))).toEqual({
        problem: "recording.refused",
        native: "never-dispatched",
      });
      expect(yield* outcome(run(lane, replayed)(read("ducts.snapshot.roster")))).toEqual({
        problem: "recording.unknown",
        native: "unknown-until-reconciled",
      });
      expect(replayed.counts).toEqual({ built: 0, joins: 0 });
    }),
);

effectTest(
  "equal observations are stored once yet stay distinct takings; replay needs a binding",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const store = yield* openRecordingStore(dir, identity, bounds);
      const recorded = live();
      yield* run({ kind: "live", capture: store }, recorded)(read("host.ops.catalog"));
      yield* run({ kind: "live", capture: store }, recorded)(read("host.ops.catalog"));
      const key = yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} });
      const takings = store.candidates(key);
      expect(takings).toHaveLength(2);
      expect(yield* Effect.promise(() => readdir(join(dir, "observations")))).toHaveLength(1);
      expect(
        yield* outcome(run({ kind: "recording", store })(read("host.ops.catalog"))),
      ).toMatchObject({
        problem: "recording.ambiguous",
      });
      const bound = yield* run({
        kind: "recording",
        store,
        bindings: new Map([[key, takings[1]!.id]]),
      })(read("host.ops.catalog"));
      expect(bound.nativeRequestId).toBe("native-2");
    }),
);

effectTest("a miss, another build, a tampered observation and a full bundle each refuse", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const store = yield* openRecordingStore(dir, identity, bounds);
    const taken = yield* run({ kind: "live", capture: store })(read("host.ops.catalog"));
    expect(taken.value).toEqual(catalogAnswer);
    expect(
      yield* outcome(run({ kind: "recording", store })(read("host.ops.catalog", { other: 1 }))),
    ).toMatchObject({
      problem: "recording.miss",
    });
    expect(
      yield* outcome(openRecordingStore(dir, { ...identity, build: "build-2" }, bounds)),
    ).toMatchObject({
      problem: "recording.mismatch",
    });
    const [observation] = yield* Effect.promise(() => readdir(join(dir, "observations")));
    yield* Effect.promise(() =>
      writeFile(
        join(dir, "observations", observation!),
        JSON.stringify({ operations: [1], constants: {} }),
      ),
    );
    expect(
      yield* outcome(run({ kind: "recording", store })(read("host.ops.catalog"))),
    ).toMatchObject({
      problem: "recording.tamper",
    });
    const full = yield* openRecordingStore(yield* bundle, identity, {
      maxBytes: 1_000_000,
      maxTakings: 1,
    });
    yield* run({ kind: "live", capture: full })(read("host.ops.catalog"));
    expect(
      yield* outcome(run({ kind: "live", capture: full })(read("host.ops.catalog"))),
    ).toMatchObject({
      problem: "recording.full",
    });
    expect(
      full.candidates(
        yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} }),
      ),
    ).toHaveLength(1);
  }),
);
