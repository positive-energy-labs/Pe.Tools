/**
 * Input occurrences (OCCURRENCE-CONTEXT-FREEZE): each start reserves its occurrence before any
 * await, capture binds it to the actual durable taking, and replay selects by read set + input +
 * scope + start. Completion order, equal values and first/latest never supply identity.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { expect } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";
import {
  CurrentInputConsumption,
  HostInputReadSets,
  type ConsumerRecipe,
  type InputReadSetLimits,
} from "../src/input-occurrence.ts";
import {
  captureInput,
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
  replayInput,
  type HostInputLane,
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
