/**
 * Store v2 for the non-native owners (ADR 0031 rules 1, 2 and 5): files, marks and the session
 * inventory keep exactly what their live owner answered, replay it without any live owner, and
 * refuse a miss, another ref, an ambiguity, a full bundle or an older format.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import type { Caller } from "@pe/agent-contracts";
import { effectTest } from "./effect-test.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { InvalidRead } from "../src/native-reads.ts";
import {
  inputBindingKey,
  inputIdentity,
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
  replayInput,
  type Taking,
} from "../src/native-recording.ts";
import { admittedRequestIdentity, RequestIdentity } from "../src/request-services.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";

const identity = { build: "build-1", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
const bundle = Effect.promise(() => mkdtemp(join(tmpdir(), "pe-recorded-inputs-")));
const reader = (dir: string) => openRecordingReader(dir, identity, bounds);
const problem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flip(effect).pipe(Effect.map((error) => (error as { problem?: string }).problem));
const service = <I, S, E>(tag: Context.Key<I, S>, layer: Layer.Layer<I, E>) =>
  Effect.map(Layer.build(layer), (context) => Context.get(context, tag));
const asPea = Effect.provideService(
  RequestIdentity,
  admittedRequestIdentity({ kind: "pea", thread: "t1" } as Caller, {}),
);

// The actual firm fallback and catalog findings, not a seed the replay could re-derive.
const firm = {
  firm: FIRM_SEED,
  path: "C:\\firm\\ducts.json",
  present: false,
  error: "Unexpected token",
};
const catalogs = {
  tables: {},
  findings: ["Duplicate catalog table t1; no table with this id is admitted"],
};
const liveFiles = Layer.succeed(DuctFiles, {
  firm: Effect.succeed(firm),
  ductCatalogs: Effect.succeed(catalogs),
});

effectTest("format 1 and 2 bundles refuse explicitly and are never migrated", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const v1 = { version: 1, ...identity, coverage: { kind: "partial", inputs: ["native-read"] } };
    yield* Effect.promise(() => writeFile(join(dir, "manifest.json"), JSON.stringify(v1)));
    expect(yield* problem(reader(dir))).toBe("recording.mismatch");
    expect(yield* problem(openRecordingWriter(dir, identity, bounds))).toBe("recording.mismatch");
    const v2 = { version: 2, ...identity };
    yield* Effect.promise(() => writeFile(join(dir, "manifest.json"), JSON.stringify(v2)));
    expect(yield* problem(reader(dir))).toBe("recording.mismatch");
  }),
);

effectTest(
  "files replay the recorded fallback and findings; a missing firm refuses without disk or seed",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const files = yield* service(
        DuctFiles,
        DuctFiles.capturing(writer).pipe(Layer.provide(liveFiles)),
      );
      expect(yield* files.ductCatalogs).toEqual(catalogs);
      expect(writer.coverage()).toEqual(["files"]);
      const recorded = yield* service(DuctFiles, DuctFiles.recorded(yield* reader(dir)));
      expect(yield* recorded.ductCatalogs).toEqual(catalogs);
      expect(yield* problem(recorded.firm)).toBe("recording.miss");
      yield* files.firm;
      const again = yield* service(DuctFiles, DuctFiles.recorded(yield* reader(dir)));
      expect(yield* again.firm).toEqual(firm);
    }),
);

effectTest(
  "marks replay the exact observed values for that ref only; no null or bundle time is invented",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const live = hostMarks({
        observedSince: 5,
        changedAt: (ref) => (ref.openId === "A" ? 42 : null),
        subscribe: () => () => {},
      });
      const marks = yield* service(
        HostDocumentMarks,
        HostDocumentMarks.capturing(writer).pipe(
          Layer.provide(Layer.succeed(HostDocumentMarks, live)),
        ),
      );
      const A = { session: "bridge-1", openId: "A" };
      const B = { session: "bridge-1", openId: "B" };
      expect(yield* marks.snapshot(A)).toEqual({ observedSince: 5, changedAt: 42 });
      yield* marks.snapshot(B);
      const recorded = yield* service(
        HostDocumentMarks,
        HostDocumentMarks.recorded(yield* reader(dir)),
      );
      expect(yield* recorded.snapshot(A)).toEqual({ observedSince: 5, changedAt: 42 });
      // B had not changed when it was read: that null was observed, not supplied by the replay.
      expect(yield* recorded.snapshot(B)).toEqual({ observedSince: 5, changedAt: null });
      expect(yield* problem(recorded.snapshot({ session: "bridge-2", openId: "A" }))).toBe(
        "recording.miss",
      );
      expect(() => recorded.changedAt(A)).toThrow(InvalidRead);
      expect(() => recorded.observedSince).toThrow(InvalidRead);
      yield* marks.snapshot(A);
      const twice = yield* service(
        HostDocumentMarks,
        HostDocumentMarks.recorded(yield* reader(dir)),
      );
      expect(yield* problem(twice.snapshot(A))).toBe("recording.ambiguous");
    }),
);

effectTest("inventory replays recorded answers and refusal classes without an SDK or bridge", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const writer = yield* openRecordingWriter(dir, identity, bounds);
    const closed = new InvalidRead({
      message: "Sheet Work target is no longer open",
      status: 409,
      problem: "target.closed",
    });
    const live = Layer.succeed(HostSessionInventory, {
      list: () => Effect.fail(closed), subscribe: () => () => {},
      attachment: () => Effect.succeed({ sessionId: "bridge-1" }),
      session: () => Effect.succeed({ sessionId: "bridge-1" }),
      document: () => Effect.fail(closed),
    });
    const inventory = yield* service(
      HostSessionInventory,
      HostSessionInventory.capturing(writer).pipe(Layer.provide(live)),
    );
    const ref = { session: "bridge-1", openId: "A" };
    yield* asPea(inventory.attachment("sdk-alias"));
    yield* asPea(Effect.flip(inventory.document(ref)));
    yield* asPea(Effect.flip(inventory.list()));
    const recorded = yield* service(
      HostSessionInventory,
      HostSessionInventory.recorded(yield* reader(dir)),
    );
    expect(yield* asPea(recorded.attachment("sdk-alias"))).toEqual({ sessionId: "bridge-1" });
    const refused = yield* asPea(Effect.flip(recorded.document(ref)));
    expect(refused).toBeInstanceOf(InvalidRead);
    expect(refused).toMatchObject({ problem: "target.closed", status: 409 });
    const listRefused = yield* asPea(Effect.flip(recorded.list()));
    expect(listRefused).toBeInstanceOf(InvalidRead);
    expect(listRefused).toMatchObject({ problem: "target.closed", status: 409 });
    expect(yield* asPea(problem(recorded.attachment("other")))).toBe("recording.miss");
    expect(yield* asPea(problem(recorded.session({ bridgeSessionId: "bridge-1" })))).toBe(
      "recording.miss",
    );
    expect(writer.coverage()).toEqual(["document"]);
  }),
);

effectTest("an unrebuildable failure or a full bundle stops capture, keeps no taking and returns the live result", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const writer = yield* openRecordingWriter(dir, identity, {
      maxBytes: 1_000_000,
      maxTakings: 1,
    });
    const broken = Layer.succeed(DuctFiles, {
      firm: Effect.fail(new Error("disk") as never),
      ductCatalogs: Effect.succeed(catalogs),
    });
    const files = yield* service(
      DuctFiles,
      DuctFiles.capturing(writer).pipe(Layer.provide(broken)),
    );
    // K4: the live failure is returned as it was; capture stops instead of failing the read.
    expect((yield* Effect.flip(files.firm)) as unknown).toEqual(new Error("disk"));
    expect(writer.capture.truncated()).toEqual({ at: 1, stoppedAt: expect.any(Number), reason: "unsupported" });
    expect(writer.coverage()).toEqual([]);
    const fullDir = yield* bundle;
    const full = yield* openRecordingWriter(fullDir, identity, { maxBytes: 1_000_000, maxTakings: 1 });
    const kept = yield* service(DuctFiles, DuctFiles.capturing(full).pipe(Layer.provide(liveFiles)));
    yield* kept.ductCatalogs;
    expect(yield* kept.ductCatalogs).toEqual(catalogs);
    expect(full.capture.truncated()).toEqual({ at: 2, stoppedAt: expect.any(Number), reason: "full" });
    expect((yield* reader(fullDir)).coverage()).toEqual(["files"]);
  }),
);

const FIRM = { kind: "files", file: "firm" } as const;

effectTest(
  "equal takings stay distinct: unbound refuses, an exact binding serves, a foreign binding refuses",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const seen: Taking[] = [];
      const files = yield* service(
        DuctFiles,
        DuctFiles.capturing(writer, (taking) => Effect.sync(() => void seen.push(taking))).pipe(
          Layer.provide(liveFiles),
        ),
      );
      yield* files.firm;
      yield* files.firm;
      yield* files.ductCatalogs;
      const [first, second, catalog] = seen;
      expect(first!.id).not.toBe(second!.id);
      const open = yield* reader(dir);
      const recorded = (bindings: ReadonlyMap<string, string>) =>
        service(DuctFiles, DuctFiles.recorded(open, bindings));
      expect(yield* problem((yield* recorded(new Map())).firm)).toBe("recording.ambiguous");
      const key = inputBindingKey(FIRM, "{}");
      expect(yield* (yield* recorded(new Map([[key, second!.id]]))).firm).toEqual(firm);
      // Another input's taking, another scope, another version: each refuses, none falls back.
      expect(yield* problem((yield* recorded(new Map([[key, catalog!.id]]))).firm)).toBe(
        "recording.mismatch",
      );
      expect(
        yield* problem(replayInput(open, FIRM, '{"other":1}', Schema.Unknown, first!.id)),
      ).toBe("recording.scope");
      const foreign = yield* writer.append(
        { input: FIRM, scope: "{}", outputVersion: "other" },
        { kind: "observed", value: firm },
      );
      expect(
        yield* problem(replayInput(yield* reader(dir), FIRM, "{}", Schema.Unknown, foreign.id)),
      ).toBe("recording.mismatch");
    }),
);

effectTest(
  "the observer sees exactly the durable taking, nothing on a full append, and its failure refuses",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, {
        maxBytes: 1_000_000,
        maxTakings: 1,
      });
      const seen: string[] = [];
      const files = yield* service(
        DuctFiles,
        DuctFiles.capturing(writer, (taking) => Effect.sync(() => void seen.push(taking.id))).pipe(
          Layer.provide(liveFiles),
        ),
      );
      yield* files.firm;
      expect(yield* files.firm).toEqual(firm);
      expect(writer.capture.truncated()).toEqual({ at: 2, stoppedAt: expect.any(Number), reason: "full" });
      expect(seen).toEqual([(yield* reader(dir)).candidates(inputIdentity(FIRM))[0]!.id]);
      const broken = new InvalidRead({
        message: "read set closed",
        status: 409,
        problem: "read-set.closed",
      });
      const other = yield* openRecordingWriter(yield* bundle, identity, bounds);
      const refusing = yield* service(
        DuctFiles,
        DuctFiles.capturing(other, () => Effect.fail(broken)).pipe(Layer.provide(liveFiles)),
      );
      expect(yield* refusing.firm).toEqual(firm);
      expect(other.capture.truncated()).toEqual({ at: 1, stoppedAt: expect.any(Number), reason: "observer" });
    }),
);

effectTest(
  "a frame keeps its own comparison time: served at 200, changed at 300, still changed at replay 10000",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const live = hostMarks({
        observedSince: 100,
        changedAt: () => 300,
        subscribe: () => () => {},
      });
      const marks = yield* service(
        HostDocumentMarks,
        HostDocumentMarks.capturing(writer).pipe(
          Layer.provide(Layer.succeed(HostDocumentMarks, live)),
        ),
      );
      const A = { session: "bridge-1", openId: "A" };
      yield* TestClock.setTime(200);
      expect(yield* marks.readFrame(A, "fans:frame-1")).toEqual({
        marks: { observedSince: 100, changedAt: 300 },
        servedAt: 200,
      });
      yield* marks.readFrame(A, "fans:frame-2", 150);
      yield* TestClock.setTime(10_000);
      const recorded = yield* service(
        HostDocumentMarks,
        HostDocumentMarks.recorded(yield* reader(dir)),
      );
      const frame = yield* recorded.readFrame(A, "fans:frame-1");
      expect(frame).toEqual({ marks: { observedSince: 100, changedAt: 300 }, servedAt: 200 });
      expect(frame.marks.changedAt! > frame.servedAt).toBe(true);
      expect((yield* recorded.readFrame(A, "fans:frame-2", 150)).servedAt).toBe(150);
      expect(yield* problem(recorded.readFrame(A, "fans:frame-2", 10_000))).toBe(
        "recording.mismatch",
      );
      // A frame never answers a bare snapshot or another frame.
      expect(yield* problem(recorded.snapshot(A))).toBe("recording.miss");
      expect(yield* problem(recorded.readFrame(A, "fans:frame-3"))).toBe("recording.miss");
    }),
);
