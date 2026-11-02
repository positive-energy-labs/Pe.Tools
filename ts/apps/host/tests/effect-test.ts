import { NodeCrypto } from "@effect/platform-node";
import { Cause, Context, Effect, Exit, Layer, Logger, References, Scope } from "effect";
import { TestClock } from "effect/testing";
import { onTestFinished, test, type TestContext } from "vite-plus/test";
import {
  RunConsents,
  runConsentsPromise,
  type ConsentSink,
  type RunConsentsPromise,
} from "../src/run-consent.ts";

const runRoot =
  <A, E>(body: () => Effect.Effect<A, E, Scope.Scope>) =>
  (context: TestContext) => {
    // The it.effect seam; @effect/vitest needs vitest 5.
    // effect-edge: test-runner
    const root = Effect.runFork(
      Effect.suspend(body).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
      { signal: context.signal },
    );
    // The runner owns the root: a timeout, a cancel or a failed assertion elsewhere interrupts it,
    // and the test does not finish until its scope's finalizers have run.
    context.onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          root.interruptUnsafe();
          root.addObserver(() => resolve());
        }),
    );
    return new Promise<void>((resolve, reject) =>
      root.addObserver((exit) =>
        Exit.isSuccess(exit) ? resolve() : reject(Cause.squash(exit.cause)),
      ),
    );
  };

/**
 * `it.effect` for this repo: one root fiber per test under a `TestClock`, owned by the runner.
 * `@effect/vitest` 4.0.x peers on vitest 5 while vite-plus 0.2.1 runs vitest 4.1.9, so the runner
 * edge lives here until the toolchain moves; the shape matches `it.effect` so a later swap is a
 * rename.
 */
export const effectTest = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Scope.Scope>,
  timeout?: number,
) => test(name, runRoot(body), timeout);
/** A test expected to fail (a deliberate timeout probe included). */
effectTest.fails = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Scope.Scope>,
  timeout?: number,
) => test.fails(name, runRoot(body), timeout);

/** Log lines the effect under test wrote, as `message` plus annotations. */
export const captureLogs = () => {
  const lines: { message: unknown; annotations: Record<string, unknown> }[] = [];
  const layer = Logger.layer([
    Logger.make((options) => {
      lines.push({
        message: options.message,
        annotations: { ...options.fiber.getRef(References.CurrentLogAnnotations) },
      });
    }),
  ]);
  return { lines, layer };
};

/**
 * {@link RunConsents} for Promise tests: the live layer, built in a scope the running test closes
 * (a module-level fixture's scope lives with its worker). Closing it interrupts open windows.
 */
export const consentService = (): RunConsents["Service"] => {
  const scope = Scope.makeUnsafe();
  // effect-edge: test-runner
  const context = Effect.runSync(
    Layer.buildWithScope(RunConsents.layer.pipe(Layer.provide(NodeCrypto.layer)), scope),
  );
  try {
    // effect-edge: test-runner
    onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  } catch {
    // Outside a running test: a module fixture, closed with its worker.
  }
  return Context.get(context, RunConsents);
};

/** The Promise face with a transcript sink attached; persist defaults to a no-op, auto-approve on. */
export const testConsents = (
  emit: ConsentSink["emit"],
  sink: Partial<Omit<ConsentSink, "emit">> = {},
): RunConsentsPromise => {
  const runs = runConsentsPromise(consentService());
  runs.attach({ emit, persist: () => {}, autoApprove: () => true, ...sink });
  return runs;
};
