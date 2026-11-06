import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { expect } from "vite-plus/test";
import { identityCodecs } from "../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import type { IdentityId } from "../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { RecordingPointId } from "@pe/agent-contracts";
import {
  CurrentInputConsumption,
  HostInputReadSets,
  type ReadSetId,
} from "../src/input-occurrence.ts";
import {
  captureInput,
  openRecordingReader,
  openRecordingWriter,
  replayInput,
  type ConsumerRecipe,
  type HostInputLane,
  type RecordingIdentity,
} from "../src/native-recording.ts";
import {
  recordingPointKernel,
  recordingPoints,
  type AcceptedFrameEvidence,
  type VerifiedAcceptedFrame,
} from "../src/recording-points.ts";
import { InvalidRead } from "../src/native-reads.ts";
import { effectTest } from "./effect-test.ts";

const bounds = { maxBytes: 32 * 1024 * 1024, maxTakings: 4096 };
const identity = { build: "points-test", catalog: "catalog" };
const address = "C:\\models\\point.rvt";
const document = identityCodecs.document.encode({ document: address });
if (!document.ok) throw Error("invalid test document");
const doc = document.value;
const foreign = '["C:\\\\models\\\\foreign.rvt"]' as IdentityId<"document">;
const consumer = { instance: "pane-a", reading: "roster", argsHash: "args-a" };
const recipe: ConsumerRecipe = { key: "point.test", input: { fan: "F-1" }, scope: "{}" };
const row = { address, session: "session-a", openId: "open-a" };
const documentInput = {
  kind: "document",
  scope: '["document",{"openId":"open-a","session":"session-a"}]',
} as const;
const firm = { kind: "files", file: "firm" } as const;
const temporary = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "pe-points-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);
const readSets = (lane: HostInputLane) =>
  Layer.build(HostInputReadSets.layer(lane)).pipe(
    Effect.map((context) => Context.get(context, HostInputReadSets)),
  );
const problem = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(Effect.map((error) => (error as { problem?: string }).problem));
const fixture = Effect.gen(function* () {
  const dir = yield* temporary;
  const writer = yield* openRecordingWriter(dir, identity, bounds);
  const live = yield* readSets({ kind: "live", captureStore: writer });
  const roots = [];
  for (const [key, value] of [
    [recipe.key, "first"],
    [recipe.key, "second"],
    ["unique", "only"],
  ]) {
    const current = yield* live.open({ ...recipe, key }, null);
    yield* captureInput(
      writer,
      documentInput,
      documentInput.scope,
      Schema.Unknown,
      Effect.succeed(row),
    ).pipe(Effect.provideService(CurrentInputConsumption, current));
    yield* captureInput(writer, firm, "{}", Schema.String, Effect.succeed(value)).pipe(
      Effect.provideService(CurrentInputConsumption, current),
    );
    yield* current.seal;
    yield* current.close;
    roots.push(current);
  }
  const replay = yield* readSets({ kind: "recording", recordingStore: writer, at: null });
  const receipts = new Map<string, AcceptedFrameEvidence>(
    roots.map((root, index) => [
      `receipt-${index}`,
      {
        document: doc,
        readSetId: root.id,
        bodyVersion: `body-${index}`,
        identity,
        consumer: { ...consumer, instance: `pane-${index}` },
      },
    ]),
  );
  const kernel = yield* recordingPointKernel(writer, replay, {
    verify: (receipt) =>
      receipts.has(receipt)
        ? Effect.succeed(receipts.get(receipt)!)
        : Effect.fail(
            new InvalidRead({
              message: "Unknown final-body receipt",
              problem: "recording.acceptance",
              status: 409,
            }),
          ),
  });
  return { dir, writer, roots, replay, kernel, receipts };
});

