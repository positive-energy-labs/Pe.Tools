/**
 * A recording answers HostNativeRead from its own takings and never reaches a live input (ADR 0031
 * rules 1, 2 and 5). Capture runs around the real HostNativeReadLive admission.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  openRecordingStore,
  type InputLane,
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
  (lane: InputLane, source = live(), caller: Caller = pea) =>
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
    // Full after the live read completed: a typed refusal that still says the read was dispatched.
    expect(
      yield* outcome(run({ kind: "live", capture: full })(read("host.ops.catalog"))),
    ).toMatchObject({
      status: 507,
      problem: "recording.full",
      native: "committed",
      evidence: { nativeRequestId: "native-1" },
    });
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
      const store = yield* openRecordingStore(yield* bundle, identity, bounds);
      yield* run({ kind: "live", capture: store })(
        read("ducts.snapshot.walk", {}, { openDocumentId: "doc-A" }),
      ).pipe(Effect.ignore);
      const lane = { kind: "recording", store } as const;
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
      const bound = { kind: "recording", store, bindings: new Map([[key, taking!.id]]) } as const;
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
      const broken = yield* openRecordingStore(dir, identity, bounds);
      yield* Effect.promise(() => rm(join(dir, "observations"), { recursive: true, force: true }));
      expect(
        yield* outcome(run({ kind: "live", capture: broken })(read("host.ops.catalog"))),
      ).toMatchObject({
        problem: "recording.io",
      });
      const key = yield* nativeInputIdentity({ key: "host.ops.catalog", input: {}, scope: {} });
      expect(broken.candidates(key)).toEqual([]);
      expect((yield* openRecordingStore(dir, identity, bounds)).candidates(key)).toEqual([]);

      const fresh = yield* bundle;
      const store = yield* openRecordingStore(fresh, identity, bounds);
      const source = live();
      yield* Effect.all(
        [1, 2].map(() => run({ kind: "live", capture: store }, source)(read("host.ops.catalog"))),
        {
          concurrency: "unbounded",
        },
      );
      expect(yield* Effect.promise(() => readdir(join(fresh, "observations")))).toHaveLength(1);
      const reopened = yield* openRecordingStore(fresh, identity, bounds);
      const takings = reopened.candidates(key);
      expect(takings).toHaveLength(2);
      const bound = {
        kind: "recording",
        store: reopened,
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
      const store = yield* openRecordingStore(dir, identity, bounds);
      yield* run({ kind: "live", capture: store })(read("host.ops.catalog"));
      const path = join(dir, "takings.jsonl");
      const line = (yield* Effect.promise(() => readFile(path, "utf8"))).trim();
      const sha = (JSON.parse(line) as { outcome: { observation: string } }).outcome.observation;
      yield* Effect.promise(() => writeFile(path, `${line.replace(sha, "../../manifest")}\n`));
      expect(yield* outcome(openRecordingStore(dir, identity, bounds))).toMatchObject({
        problem: "recording.tamper",
      });
      yield* Effect.promise(() => writeFile(path, `${line}\n`));
      expect(
        yield* outcome(openRecordingStore(dir, identity, { maxBytes: 64, maxTakings: 100 })),
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
      const store = yield* openRecordingStore(dir, identity, bounds);
      const served = (lane: InputLane) => {
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
      const lane = { kind: "recording", store } as const;
      // A failure replay cannot rebuild exactly is refused at capture; no taking claims to hold it.
      expect(
        yield* outcome(run({ kind: "live", capture: store })(read("revit.context.journal"))),
      ).toMatchObject({
        status: 501,
        problem: "recording.unsupported",
      });
      expect(
        store.candidates(
          yield* nativeInputIdentity({ key: "revit.context.journal", input: {}, scope: {} }),
        ),
      ).toEqual([]);
      for (const key of Object.keys(failures).filter((key) => key !== "revit.context.journal")) {
        const live = yield* served({ kind: "live", capture: store })(key);
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
        .trim().split("\n").map((line) => JSON.parse(line));
      const damaged = lines.find((taking) => taking.outcome.failure?.tag === "BridgeError");
      expect(damaged).toBeDefined();
      damaged.outcome.failure.evidence.notDispatched = "yes";
      yield* Effect.promise(() => writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n"));
      expect(yield* outcome(openRecordingStore(dir, identity, bounds))).toMatchObject({
        problem: "recording.tamper",
      });
    }),
);
