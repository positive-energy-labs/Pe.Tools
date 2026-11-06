import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { expect, vi } from "vite-plus/test";
import {
  address,
  bindWork,
  type RecordingPointId,
  type RecordingConsumer,
} from "@pe/agent-contracts";
import { identityCodecs } from "../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import {
  CurrentInputConsumption,
  HostInputReadSets,
  type InputConsumption,
} from "../src/input-occurrence.ts";
import {
  captureInput,
  replayInput,
  openRecordingReader,
  openRecordingWriter,
  type ConsumerRecipe,
  type HostInputLane,
  type RecordingWriter,
  type RecordingReader,
} from "../src/native-recording.ts";
import { recordingPoints } from "../src/recording-points.ts";
import { workInput, workInputScope, workInputCodecs } from "../src/work-inputs.ts";
import { effectTest } from "./effect-test.ts";

const identity = { build: "point-body-selection", catalog: "catalog" };
const bounds = { maxBytes: 32 * 1024 * 1024, maxTakings: 4096 };
const ref = { session: "point-session", openId: "point-open" };
const path = address("C:/Models/point.rvt");
const documentId = (document: string) => {
  const decoded = identityCodecs.document.encode({ document });
  if (!decoded.ok) throw Error("Invalid test document");
  return decoded.value;
};
const doc = documentId(path),
  foreign = documentId("C:/Models/foreign.rvt");
const consumer = (instance: string): RecordingConsumer => ({
  instance,
  reading: "main",
  argsHash: "same-args",
});
const recipe: ConsumerRecipe = { key: "native.call", input: { selector: "roster" }, scope: "{}" };
const workRecipe: ConsumerRecipe = { key: "resource.frame", input: { kind: "work" }, scope: "{}" };
const scope = JSON.stringify({ bridgeSessionId: ref.session, openDocumentId: ref.openId });
const nativeInput = { kind: "native", key: "test.native", args: "{}" } as const;
const temporary = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "pe-point-bodies-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);
const readSets = (lane: HostInputLane) =>
  Layer.build(HostInputReadSets.layer(lane)).pipe(
    Effect.map((context) => Context.get(context, HostInputReadSets)),
  );
const problem = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(Effect.map((error) => (error as { problem: string }).problem));
const nativeBody = (
  writer: RecordingWriter,
  live: HostInputReadSets["Service"],
  id: string,
  bodyRecipe = recipe,
) =>
  Effect.gen(function* () {
    const root = yield* live.open(bodyRecipe, null);
    const selector = JSON.stringify(["document", { openId: ref.openId, session: ref.session }]);
    yield* captureInput(
      writer,
      { kind: "document", scope: selector },
      selector,
      Schema.Unknown,
      Effect.succeed({ ...ref, address: path }),
    ).pipe(Effect.provideService(CurrentInputConsumption, root));
    const attempt = root.start(nativeInput, scope);
    if (Result.isFailure(attempt)) return yield* Effect.fail(attempt.failure);
    const taking = yield* writer.append(
      { input: nativeInput, scope, outputVersion: "test-schema" },
      {
        kind: "answered",
        value: { id },
        answer: {
          nativeRequestId: id,
          actualTarget: {
            processIncarnation: { pid: 42, startedAt: 1 },
            openDocumentLifetime: { openId: ref.openId },
          },
          freshness: { freshnessGeneration: "g1" },
          cost: {},
          nativeOutcome: "committed",
        },
      },
    );
    yield* attempt.success.observed(taking);
    yield* root.seal;
    yield* root.close;
    return root.id;
  });