effectTest(
  "points bind exact consumptions, preserve strict default selection, and survive restart and later truncation",
  () =>
    Effect.gen(function* () {
      const { dir, writer, roots, replay, kernel } = yield* fixture;
      const caps = yield* Effect.forEach([0, 1, 2], (i) => kernel.verifyAccepted(`receipt-${i}`));
      const point = yield* kernel.checkpoint(doc, { kind: "captured" }, caps);
      expect(point).not.toBeNull();
      expect(point!.takingRange).toEqual({ start: 0, end: 6 });
      expect(yield* problem(replay.open(recipe, null))).toBe("recording.ambiguous");
      expect(yield* problem(kernel.points.open(doc, point!.id, consumer, recipe))).toBe(
        "recording.ambiguous",
      );
      for (const i of [0, 1]) {
        const opened = yield* kernel.points.open(
          doc,
          point!.id,
          { ...consumer, instance: `pane-${i}` },
          recipe,
        );
        expect(opened.id).toBe(roots[i].id);
        const value = yield* replayInput(writer, firm, "{}", Schema.String).pipe(
          Effect.provideService(CurrentInputConsumption, opened),
        );
        expect(value).toBe(i === 0 ? "first" : "second");
        yield* opened.close;
      }
      const unique = yield* kernel.points.open(doc, point!.id, consumer, {
        ...recipe,
        key: "unique",
      });
      expect(unique.id).toBe(roots[2].id);
      yield* unique.close;
      expect(
        yield* problem(
          kernel.points.open(
            doc,
            point!.id,
            { ...consumer, instance: "pane-0" },
            { ...recipe, key: "unique" },
          ),
        ),
      ).toBe("recording.mismatch");
      expect(yield* problem(kernel.points.get(foreign, point!.id))).toBe("recording.scope");
      expect(
        yield* problem(kernel.points.get(doc, roots[0].id as unknown as RecordingPointId)),
      ).toBe("recording.point");
      expect(yield* problem(kernel.points.get(doc, "../../escape" as RecordingPointId))).toBe(
        "recording.point",
      );
      expect(yield* problem(kernel.verifyAccepted("forged"))).toBe("recording.acceptance");
      yield* writer.capture.stop(writer.capture.begin()!, "full");
      expect(yield* kernel.checkpoint(doc, { kind: "synced" }, caps)).toBeNull();
      const reader = yield* openRecordingReader(dir, identity, bounds);
      const restarted = recordingPoints(
        reader,
        yield* readSets({ kind: "recording", recordingStore: reader, at: null }),
      );
      expect((yield* restarted.list(doc)).map((p) => p.id)).toEqual([point!.id]);
      const saved = yield* Effect.promise(() =>
        readFile(join(dir, "read-sets", `${roots[0].id}.json`), "utf8"),
      );
      yield* Effect.promise(() =>
        writeFile(
          join(dir, "read-sets", `${roots[0].id}.json`),
          JSON.stringify({ ...JSON.parse(saved), state: "incomplete" }),
        ),
      );
      expect(yield* problem(restarted.get(doc, point!.id))).toBe("recording.context");
    }),
);

effectTest(
  "forged claim capabilities and invalid cursor/reference metadata refuse; capture failure leaves live usable",
  () =>
    Effect.gen(function* () {
      const { writer, kernel, receipts } = yield* fixture;
      const cap = yield* kernel.verifyAccepted("receipt-0");
      const point = yield* kernel.checkpoint(doc, { kind: "afterWrite", receipt: "write-1" }, [
        cap,
      ]);
      expect(point).not.toBeNull();
      for (const patch of [
        { takingRange: { start: 0, end: 1 } },
        { takingRange: { start: 0, end: 999 } },
        { bindings: [...point!.bindings, ...point!.bindings] },
        { bindings: [{ ...point!.bindings[0], readSetId: randomUUID() }] },
      ]) {
        const tampered = {
          ...writer,
          points: { ...writer.points, get: () => Effect.succeed({ ...point!, ...patch }) },
        };
        expect(
          yield* Effect.isFailure(
            recordingPoints(
              tampered,
              yield* readSets({ kind: "recording", recordingStore: writer, at: null }),
            ).get(doc, point!.id),
          ),
        ).toBe(true);
      }
      receipts.set("foreign", { ...receipts.get("receipt-0")!, document: foreign });
      expect(yield* problem(kernel.verifyAccepted("foreign"))).toBe("recording.scope");
      expect(
        yield* kernel.checkpoint(doc, { kind: "captured" }, [{} as VerifiedAcceptedFrame]),
      ).toBeNull();
      expect(writer.capture.truncated()?.reason).toBe("unsupported");
      // K4: capture is ancillary, and the live computation still returns its own value.
      expect(
        yield* captureInput(writer, firm, "{}", Schema.String, Effect.succeed("still-live")),
      ).toBe("still-live");
    }),
);

