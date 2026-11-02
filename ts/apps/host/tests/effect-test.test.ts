import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";

// The runner owns the root fiber: a test that times out is interrupted, and its scope's
// finalizers have run before the next test starts.
const probe = { finalized: false, ticking: false };

effectTest.fails(
  "effectTest: a timed-out test is interrupted (deliberate timeout)",
  () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => (probe.finalized = true)));
      yield* Effect.forkScoped(
        Effect.forever(Effect.sync(() => (probe.ticking = true)).pipe(Effect.andThen(Effect.yieldNow))),
      );
      yield* Effect.never;
    }),
  200,
);

effectTest("effectTest: the timed-out test left nothing running", () =>
  Effect.gen(function* () {
    expect(probe.finalized).toBe(true);
    probe.ticking = false;
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(probe.ticking).toBe(false);
  }),
);