const fixture = Effect.gen(function* () {
  const dir = yield* temporary;
  const writer = yield* openRecordingWriter(dir, identity, bounds);
  const live = yield* readSets({ kind: "live", captureStore: writer });
  const a = yield* nativeBody(writer, live, "native-A"),
    b = yield* nativeBody(writer, live, "native-B");
  const key = bindWork("test", path, undefined, ref),
    work = yield* live.open(workRecipe, null);
  const workValue = { doc: { count: 7 }, revision: 1, handle: { key, revision: 1 } };
  yield* captureInput(
    writer,
    workInput(key, "raw"),
    workInputScope(key),
    workInputCodecs.raw,
    Effect.succeed(workValue),
  ).pipe(Effect.provideService(CurrentInputConsumption, work));
  yield* work.seal;
  yield* work.close;
  const container = yield* live.open(
    { key: "resource.frame", input: { kind: "composed" }, scope: "{}" },
    null,
  );
  yield* container.linkReadSet("native", a);
  yield* container.linkReadSet("work", work.id);
  yield* container.seal;
  yield* container.close;
  const second = yield* live.open({ key: "point.fixture", input: null, scope: "{}" }, null);
  yield* second.linkReadSet("native", b);
  yield* second.linkReadSet("work", work.id);
  yield* second.seal;
  yield* second.close;
  const point = {
    version: 1 as const, id: randomUUID() as RecordingPointId, document: doc,
    reason: { kind: "captured" as const }, at: 1, identity,
    takingRange: { start: 0, end: writer.takingCursor() },
    bindings: [ { ...consumer("A"), readSetId: container.id }, { ...consumer("B"), readSetId: second.id } ],
  };
  yield* writer.points.keep(point);
  const outsideRecipe = { ...recipe, input: { selector: "outside" } };
  const outside = yield* nativeBody(writer, live, "outside", outsideRecipe);
  // Capture is over. All selection below reopens durable read-only stores, with no live inputs.
  const reader = yield* openRecordingReader(dir, identity, bounds);
  const replay = yield* readSets({ kind: "recording", recordingStore: reader, at: null });
  return {
    dir,
    writer,
    reader,
    replay,
    points: recordingPoints(reader, replay),
    point,
    a,
    b,
    work: work.id,
    outside,
    outsideRecipe,
  };
});
const selectedNative = (reader: RecordingReader, current: InputConsumption) =>
  Effect.gen(function* () {
    const attempt = current.start(nativeInput, scope);
    if (Result.isFailure(attempt)) return yield* Effect.fail(attempt.failure);
    const taking = reader.taking(yield* attempt.success.selected)!;
    expect(taking.outcome.kind).toBe("answered");
    return taking.outcome.kind === "answered" ? taking.outcome.nativeRequestId : "refused";
  });

effectTest(
  "point bindings reopen the exact A/B recipe without live inputs",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(yield* problem(f.replay.open(recipe, null))).toBe("recording.ambiguous");
      const acquire = HostInputReadSets.layer.bind(HostInputReadSets);
      const noLive = vi.spyOn(HostInputReadSets, "layer").mockImplementation((lane, limits) => {
        if (lane.kind !== "recording") throw Error("Replay acquired a live input factory");
        return acquire(lane, limits);
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => noLive.mockRestore()));
      for (const [instance, expected] of [
        ["A", f.a],
        ["B", f.b],
      ]) {
        const current = yield* f.points.open(doc, f.point.id, consumer(instance), recipe);
        expect(current.id).toBe(expected);
        expect(yield* selectedNative(f.reader, current)).toBe(`native-${instance}`);
        yield* current.close;
        const work = yield* f.points.open(doc, f.point.id, consumer(instance), workRecipe);
        expect(work.id).toBe(f.work);
        const key = bindWork("test", path, undefined, ref);
        const value = yield* replayInput(
          f.reader,
          workInput(key, "raw"),
          workInputScope(key),
          workInputCodecs.raw,
        ).pipe(Effect.provideService(CurrentInputConsumption, work));
        expect(value?.doc).toEqual({ count: 7 });
        yield* work.close;
      }
      expect(
        yield* problem(f.points.open(doc, f.point.id, consumer("missing"), f.outsideRecipe)),
      ).toBe("recording.miss");
      expect(yield* problem(f.points.open(doc, f.point.id, consumer("A"), f.outsideRecipe))).toBe(
        "recording.miss",
      );
      expect(
        yield* problem(
          f.points.open(doc, f.point.id, consumer("A"), { ...recipe, scope: "foreign" }),
        ),
      ).toBe("recording.miss");
      expect(yield* problem(f.points.open(foreign, f.point.id, consumer("A"), recipe))).toBe(
        "recording.scope",
      );
      expect(
        yield* problem(f.points.open(doc, randomUUID() as RecordingPointId, consumer("A"), recipe)),
      ).toBe("recording.point");
      // A late incomplete OTHER body still invalidates the whole bound graph, not just that selection.
      const record = yield* f.reader.readSets.get(f.work);
      yield* Effect.promise(() =>
        writeFile(
          join(f.dir, "read-sets", `${f.work}.json`),
          JSON.stringify({ ...record, state: "incomplete" }),
        ),
      );
      expect(yield* problem(f.points.open(doc, f.point.id, consumer("A"), recipe))).toBe(
        "recording.context",
      );
    }),
);