const corpus = process.env.PE_RECORDING_POINT_CORPUS;
effectTest("concurrent points reserve bundle capacity; failed metadata IO remains ancillary", () =>
  Effect.gen(function* () {
    const { dir, receipts } = yield* fixture;
    const small = { ...bounds, maxTakings: 6 };
    const writer = yield* openRecordingWriter(dir, identity, small);
    const sets = yield* readSets({ kind: "recording", recordingStore: writer, at: null });
    const kernel = yield* recordingPointKernel(writer, sets, {
      verify: () => Effect.succeed(receipts.get("receipt-0")!),
    });
    const cap = yield* kernel.verifyAccepted("host-receipt");
    const kept = yield* Effect.forEach(
      Array.from({ length: 7 }),
      () => kernel.checkpoint(doc, { kind: "captured" }, [cap]),
      { concurrency: "unbounded" },
    );
    expect(kept.filter(Boolean)).toHaveLength(6);
    expect(writer.capture.truncated()?.reason).toBe("full");
    const reader = yield* openRecordingReader(dir, identity, small);
    expect(reader.points.ids()).toHaveLength(6);
    const first = kept.find((point) => point !== null)!;
    yield* Effect.promise(() =>
      writeFile(
        join(dir, "points", `${first.id}.json`),
        JSON.stringify({ ...first, identity: { ...identity, build: "forged-build" } }),
      ),
    );
    expect(yield* problem(reader.points.get(first.id))).toBe("recording.mismatch");

    const other = yield* fixture;
    yield* Effect.promise(() => writeFile(join(other.dir, "points"), "not-a-directory"));
    const otherCap = yield* other.kernel.verifyAccepted("receipt-0");
    expect(yield* other.kernel.checkpoint(doc, { kind: "synced" }, [otherCap])).toBeNull();
    expect(other.writer.capture.truncated()?.reason).toBe("io");
    expect(
      yield* captureInput(other.writer, firm, "{}", Schema.String, Effect.succeed("live-after-io")),
    ).toBe("live-after-io");
  }),
);

effectTest(
  "a valid document observation cannot authorize a consumption under a foreign selector",
  () =>
    Effect.gen(function* () {
      const dir = yield* temporary;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const live = yield* readSets({ kind: "live", captureStore: writer });
      const current = yield* live.open(recipe, null);
      const forged = {
        kind: "document",
        scope: '["document",{"openId":"foreign-open","session":"foreign-session"}]',
      } as const;
      yield* captureInput(writer, forged, forged.scope, Schema.Unknown, Effect.succeed(row)).pipe(
        Effect.provideService(CurrentInputConsumption, current),
      );
      yield* current.seal;
      yield* current.close;
      const kernel = yield* recordingPointKernel(
        writer,
        yield* readSets({ kind: "recording", recordingStore: writer, at: null }),
        {
          verify: () =>
            Effect.succeed({
              document: doc,
              readSetId: current.id,
              identity,
              bodyVersion: "body",
              consumer,
            }),
        },
      );
      expect(yield* problem(kernel.verifyAccepted("host-receipt"))).toBe("recording.scope");
    }),
);

