import {
  Cause,
  Clock,
  Context,
  DateTime,
  Effect,
  Layer,
  Logger,
  LogLevel,
  References,
  Schema,
} from "effect";
import type { Origin, RegisteredRun, RunRef } from "@pe/agent-contracts";

/** A run refuses this command: no run, an ended run, or a run a person stopped. */
export class RunRefused extends Schema.TaggedError<RunRefused>()("RunRefused", {
  code: Schema.Literals(["run.none", "run.closed", "run.stopped"]),
  message: Schema.String,
}) {}

const refused = (code: RunRefused["code"], message: string) =>
  new RunRefused({ code, message: `${code}: ${message}` });

type Run = { ref: RunRef; root: RunRef; state: RegisteredRun };
type CloseReason = "completed" | "failed" | "stopped" | "restart";

const key = (run: RunRef) => JSON.stringify([run.thread, run.turn]);
const makeRunRegistry = Effect.gen(function* () {
  const clock = yield* Clock.clockWith(Effect.succeed);
  const fiber = yield* Effect.withFiber(Effect.succeed);
  const loggers = yield* Logger.CurrentLoggers;
  const minimumLogLevel = yield* References.MinimumLogLevel;
  const nowIso = () => DateTime.formatIso(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe()));
  const runs = new Map<string, Run>();
  const listeners = new Set<() => void>();

  /** Synchronous state needs no Effect runner; subscribers use the owning scope's logger. */
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        if (LogLevel.isGreaterThan(minimumLogLevel, "Warn")) continue;
        for (const logger of loggers)
          logger.log({
            message: [`run notification failed: ${String(error)}`],
            logLevel: "Warn",
            cause: Cause.empty,
            fiber,
            date: new Date(clock.currentTimeMillisUnsafe()),
          });
      }
    }
  };

  const assertOpen = (origin: Origin) => {
    if (!origin.run || !origin.root)
      throw refused(
        "run.none",
        "this Pea process has no immutable turn context; invoke from a running Pea turn",
      );
    const own = runs.get(key(origin.run)),
      root = runs.get(key(origin.root));
    if (
      !own ||
      !root ||
      key(own.root) !== key(origin.root) ||
      own.state.state === "closed" ||
      root.state.state === "closed"
    )
      throw refused(
        "run.closed",
        "this turn has ended; submit a new command from the current turn",
      );
  };

  const close = (ref: RunRef, reason: CloseReason) => {
    const run = runs.get(key(ref));
    if (!run || run.state.state === "closed") return;
    run.state = { state: "closed", reason, at: nowIso() };
    notify();
  };

  const closeAll = () => {
    for (const run of [...runs.values()]) close(run.ref, "restart");
  };

  yield* Effect.addFinalizer(() => Effect.sync(closeAll));

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    open: (ref: RunRef, root: RunRef = ref) => {
      if (key(ref) !== key(root)) assertOpen({ caller: { kind: "anonymous" }, run: root, root });
      if (runs.has(key(ref))) throw refused("run.closed", "a run identity cannot be reopened");
      runs.set(key(ref), { ref, root, state: { state: "open" } });
      notify();
    },
    assertOpen,
    close,
    /** A Stop between turns: completed commands still at a checkpoint lose their run too. */
    revoke: (thread: string) => {
      for (const run of runs.values())
        if (run.ref.thread === thread && key(run.ref) === key(run.root))
          run.state = { state: "closed", reason: "stopped", at: nowIso() };
      notify();
    },
    /** A command already admitted keeps going after its turn completes; any other close ends it. */
    checkpoint: (origin: Origin) => {
      if (origin.caller.kind !== "pea") return;
      if (!origin.run || !origin.root) throw refused("run.none", "command has no causal run");
      const own = runs.get(key(origin.run)),
        root = runs.get(key(origin.root));
      if (!own || !root || key(own.root) !== key(origin.root))
        throw refused(
          "run.closed",
          "host restarted; this command's run ended, so submit it as a new action",
        );
      for (const [run, what] of [
        [root, "root"],
        [own, "turn"],
      ] as const)
        if (run.state.state === "closed" && run.state.reason !== "completed")
          throw refused("run.stopped", `${what} run stopped`);
      return;
    },
    closeAll,
  };
});

/**
 * The run registry (ADR 0038). A run is a turn's causal identity: a Pea command needs an open run
 * to start, and a Stop, a failed turn or a host restart ends the commands of its run. Nothing here
 * asks a person and nothing waits: the three guarded acts return "held" at their own doors
 * (`guards.ts`). Runs live in memory only, so a host restart closes every one.
 * Operations are synchronous so admission and Stop take effect before the caller continues.
 */
export class RunRegistry extends Context.Service<
  RunRegistry,
  Effect.Success<typeof makeRunRegistry>
>()("pe/RunRegistry") {
  static readonly layer = Layer.effect(RunRegistry, makeRunRegistry);
}
