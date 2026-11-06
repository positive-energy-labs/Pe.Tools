/**
 * A recording answers HostNativeRead from its own takings and never reaches a live input (ADR 0031
 * rules 1, 2 and 5). Capture runs around the real HostNativeReadLive admission.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { HostInputContext } from "../src/input-context.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { expect } from "vite-plus/test";
import type { Caller } from "@pe/agent-contracts";
import { BridgeError, NoRevitSession } from "@pe/host-internal/dispatch";
import { HostNativeRead } from "@pe/host-internal/native-read";
import type { RequestIdentity as IdentityKey } from "@pe/host-internal/request-contracts";
import { effectTest } from "./effect-test.ts";
import { HostNativeReadLive } from "../src/native-read.ts";
import {
  hostNativeReadFor,
  nativeCatalogIdentity,
  nativeInputIdentity,
  openRecordingReader,
  openRecordingWriter,
  type HostInputLane,
} from "../src/native-recording.ts";
import { InvalidRead, NativeReads } from "../src/native-reads.ts";
import { Refused } from "../src/control.ts";
import { httpProblems } from "../src/http-problems.ts";
import { HttpRouter, HttpServerResponse } from "effect/http";
import {
  admittedRequestIdentity,
  ReadFreshness,
  RequestIdentity,
} from "../src/request-services.ts";
import { readSessionScope, SdkSession } from "../src/sdk-session.ts";
import { HOST_RPC_SDK_SESSION_HEADER, HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";

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
            Effect.suspend(
              (): Effect.Effect<never, BridgeError | InvalidRead | Refused | NoRevitSession> => {
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
                  : read.descriptor.operationKey in failures
                    ? Effect.fail(failures[read.descriptor.operationKey]!())
                    : read.descriptor.operationKey === "ducts.snapshot.walk"
                      ? // A refusal after dispatch: native answered, the generated contract refused it.
                        Effect.fail(
                          new InvalidRead({
                            message: "Native response violates its operation Schema",
                            status: 502,
                            problem: "read.response",
                          }),
                        )
                      : Effect.fail(
                          new BridgeError({
                            message: "socket closed mid-read",
                            status: 502,
                            problem: "bridge.lost",
                            nativeOutcome: "unknown-until-reconciled",
                            evidence: { nativeRequestId: "native-lost" },
                          }),
                        );
              },
            ),
          retained: Effect.succeed({ entries: 0, joiners: 0 }),
        }),
      ),
    ),
  );
  return { counts, layer };
}

/** Real failure classes the HTTP problem mapper distinguishes; BridgeError.outcome reads its evidence. */
const failures: Record<string, () => Refused | BridgeError | NoRevitSession> = {
  "revit.context.journal": () => new NoRevitSession(),
  "revit.catalog.concept-evidence": () =>
    new Refused({ code: "human.only", door: "/call", reason: "Ask the user to read this." }),
  "revit.apply.parameter-links.preview": () =>
    new BridgeError("session closed before dispatch", 409, { notDispatched: true }),
  "revit.catalog.parameter-bindings": () =>
    new BridgeError("native threw", 500, { dispatched: true, issues: [] } as never),
};

const run =
  (lane: HostInputLane, source = live(), caller: Caller = pea) =>
  <A, E>(effect: Effect.Effect<A, E, IdentityKey | HostNativeRead>) =>
    effect.pipe(
      Effect.provideService(RequestIdentity, admittedRequestIdentity(caller, {})),
      Effect.provide(hostNativeReadFor(lane, source.layer)),
    );
const read = (key: string, input: unknown = {}, scope: { openDocumentId?: string } = {}) =>
  Effect.flatMap(Effect.service(HostNativeRead), (reads) => reads.read({ key, input, scope }));
const outcome = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.map((answer) => ({ ok: answer })),
    Effect.catch((error: unknown) => {
      const { _tag, status, problem, nativeOutcome, evidence } = error as Record<string, unknown>;
      return Effect.succeed({ tag: _tag, status, problem, native: nativeOutcome, evidence });
    }),
  );
const bundle = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "pe-recording-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

