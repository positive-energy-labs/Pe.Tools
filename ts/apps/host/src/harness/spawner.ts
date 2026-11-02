import { NodeServices } from "@effect/platform-node";
import { Context, Duration, Effect, Layer, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * ADR 0029 phase 4: the one place the host starts a child. `effect/process` (4.0.2, `@stability
 * unstable`) owns the process; `@effect/platform-node`'s `NodeChildProcessSpawner` is the Node
 * backend, and on win32 its release runs `taskkill /pid <leader> /T /F` (proven by
 * `tests/spawner.test.ts` with a `cmd /c` grandchild). Node exposes no Windows Job Object, so the
 * tree is walked from the leader's pid: a child that already exited normally has no leader left to
 * walk from, and its orphans are not reached. Nothing here shells out to `taskkill` by hand.
 */

/** How long a child gets to exit on its own after its stdin ends, before its scope kills the tree. */
export const CHILD_EXIT_GRACE = Duration.seconds(2);

/** Exactly what the child receives: `env` is the whole environment, never merged with the host's. */
export interface ChildLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const make = Effect.gen(function* () {
  const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
  const owner = yield* Scope.Scope;

  /**
   * The handle's lifetime is the caller's scope AND the Spawner's: closing either ends stdin, waits
   * {@link CHILD_EXIT_GRACE}, then kills the process tree. Closing is idempotent.
   */
  const spawn = Effect.fn("Spawner.spawn")(function* (launch: ChildLaunch) {
    const caller = yield* Scope.Scope;
    const lifetime = yield* Scope.fork(owner);
    yield* Scope.addFinalizerExit(caller, (exit) => Scope.close(lifetime, exit));
    const handle = yield* processes
      .spawn(
        ChildProcess.make(launch.command, [...launch.args], {
          cwd: launch.cwd,
          env: launch.env,
          extendEnv: false,
        }),
      )
      .pipe(Scope.provide(lifetime));
    // Finalizers run last-in first: this one precedes the module's tree kill.
    yield* Scope.addFinalizer(
      lifetime,
      Stream.run(Stream.empty, handle.stdin).pipe(
        Effect.andThen(handle.exitCode),
        Effect.timeout(CHILD_EXIT_GRACE),
        Effect.ignore,
      ),
    );
    return handle;
  });
  return { spawn };
});

/** Children started through `spawn` die with their scope, or with the Spawner's. */
export class Spawner extends Context.Service<Spawner, Effect.Success<typeof make>>()("pe/Spawner") {
  /** Scoped: closing the layer's scope closes every child still open. Needs a process backend. */
  static readonly layer = Layer.effect(Spawner, make);
  static readonly live = Spawner.layer.pipe(Layer.provide(NodeServices.layer));
}
