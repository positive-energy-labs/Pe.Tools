import { NodeServices } from "@effect/platform-node";
import { Context, Duration, Effect, Layer, Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * ADR 0029 phase 4: the one place the host starts a child. `effect/process` (4.0.2, `@stability
 * unstable`) owns the process; `@effect/platform-node`'s `NodeChildProcessSpawner` is the Node
 * backend, and on win32 its release runs `taskkill /pid <leader> /T /F` (proven by
 * `tests/spawner.test.ts` with a `cmd /c` grandchild). Node exposes no Windows Job Object, so the
 * tree is walked from the LEADER's pid, and the walk needs a live leader. So the scope kills the
 * tree first: ending stdin first let a leader that honours EOF exit 0, and the backend walks only
 * after a non-zero exit, so its grandchildren (claude.exe, codex.exe) were orphaned (Fable finding
 * 2, 2026-11-02). A leader that exits on its own before its scope closes still orphans its tree;
 * that ceiling is the missing Job Object. Nothing here shells out to `taskkill` by hand.
 */

/**
 * POSIX: SIGTERM to the process group, then SIGKILL after this grace (backend timer, not `Clock`).
 * Windows has no graceful signal for a console tree: `taskkill /T /F` is immediate.
 */
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
   * The handle's lifetime is the caller's scope AND the Spawner's: closing either kills the process
   * tree while its leader is alive (see {@link CHILD_EXIT_GRACE}). Closing is idempotent.
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
    // Finalizers run last-in first: this kill precedes the backend's release, so the leader is
    // still alive to walk from. A leader that already exited makes it a no-op.
    yield* Scope.addFinalizer(
      lifetime,
      handle.kill({ forceKillAfter: CHILD_EXIT_GRACE }).pipe(Effect.ignore),
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