effectTest("absent transport selectors do not truncate the first catalog taking", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const store = yield* openRecordingWriter(dir, identity, bounds);
    const source = live();
    // The retained browser's unscoped /ops uses this exact producer, then pins its resolved bridge.
    const scope = { ...readSessionScope({}), bridgeSessionId: "bridge-1" };
    const answered = yield* run({ kind: "live", captureStore: store }, source)(read("host.ops.catalog", {}, scope));
    expect(answered.value).toEqual(catalogAnswer);
    expect(store.capture.truncated()).toBeNull();
    expect(store.candidates(yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope }))).toHaveLength(1);
    const reader = yield* openRecordingReader(dir, identity, bounds);
    const forbidden = live();
    const lane = { kind: "recording", recordingStore: reader, at: null } as const;
    expect(yield* run(lane, forbidden)(read("host.ops.catalog", {}, scope))).toEqual(answered);
    expect(yield* outcome(run(lane, forbidden)(read("host.ops.catalog", {}, { ...scope, openDocumentId: "another-document" })))).toMatchObject({ problem: "recording.scope" });
    expect(forbidden.counts).toEqual({ built: 0, joins: 0 });
    expect(readSessionScope({
      [HOST_RPC_SDK_SESSION_HEADER]: '{"pid":7}',
      [HOST_RPC_BRIDGE_SESSION_HEADER]: "bridge-1",
      [HOST_RPC_DOCUMENT_HEADER]: "doc-A",
    })).toEqual({ session: { pid: 7 }, bridgeSessionId: "bridge-1", openDocumentId: "doc-A" });
  }),
);

effectTest(
  "a reopened recording replays answered, refused and unknown takings without a live SDK",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const capture = {
        kind: "live",
        captureStore: yield* openRecordingWriter(dir, identity, bounds),
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
        at: null, recordingStore: yield* openRecordingReader(dir, identity, bounds),
      } as const;
      const again = yield* run(lane, replayed)(read("host.ops.catalog"));
      expect(again).toEqual({ ...answered, value: catalogAnswer });
      // Each recorded failure replays as itself: no invented never-dispatched, evidence kept.
      expect(yield* outcome(run(lane, replayed)(read("nope.key")))).toEqual({
        tag: "InvalidRequest",
        status: 409,
        problem: "read.intent",
        native: undefined,
        evidence: undefined,
      });
      expect(yield* outcome(run(lane, replayed)(read("ducts.snapshot.roster")))).toEqual({
        tag: "BridgeError",
        status: 502,
        problem: "bridge.lost",
        native: "unknown-until-reconciled",
        evidence: { nativeRequestId: "native-lost" },
      });
      expect(replayed.counts).toEqual({ built: 0, joins: 0 });
    }),
);

effectTest(
  "equal observations are stored once yet stay distinct takings; replay needs a binding",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const store = yield* openRecordingWriter(dir, identity, bounds);
      const recorded = live();
      yield* run({ kind: "live", captureStore: store }, recorded)(read("host.ops.catalog"));
      yield* run({ kind: "live", captureStore: store }, recorded)(read("host.ops.catalog"));
      const key = yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} });
      const takings = store.candidates(key);
      expect(takings).toHaveLength(2);
      expect(yield* Effect.promise(() => readdir(join(dir, "observations")))).toHaveLength(1);
      expect(
        yield* outcome(run({ kind: "recording", recordingStore: store, at: null })(read("host.ops.catalog"))),
      ).toMatchObject({
        problem: "recording.ambiguous",
      });
      const bound = yield* run({
        kind: "recording",
        recordingStore: store, at: null,
        bindings: new Map([[key, takings[1]!.id]]),
      })(read("host.ops.catalog"));
      expect(bound.nativeRequestId).toBe("native-2");
    }),
);

effectTest("a miss, another build, a tampered observation and a full bundle each refuse", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const store = yield* openRecordingWriter(dir, identity, bounds);
    const taken = yield* run({ kind: "live", captureStore: store })(read("host.ops.catalog"));
    expect(taken.value).toEqual(catalogAnswer);
    expect(
      yield* outcome(run({ kind: "recording", recordingStore: store, at: null })(read("host.ops.catalog", { other: 1 }))),
    ).toMatchObject({
      problem: "recording.miss",
    });
    expect(
      yield* outcome(openRecordingReader(dir, { ...identity, build: "build-2" }, bounds)),
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
      yield* outcome(run({ kind: "recording", recordingStore: store, at: null })(read("host.ops.catalog"))),
    ).toMatchObject({
      problem: "recording.tamper",
    });
    const full = yield* openRecordingWriter(yield* bundle, identity, {
      maxBytes: 1_000_000,
      maxTakings: 1,
    });
    yield* run({ kind: "live", captureStore: full })(read("host.ops.catalog"));
    // K4: full after the live read completed stops capture; the live answer is returned unchanged.
    expect(
      yield* outcome(run({ kind: "live", captureStore: full })(read("host.ops.catalog"))),
    ).toMatchObject({ ok: { value: catalogAnswer, outcome: "committed", nativeRequestId: "native-1" } });
    expect(full.capture.truncated()).toEqual({ at: 2, reason: "full" });
    expect(
      full.candidates(
        yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} }),
      ),
    ).toHaveLength(1);
  }),
);

