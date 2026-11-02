import { Effect, Logger, References, Scope } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vite-plus/test";

/**
 * `it.effect` for this repo: one fiber per test under a `TestClock`. `@effect/vitest` 4.0.x peers
 * on vitest 5 while vite-plus 0.2.1 runs vitest 4.1.9, so the runner edge lives here until the
 * toolchain moves; the shape matches `it.effect` so a later swap is a rename.
 */
export const effectTest = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Scope.Scope>,
  timeout?: number,
) =>
  test(
    name,
    () =>
      // effect-edge: test runner (the it.effect seam; @effect/vitest needs vitest 5)
      Effect.runPromise(
        Effect.suspend(body).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
      ),
    timeout,
  );

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
