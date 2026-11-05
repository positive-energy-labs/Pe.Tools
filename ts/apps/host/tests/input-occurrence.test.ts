/**
 * Input occurrences (OCCURRENCE-CONTEXT-FREEZE): each start reserves its occurrence before any
 * await, capture binds it to the actual durable taking, and replay selects by read set + input +
 * scope + start. Completion order, equal values and first/latest never supply identity.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Context, Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import { expect } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";
import {
  CurrentInputConsumption,
  HostInputReadSets,
  type ConsumerRecipe,
  type InputReadSetLimits,
  type ReadSetId,
} from "../src/input-occurrence.ts";
import {
  captureInput,
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
  replayInput,
  type HostInputLane,
  type InputReadSetRecord,
  type Taking,
} from "../src/native-recording.ts";

const identity = { build: "build-1", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
const FIRM = { kind: "files", file: "firm" } as const;
const recipe: ConsumerRecipe = {
  key: "ducts.sheet",
  input: { fan: "F-1" },
  scope: '["bridge-1","A"]',
};
const codec = Schema.Unknown;
const bundle = Effect.promise(() => mkdtemp(join(tmpdir(), "pe-occurrence-")));
const readSets = (lane: HostInputLane, limits?: InputReadSetLimits) =>
  Effect.map(Layer.build(HostInputReadSets.layer(lane, limits)), (context) =>
    Context.get(context, HostInputReadSets),
  );
const problem = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(Effect.map((error) => (error as { problem?: string }).problem));

effectTest(
  "reverse completion keeps start-assigned occurrences; replay serves each its own taking",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const live = yield* readSets({ kind: "live", captureStore: writer });
      const consumption = yield* live.open(recipe, null);
      const first = yield* Deferred.make<string>();
      const second = yield* Deferred.make<string>();
      const read = (gate: Deferred.Deferred<string>) =>
        captureInput(writer, FIRM, "{}", codec, Deferred.await(gate)).pipe(
          Effect.provideService(CurrentInputConsumption, consumption),
        );
      const a = yield* Effect.forkChild(read(first));
      const b = yield* Effect.forkChild(read(second));
      yield* Effect.yieldNow;
      // The second start completes and appends first.
      yield* Deferred.succeed(second, "firm-second");
      expect(yield* Fiber.join(b)).toBe("firm-second");
      yield* Deferred.succeed(first, "firm-first");
      expect(yield* Fiber.join(a)).toBe("firm-first");
      yield* consumption.seal;
      yield* consumption.close;

      const reader = yield* openRecordingReader(dir, identity, bounds);
      const historical = yield* readSets({ kind: "recording", recordingStore: reader, at: null });
      const replayed = yield* historical.open(recipe, consumption.id);
      const again = (effect: Effect.Effect<unknown, unknown>) =>
        effect.pipe(Effect.provideService(CurrentInputConsumption, replayed));
      expect(yield* again(replayInput(reader, FIRM, "{}", codec))).toBe("firm-first");
      expect(yield* again(replayInput(reader, FIRM, "{}", codec))).toBe("firm-second");
      // A third occurrence was never read by this consumer.
      expect(yield* problem(again(replayInput(reader, FIRM, "{}", codec)))).toBe("recording.miss");
    }),
);

effectTest(
  "identical inputs in two consumers never cross-bind; missing or incomplete context refuses",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const live = yield* readSets({ kind: "live", captureStore: writer });
      const human = yield* live.open(recipe, null);
      const pea = yield* live.open(recipe, null);
      yield* captureInput(writer, FIRM, "{}", codec, Effect.succeed("pea")).pipe(
        Effect.provideService(CurrentInputConsumption, pea),
      );
      yield* captureInput(writer, FIRM, "{}", codec, Effect.succeed("human")).pipe(
        Effect.provideService(CurrentInputConsumption, human),
      );
      yield* human.seal;
      yield* pea.seal;
      const unsealed = yield* live.open(recipe, null);
      const reader = yield* openRecordingReader(dir, identity, bounds);
      const historical = yield* readSets({ kind: "recording", recordingStore: reader, at: null });
      for (const [consumer, value] of [
        [human, "human"],
        [pea, "pea"],
      ] as const) {
        const replayed = yield* historical.open(recipe, consumer.id);
        expect(
          yield* replayInput(reader, FIRM, "{}", codec).pipe(
            Effect.provideService(CurrentInputConsumption, replayed),
          ),
        ).toBe(value);
      }
      expect(yield* problem(historical.open(recipe, null))).toBe("recording.context");
      expect(yield* problem(historical.open(recipe, unsealed.id))).toBe("recording.context");
      expect(yield* problem(historical.open({ ...recipe, key: "ducts.roster" }, human.id))).toBe(
        "recording.mismatch",
      );
    }),
);

effectTest("live context loss truncates capture and keeps the live answer unchanged", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const writer = yield* openRecordingWriter(dir, identity, bounds);
    const live = yield* readSets(
      { kind: "live", captureStore: writer },
      {
        openRoots: 4,
        childrenPerRoot: 4,
        startsPerRoot: 1,
        metadataBytesPerRoot: 65_536,
        dependencyDepth: 4,
      },
    );
    const consumption = yield* live.open(recipe, null);
    const read = (value: string) =>
      captureInput(writer, FIRM, "{}", codec, Effect.succeed(value)).pipe(
        Effect.provideService(CurrentInputConsumption, consumption),
      );
    expect(yield* read("one")).toBe("one");
    expect(yield* read("two")).toBe("two");
    expect(writer.capture.truncated()).toEqual({ at: 2, reason: "unsupported" });
    yield* consumption.seal;
    // A truncated capture never publishes a complete read set.
    const reader = yield* openRecordingReader(dir, identity, bounds);
    expect(yield* problem(reader.readSets.get(consumption.id))).toBe("recording.context");
  }),
);

const child = (key: string): ConsumerRecipe => ({ key, input: {}, scope: "{}" });
const ok = <A>(result: Result.Result<A, unknown>) => {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};
const failed = (result: Result.Result<unknown, unknown>) =>
  Result.isFailure(result) ? (result.failure as { problem?: string }).problem : "ok";

effectTest("closing a child closes only that child; closing the root closes the tree", () =>
  Effect.gen(function* () {
    const writer = yield* openRecordingWriter(yield* bundle, identity, bounds);
    const live = yield* readSets({ kind: "live", captureStore: writer });
    const root = yield* live.open(recipe, null);
    const a = ok(root.child(child("ducts.retained")));
    const b = ok(root.child(child("ducts.retained")));
    yield* a.close;
    expect(failed(a.start(FIRM, "{}"))).toBe("recording.context");
    expect(failed(b.start(FIRM, "{}"))).toBe("ok");
    expect(failed(root.start(FIRM, "{}"))).toBe("ok");
    yield* root.close;
    expect(failed(b.start(FIRM, "{}"))).toBe("recording.context");
    expect(failed(root.child(child("ducts.retained")))).toBe("recording.context");
  }),
);

effectTest("no mutation after seal or close, and a dependency never rebinds", () =>
  Effect.gen(function* () {
    const writer = yield* openRecordingWriter(yield* bundle, identity, bounds);
    const live = yield* readSets({ kind: "live", captureStore: writer });
    const root = yield* live.open(recipe, null);
    const attempt = ok(root.start(FIRM, "{}"));
    const first = randomUUID() as ReadSetId;
    yield* root.linkReadSet("overview", first);
    expect(yield* problem(root.linkReadSet("overview", randomUUID() as ReadSetId))).toBe(
      "recording.ambiguous",
    );
    yield* root.linkReadSet("overview", first);
    yield* root.seal;
    const late = { id: "late", input: FIRM, scope: "{}" } as unknown as Taking;
    expect(yield* problem(attempt.observed(late))).toBe("recording.context");
    expect(yield* problem(root.linkTaking("native", "t1"))).toBe("recording.context");
    expect(yield* problem(root.linkReadSet("other", first))).toBe("recording.context");
    expect(yield* problem(root.exportBasis("basis"))).toBe("recording.context");
    expect(failed(root.start(FIRM, "{}"))).toBe("recording.context");
    const closed = yield* live.open(recipe, null);
    yield* closed.close;
    expect(yield* problem(closed.linkTaking("native", "t1"))).toBe("recording.context");
  }),
);

const record = (
  fields: Partial<InputReadSetRecord> & { id: string; recipe: ConsumerRecipe },
): InputReadSetRecord => ({
  version: 1,
  identity,
  state: "complete",
  inputs: [],
  children: [],
  takingLinks: {},
  dependencies: {},
  exports: [],
  ...fields,
});

effectTest(
  "replay refuses duplicate exact child occurrences and bounds the whole loaded graph",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const leaf = record({ id: randomUUID(), recipe: child("ducts.retained") });
      const other = record({ id: randomUUID(), recipe: child("ducts.retained") });
      yield* writer.readSets.keep(leaf);
      yield* writer.readSets.keep(other);
      const duplicate = record({
        id: randomUUID(),
        recipe,
        children: [
          { recipe: child("ducts.retained"), start: 0, readSetId: leaf.id },
          { recipe: child("ducts.retained"), start: 0, readSetId: other.id },
        ],
      });
      const wide = record({
        id: randomUUID(),
        recipe,
        children: [{ recipe: child("ducts.retained"), start: 0, readSetId: leaf.id }],
        dependencies: { overview: other.id },
      });
      yield* writer.readSets.keep(duplicate);
      yield* writer.readSets.keep(wide);
      const reader = yield* openRecordingReader(dir, identity, bounds);
      const lane = { kind: "recording", recordingStore: reader, at: null } as const;
      const historical = yield* readSets(lane);
      expect(yield* problem(historical.open(recipe, duplicate.id as ReadSetId))).toBe(
        "recording.ambiguous",
      );
      yield* historical.open(recipe, wide.id as ReadSetId);
      // A child and a dependency are two loaded nodes beyond the root: one allowed node refuses.
      const narrow = yield* readSets(lane, { ...limits, childrenPerRoot: 1 });
      expect(yield* problem(narrow.open(recipe, wide.id as ReadSetId))).toBe("recording.full");
      const small = yield* readSets(lane, { ...limits, metadataBytesPerRoot: 400 });
      expect(yield* problem(small.open(recipe, wide.id as ReadSetId))).toBe("recording.full");
    }),
);
const limits: InputReadSetLimits = {
  openRoots: 4,
  childrenPerRoot: 8,
  startsPerRoot: 8,
  metadataBytesPerRoot: 65_536,
  dependencyDepth: 4,
};