effectTest(
  "corrupt graph metadata and distinct same-recipe ids refuse instead of selecting a preference",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const binding = f.point.bindings.find((binding) => binding.instance === "B")!;
      const file = join(f.dir, "read-sets", `${binding.readSetId}.json`),
        aggregate = yield* f.reader.readSets.get(binding.readSetId);
      for (const changed of [
        { ...aggregate, identity: { ...identity, catalog: "foreign" } },
        { ...aggregate, dependencies: { ...aggregate.dependencies, cycle: aggregate.id } },
      ]) {
        yield* Effect.promise(() => writeFile(file, JSON.stringify(changed)));
        expect(yield* problem(f.points.open(doc, f.point.id, consumer("B"), recipe))).toBe(
          "recording.mismatch",
        );
      }
      yield* Effect.promise(() =>
        writeFile(
          file,
          JSON.stringify({
            ...aggregate,
            dependencies: { ...aggregate.dependencies, another: f.a },
          }),
        ),
      );
      expect(yield* problem(f.points.open(doc, f.point.id, consumer("B"), recipe))).toBe(
        "recording.ambiguous",
      );
      yield* Effect.promise(() => writeFile(file, JSON.stringify(aggregate)));
      const pointFile = join(f.dir, "points", `${f.point.id}.json`);
      for (const changed of [
        { ...f.point, takingRange: { ...f.point.takingRange, start: f.point.takingRange.end } },
        { ...f.point, identity: { ...identity, build: "foreign" } },
      ]) {
        yield* Effect.promise(() => writeFile(pointFile, JSON.stringify(changed)));
        expect(yield* problem(f.points.open(doc, f.point.id, consumer("B"), recipe))).toBe(
          "recording.mismatch",
        );
      }
    }),
);

effectTest("K4 keeps valid durable point bindings readable after truncation", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.writer.capture.stop(f.writer.capture.begin()!, "full");
    expect(f.writer.points.ids()).toHaveLength(1);
    const reader = yield* openRecordingReader(f.dir, identity, bounds),
      points = recordingPoints(
        reader,
        yield* readSets({ kind: "recording", recordingStore: reader, at: null }),
      );
    const current = yield* points.open(doc, f.point.id, consumer("A"), recipe);
    expect(yield* selectedNative(reader, current)).toBe("native-A");
    yield* current.close;
  }),
);

const corpus = process.env.PE_RECORDING_POINT_CORPUS;
if (corpus)
  effectTest("REAL retained corpus duplicates reopen through exact durable point bindings", () =>
    Effect.gen(function* () {
      const dir = yield* temporary;
      yield* Effect.promise(() => cp(corpus, dir, { recursive: true }));
      const manifest = yield* Effect.promise(async () => JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")));
      const writer = yield* openRecordingWriter(dir, manifest, bounds);
      const ids = ["17cd7b7c-fedb-4352-b8f9-9a66b0311126", "c4308818-7c32-4bc4-8880-6ad3267731d1"];
      const record = yield* writer.readSets.get(ids[0]!);
      const taking = writer.taking(record.inputs.find((input) => input.input.kind === "document")!.takingId)!;
      const value = yield* writer.observation(taking);
      const document = documentId((value as { address: string }).address);
      const point = {
        version: 1 as const, id: randomUUID() as RecordingPointId, document,
        reason: { kind: "captured" as const }, at: 1, identity: writer.identity,
        takingRange: { start: 0, end: writer.takingCursor() },
        bindings: ids.map((readSetId, index) => ({ ...consumer(String(index)), readSetId })),
      };
      yield* writer.points.keep(point);
      const reader = yield* openRecordingReader(dir, manifest, bounds);
      const replay = yield* readSets({ kind: "recording", recordingStore: reader, at: null });
      expect(yield* problem(replay.open(record.recipe, null))).toBe("recording.ambiguous");
      for (const [index, id] of ids.entries()) {
        const current = yield* recordingPoints(reader, replay).open(document, point.id, consumer(String(index)), record.recipe);
        expect(current.id).toBe(id);
        yield* current.close;
      }
    }),
  );