if (corpus)
  effectTest(
    "retained REAL corpus: exact distinct roster bindings replay their selected taking graph",
    () =>
      Effect.gen(function* () {
        const dir = yield* temporary;
        yield* Effect.promise(() => cp(corpus, dir, { recursive: true }));
        const identity: RecordingIdentity = yield* Effect.promise(async () =>
          JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")),
        );
        const writer = yield* openRecordingWriter(dir, identity, bounds);
        const sets = yield* readSets({ kind: "recording", recordingStore: writer, at: null });
        const ids = [
          "17cd7b7c-fedb-4352-b8f9-9a66b0311126",
          "c4308818-7c32-4bc4-8880-6ad3267731d1",
        ];
        const records = yield* Effect.forEach(ids, (id) => writer.readSets.get(id));
        const taking = writer.taking(
          records[0].inputs.find((entry) => entry.input.kind === "document")!.takingId,
        )!;
        const row = yield* writer.observation(taking);
        const encoded = identityCodecs.document.encode({
          document: (row as { address: string }).address,
        });
        if (!encoded.ok) return yield* Effect.die("corpus document is invalid");
        const kernel = yield* recordingPointKernel(writer, sets, {
          // Deterministic verifier stand-in proves the core, NOT actual displayed-value acceptance.
          verify: (receipt) =>
            ids.includes(receipt)
              ? Effect.succeed({
                  document: encoded.value,
                  readSetId: receipt as ReadSetId,
                  identity,
                  bodyVersion: `corpus-${receipt}`,
                  consumer: { ...consumer, instance: receipt },
                })
              : Effect.fail(
                  new InvalidRead({
                    message: "No receipt",
                    problem: "recording.acceptance",
                    status: 409,
                  }),
                ),
        });
        const caps = yield* Effect.forEach(ids, (id) => kernel.verifyAccepted(id));
        const point = yield* kernel.checkpoint(encoded.value, { kind: "captured" }, caps);
        expect(point).not.toBeNull();
        expect(yield* problem(sets.open(records[0].recipe, null))).toBe("recording.ambiguous");
        const selected: string[][] = [];
        for (const [index, id] of ids.entries()) {
          const opened = yield* kernel.points.open(
            encoded.value,
            point!.id,
            { ...consumer, instance: id },
            records[index].recipe,
          );
          expect(opened.id).toBe(id);
          const takingIds = [];
          for (const entry of records[index].inputs) {
            const attempt = opened.start(entry.input, entry.scope);
            if (attempt._tag === "Failure") return yield* Effect.fail(attempt.failure);
            takingIds.push(yield* attempt.success.selected);
            expect(takingIds.at(-1)).toBe(entry.takingId);
          }
          selected.push(takingIds);
          yield* opened.close;
        }
        expect(selected[0]).not.toEqual(selected[1]);
        expect(yield* problem(kernel.points.get(foreign, point!.id))).toBe("recording.scope");
        expect(
          yield* problem(kernel.points.get(encoded.value, randomUUID() as RecordingPointId)),
        ).toBe("recording.point");
        yield* writer.capture.stop(writer.capture.begin()!, "full");
        expect(yield* kernel.checkpoint(encoded.value, { kind: "synced" }, caps)).toBeNull();
        expect((yield* kernel.points.get(encoded.value, point!.id)).id).toBe(point!.id);
        const childId = records[0].children[0].readSetId;
        const child = yield* writer.readSets.get(childId);
        yield* Effect.promise(() =>
          writeFile(
            join(dir, "read-sets", `${childId}.json`),
            JSON.stringify({ ...child, state: "incomplete" }),
          ),
        );
        expect(yield* problem(kernel.points.get(encoded.value, point!.id))).toBe(
          "recording.context",
        );
      }),
  );