effectTest(
  "replay admits each caller and fences the recorded document, even through a binding",
  () =>
    Effect.gen(function* () {
      const store = yield* openRecordingWriter(yield* bundle, identity, bounds);
      yield* run({ kind: "live", captureStore: store })(
        read("ducts.snapshot.walk", {}, { openDocumentId: "doc-A" }),
      ).pipe(Effect.ignore);
      const lane = { kind: "recording", recordingStore: store, at: null } as const;
      expect(
        yield* outcome(
          run(lane, live(), { kind: "anonymous" })(
            read("ducts.snapshot.walk", {}, { openDocumentId: "doc-A" }),
          ),
        ),
      ).toMatchObject({ tag: "Refused" });
      expect(
        yield* outcome(run(lane)(read("ducts.snapshot.walk", {}, { openDocumentId: "doc-A" }))),
      ).toMatchObject({
        tag: "InvalidRequest",
        status: 502,
        problem: "read.response",
        native: undefined,
      });
      expect(
        yield* outcome(run(lane)(read("ducts.snapshot.walk", {}, { openDocumentId: "doc-B" }))),
      ).toMatchObject({
        problem: "recording.scope",
      });
      const key = yield* nativeInputIdentity({ key: "ducts.snapshot.walk", input: {}, scope: {} });
      const [taking] = store.candidates(key);
      const bound = { kind: "recording", recordingStore: store, at: null, bindings: new Map([[key, taking!.id]]) } as const;
      expect(
        yield* outcome(run(bound)(read("ducts.snapshot.walk", {}, { openDocumentId: "doc-B" }))),
      ).toMatchObject({
        problem: "recording.scope",
      });
    }),
);

effectTest(
  "a failed durable write leaves nothing replayable; concurrent equal observations both persist",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const broken = yield* openRecordingWriter(dir, identity, bounds);
      yield* Effect.promise(() => rm(join(dir, "observations"), { recursive: true, force: true }));
      expect(
        yield* outcome(run({ kind: "live", captureStore: broken })(read("host.ops.catalog"))),
      ).toMatchObject({ ok: { value: catalogAnswer } });
      expect(broken.capture.truncated()).toEqual({ at: 1, reason: "io" });
      const key = yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} });
      expect(broken.candidates(key)).toEqual([]);
      expect((yield* openRecordingReader(dir, identity, bounds)).candidates(key)).toEqual([]);

      const fresh = yield* bundle;
      const store = yield* openRecordingWriter(fresh, identity, bounds);
      const source = live();
      yield* Effect.all(
        [1, 2].map(() => run({ kind: "live", captureStore: store }, source)(read("host.ops.catalog"))),
        {
          concurrency: "unbounded",
        },
      );
      expect(yield* Effect.promise(() => readdir(join(fresh, "observations")))).toHaveLength(1);
      const reopened = yield* openRecordingReader(fresh, identity, bounds);
      const takings = reopened.candidates(key);
      expect(takings).toHaveLength(2);
      const bound = {
        kind: "recording",
        at: null, recordingStore: reopened,
        bindings: new Map([[key, takings[0]!.id]]),
      } as const;
      expect((yield* run(bound)(read("host.ops.catalog"))).value).toEqual(catalogAnswer);
    }),
);

effectTest(
  "a damaged bundle refuses at open: a non-hash observation name or an oversized takings file",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const store = yield* openRecordingWriter(dir, identity, bounds);
      yield* run({ kind: "live", captureStore: store })(read("host.ops.catalog"));
      const path = join(dir, "takings.jsonl");
      const line = (yield* Effect.promise(() => readFile(path, "utf8"))).trim();
      const sha = (JSON.parse(line) as { outcome: { observation: string } }).outcome.observation;
      yield* Effect.promise(() => writeFile(path, `${line.replace(sha, "../../manifest")}\n`));
      expect(yield* outcome(openRecordingReader(dir, identity, bounds))).toMatchObject({
        problem: "recording.tamper",
      });
      yield* Effect.promise(() => writeFile(path, `${line}\n`));
      expect(
        yield* outcome(openRecordingReader(dir, identity, { maxBytes: 64, maxTakings: 100 })),
      ).toMatchObject({
        problem: "recording.full",
      });
    }),
);

