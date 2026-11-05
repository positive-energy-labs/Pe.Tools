/**
 * Store v2 for the non-native owners (ADR 0031 rules 1, 2 and 5): files, marks and the session
 * inventory keep exactly what their live owner answered, replay it without any live owner, and
 * refuse a miss, another ref, an ambiguity, a full bundle or an older format.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { expect } from "vite-plus/test";
import type { Caller } from "@pe/agent-contracts";
import { effectTest } from "./effect-test.ts";
import { HostFiles } from "../src/host-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { InvalidRead } from "../src/native-reads.ts";
import {
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
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
const liveFiles = Layer.succeed(HostFiles, {
  firm: Effect.succeed(firm),
  ductCatalogs: Effect.succeed(catalogs),
});

effectTest("a format 1 bundle refuses explicitly and is never migrated", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const v1 = { version: 1, ...identity, coverage: { kind: "partial", inputs: ["native-read"] } };
    yield* Effect.promise(() => writeFile(join(dir, "manifest.json"), JSON.stringify(v1)));
    expect(yield* problem(reader(dir))).toBe("recording.mismatch");
    expect(yield* problem(openRecordingWriter(dir, identity, bounds))).toBe("recording.mismatch");
  }),
);

effectTest(
  "files replay the recorded fallback and findings; a missing firm refuses without disk or seed",
  () =>
    Effect.gen(function* () {
      const dir = yield* bundle;
      const writer = yield* openRecordingWriter(dir, identity, bounds);
      const files = yield* service(
        HostFiles,
        HostFiles.capturing(writer).pipe(Layer.provide(liveFiles)),
      );
      expect(yield* files.ductCatalogs).toEqual(catalogs);
      expect(writer.coverage()).toEqual(["files"]);
      const recorded = yield* service(HostFiles, HostFiles.recorded(yield* reader(dir)));
      expect(yield* recorded.ductCatalogs).toEqual(catalogs);
      expect(yield* problem(recorded.firm)).toBe("recording.miss");
      yield* files.firm;
      const again = yield* service(HostFiles, HostFiles.recorded(yield* reader(dir)));
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
    const recorded = yield* service(
      HostSessionInventory,
      HostSessionInventory.recorded(yield* reader(dir)),
    );
    expect(yield* asPea(recorded.attachment("sdk-alias"))).toEqual({ sessionId: "bridge-1" });
    const refused = yield* asPea(Effect.flip(recorded.document(ref)));
    expect(refused).toBeInstanceOf(InvalidRead);
    expect(refused).toMatchObject({ problem: "target.closed", status: 409 });
    expect(yield* asPea(problem(recorded.attachment("other")))).toBe("recording.miss");
    expect(yield* asPea(problem(recorded.session({ bridgeSessionId: "bridge-1" })))).toBe(
      "recording.miss",
    );
    expect(writer.coverage()).toEqual(["document"]);
  }),
);

effectTest("an unrebuildable failure or a full bundle keeps no taking and adds no coverage", () =>
  Effect.gen(function* () {
    const dir = yield* bundle;
    const writer = yield* openRecordingWriter(dir, identity, {
      maxBytes: 1_000_000,
      maxTakings: 1,
    });
    const broken = Layer.succeed(HostFiles, {
      firm: Effect.fail(new Error("disk") as never),
      ductCatalogs: Effect.succeed(catalogs),
    });
    const files = yield* service(
      HostFiles,
      HostFiles.capturing(writer).pipe(Layer.provide(broken)),
    );
    expect(yield* problem(files.firm)).toBe("recording.unsupported");
    expect(writer.coverage()).toEqual([]);
    yield* files.ductCatalogs;
    expect(yield* problem(files.ductCatalogs)).toBe("recording.full");
    expect(writer.coverage()).toEqual(["files"]);
    expect((yield* reader(dir)).coverage()).toEqual(["files"]);
  }),
);
