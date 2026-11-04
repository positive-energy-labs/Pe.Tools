import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import { CaptureStore, CaptureStoreClosed } from "../src/takeoff-captures.ts";
import { effectTest } from "./effect-test.ts";

const document = { session: "s", openId: "o" };
const filter = {
  categoryNames: ["Air Terminals"],
  familyNames: [],
  placementScope: "AllLoaded" as const,
};
const work = bindWork("families", address("C:/air.rvt"), undefined, document);
const reading = {
  work,
  document,
  filter,
  capturedAt: "2026-11-02T00:00:00.000Z",
  result: { families: [], issues: [], page: null },
};

const open = (directory: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      CaptureStore.layer(directory, join(directory, "aps.json")),
      scope,
    );
    return { scope, captures: Context.get(context, CaptureStore) };
  });

effectTest("a reading survives a CaptureStore layer swap and is stamped by Clock", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "capture-store-"))),
      (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
    );
    yield* TestClock.setTime(Date.parse("2026-11-02T12:00:00.000Z"));

    const first = yield* open(directory);
    const saved = yield* Effect.promise(() => first.captures.saveFamilies(reading));
    // The stamp is the test clock's, not the machine's.
    expect(saved.completedAt).toBe("2026-11-02T12:00:00.000Z");
    yield* Scope.close(first.scope, Exit.void);

    // A second layer over the same directory holds none of the first's memory, only its files.
    const second = yield* open(directory);
    expect(second.captures).not.toBe(first.captures);
    const restored = yield* Effect.promise(() => second.captures.latestFamilies(work));
    expect(restored?.id).toBe(saved.id);
    expect(restored?.completedAt).toBe("2026-11-02T12:00:00.000Z");
    yield* Scope.close(second.scope, Exit.void);
  }),
);

effectTest(
  "a Families publish racing close completes before close returns, or is refused typed",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "capture-store-"))),
        (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      const store = yield* open(directory);
      let published = false;
      const racing = store.captures.saveFamilies(reading).then(() => (published = true));
      yield* Scope.close(store.scope, Exit.void);
      expect(published).toBe(true); // admitted before close: joined, not left to land afterwards
      yield* Effect.promise(() => racing);
      const files = yield* Effect.promise(() => readdir(join(directory, "families")));
      yield* Effect.promise(() =>
        expect(store.captures.saveFamilies(reading)).rejects.toBeInstanceOf(CaptureStoreClosed),
      );
      expect(yield* Effect.promise(() => readdir(join(directory, "families")))).toEqual(files);
    }),
);