effectTest(
  "recorded Refused and evidence-classified BridgeErrors replay unchanged through the HTTP problem mapper",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const store = yield* openRecordingWriter(dir, identity, bounds);
      const served = (lane: HostInputLane) => {
        const web = HttpRouter.toWebHandler(
          HttpRouter.add("GET", "/read/*", (req) =>
            Effect.flatMap(Effect.service(HostNativeRead), (reads) =>
              reads.read({ key: req.url.split("/read/")[1]!, input: {}, scope: {} }),
            ).pipe(
              Effect.map(() => HttpServerResponse.text("answered")),
              Effect.provideService(RequestIdentity, admittedRequestIdentity(pea, {})),
              Effect.provide(hostNativeReadFor(lane, live().layer)),
            ),
          ).pipe(Layer.provide(httpProblems)),
          { disableLogger: true },
        );
        return (key: string) =>
          Effect.promise(async () => {
            const response = await web.handler(
              new Request(`http://host/read/${key}`),
              Context.empty() as never,
            );
            const seen = {
              status: response.status,
              refusal: response.headers.get("x-pe-refusal"),
              body: await response.json(),
            };
            await web.dispose();
            return seen;
          });
      };
      const lane = { kind: "recording", recordingStore: store, at: null } as const;
      // A failure replay cannot rebuild exactly stops capture (K4); the live failure is returned
      // unchanged and no taking claims to hold it.
      const unsupported = yield* openRecordingWriter(yield* bundle, identity, bounds);
      expect(
        yield* outcome(run({ kind: "live", captureStore: unsupported })(read("revit.context.journal"))),
      ).toEqual(yield* outcome(run({ kind: "live" })(read("revit.context.journal"))));
      expect(unsupported.capture.truncated()).toEqual({ at: 1, reason: "unsupported" });
      expect(
        unsupported.candidates(
          yield* nativeInputIdentity({ key: "revit.context.journal", input: {}, scope: {} }),
        ),
      ).toEqual([]);
      for (const key of Object.keys(failures).filter((key) => key !== "revit.context.journal")) {
        const live = yield* served({ kind: "live", captureStore: store })(key);
        expect(yield* served(lane)(key)).toEqual(live);
      }
      const replayed = yield* Effect.flip(
        run(lane)(
          Effect.flatMap(Effect.service(HostNativeRead), (reads) =>
            reads.read({ key: "revit.apply.parameter-links.preview", input: {}, scope: {} }),
          ),
        ),
      );
      expect((replayed as BridgeError).outcome).toBe("refused");
      const failed = yield* Effect.flip(
        run(lane)(
          Effect.flatMap(Effect.service(HostNativeRead), (reads) =>
            reads.read({ key: "revit.catalog.parameter-bindings", input: {}, scope: {} }),
          ),
        ),
      );
      expect((failed as BridgeError).outcome).toBe("failed");
      const path = join(dir, "takings.jsonl");
      const lines = (yield* Effect.promise(() => readFile(path, "utf8")))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const damaged = lines.find((taking) => taking.outcome.failure?.tag === "BridgeError");
      expect(damaged).toBeDefined();
      damaged.outcome.failure.evidence.notDispatched = "yes";
      yield* Effect.promise(() =>
        writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n"),
      );
      expect(yield* outcome(openRecordingReader(dir, identity, bounds))).toMatchObject({
        problem: "recording.tamper",
      });
    }),
);

effectTest(
  "a historical reader refuses a missing bundle without creating it and exposes no append",
  () =>
    Effect.gen(function* () {
      const root = yield* bundle;
      const absent = join(root, "never-recorded");
      expect(yield* outcome(openRecordingReader(absent, identity, bounds))).toMatchObject({
        status: 404,
        problem: "recording.missing",
      });
      expect(yield* Effect.promise(() => readdir(root))).toEqual([]);
      yield* run({ kind: "live", captureStore: yield* openRecordingWriter(absent, identity, bounds) })(
        read("host.ops.catalog"),
      );
      const before = yield* Effect.promise(() => readFile(join(absent, "takings.jsonl"), "utf8"));
      const reader = yield* openRecordingReader(absent, identity, bounds);
      expect(reader).not.toHaveProperty("append");
      expect(reader.readSets).not.toHaveProperty("keep");
      expect(reader.points).not.toHaveProperty("keep");
      expect(
        (yield* run({ kind: "recording", at: null, recordingStore: reader })(read("host.ops.catalog"))).value,
      ).toEqual(catalogAnswer);
      yield* outcome(
        run({ kind: "recording", at: null, recordingStore: reader })(read("host.ops.catalog", { other: 1 })),
      );
      expect(yield* Effect.promise(() => readFile(join(absent, "takings.jsonl"), "utf8"))).toBe(
        before,
      );
    }),
);

effectTest("K4: a full capture stops recording at the second read and every live answer stays exact", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const store = yield* openRecordingWriter(dir, identity, { maxBytes: 1_000_000, maxTakings: 1 });
    const source = live();
    const lane = { kind: "live", captureStore: store } as const;
    const inputs = HostInputContext.pipe(Effect.provide(HostInputContext.layer(lane)));
    const first = yield* outcome(run(lane, source)(read("ducts.snapshot.walk", {}, { openDocumentId: "doc-A" })));
    expect(first).toMatchObject({ tag: "InvalidRequest", status: 502, problem: "read.response" });
    expect((yield* inputs).source).toEqual({ kind: "live", capturing: true });
    // The second read finds the bundle full: it still answers, from its one live call.
    const second = yield* run(lane, source)(read("host.ops.catalog"));
    expect(second.value).toEqual(catalogAnswer);
    expect(source.counts.joins).toBe(2);
    expect((yield* inputs).source).toEqual({ kind: "live", capturing: false, truncated: { at: 2, reason: "full" } });
    const third = yield* run(lane, source)(read("host.ops.catalog"));
    expect(third.value).toEqual(catalogAnswer);
    expect(source.counts.joins).toBe(3);
    const reader = yield* openRecordingReader(dir, identity, bounds);
    expect(reader.coverage()).toEqual(["native"]);
    expect(reader.candidates(yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} }))).toEqual([]);
    expect(reader.truncation).toEqual({ at: 2, reason: "full" });
    // The third read made no capture attempt: the latch still names the second.
    expect(store.capture.truncated()).toEqual({ at: 2, reason: "full" });
  }),
);

effectTest("K4: an I/O capture failure keeps the exact native answer, and a live refusal stays that refusal", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const store = yield* openRecordingWriter(dir, identity, bounds);
    yield* Effect.promise(() => rm(join(dir, "observations"), { recursive: true, force: true }));
    const lane = { kind: "live", captureStore: store } as const;
    const uncaptured = yield* run({ kind: "live" })(read("host.ops.catalog"));
    const answer = yield* run(lane)(read("host.ops.catalog"));
    expect(answer).toEqual(uncaptured);
    expect(answer).toMatchObject({ nativeRequestId: "native-1", outcome: "committed", value: catalogAnswer });
    expect(store.capture.truncated()).toEqual({ at: 1, reason: "io" });
    for (const key of Object.keys(failures))
      expect(yield* outcome(run(lane)(read(key)))).toEqual(yield* outcome(run({ kind: "live" })(read(key))));
  }),
);

effectTest("an observer failure truncates capture and leaves the actual native answer exact", () =>
  Effect.gen(function* () {
    const store = yield* openRecordingWriter(yield* bundle, identity, bounds);
    const seen: string[] = [];
    const observe = (fail: boolean) => (taking: { id: string }) =>
      fail
        ? Effect.fail(new InvalidRead({ message: "read set closed", status: 409, problem: "read-set.closed" }))
        : Effect.sync(() => void seen.push(taking.id));
    const lane = { kind: "live", captureStore: store } as const;
    const through = (fail: boolean) =>
      read("host.ops.catalog").pipe(
        Effect.provideService(RequestIdentity, admittedRequestIdentity(pea, {})),
        Effect.provide(hostNativeReadFor(lane, live().layer, observe(fail))),
      );
    const answer = yield* through(false);
    const identityOf = yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} });
    expect(seen).toEqual(store.candidates(identityOf).map((taking) => taking.id));
    expect(yield* through(true)).toEqual(answer);
    expect(store.capture.truncated()).toEqual({ at: 2, reason: "observer" });
    expect(yield* through(false)).toEqual(answer);
    expect(seen).toHaveLength(1);
  }),
);
