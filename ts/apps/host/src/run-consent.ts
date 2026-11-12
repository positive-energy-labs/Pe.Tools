import { Cause, Context, DateTime, Effect, Exit, Layer, Option, Schema } from "effect";
import type { Origin, RunConsent, RunRef } from "@pe/agent-contracts";

/** A run refuses this command: no run, an ended run, or a run a person stopped. */
export class ConsentRefused extends Schema.TaggedError<ConsentRefused>()("ConsentRefused", {
  code: Schema.Literals(["run.none", "run.closed", "run.stopped"]),
  message: Schema.String,
}) {}

const refused = (code: ConsentRefused["code"], message: string) =>
  new ConsentRefused({ code, message: `${code}: ${message}` });

type Run = { ref: RunRef; root: RunRef; state: RunConsent };
type CloseReason = "completed" | "failed" | "stopped" | "restart";

const key = (run: RunRef) => JSON.stringify([run.thread, run.turn]);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const makeRunConsents = Effect.gen(function* () {
  const runs = new Map<string, Run>();
  const listeners = new Set<() => void>();

  /** Notification is isolated: a throwing subscriber is logged, never decides a close. */
  const notify = Effect.suspend(() =>
    Effect.forEach(
      [...listeners],
      (listener) =>
        Effect.try(listener).pipe(
          Effect.catch((error) => Effect.logWarning(`run notification failed: ${String(error.cause)}`)),
        ),
      { discard: true },
    ),
  );

  const assertOpen = (origin: Origin) =>
    Effect.suspend(() => {
      if (!origin.run || !origin.root)
        return Effect.fail(
          refused(
            "run.none",
            "this Pea process has no immutable turn context; invoke from a running Pea turn",
          ),
        );
      const own = runs.get(key(origin.run)),
        root = runs.get(key(origin.root));
      return !own ||
        !root ||
        key(own.root) !== key(origin.root) ||
        own.state.state === "closed" ||
        root.state.state === "closed"
        ? Effect.fail(
            refused("run.closed", "this turn has ended; submit a new command from the current turn"),
          )
        : Effect.void;
    });

  const close = Effect.fn("run.close")(function* (ref: RunRef, reason: CloseReason) {
    const run = runs.get(key(ref));
    if (!run || run.state.state === "closed") return;
    run.state = { state: "closed", reason, at: yield* nowIso };
    yield* notify;
  });

  const closeAll = Effect.suspend(() =>
    Effect.forEach([...runs.values()], (run) => close(run.ref, "restart"), { discard: true }),
  );

  yield* Effect.addFinalizer(() => closeAll);

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    open: Effect.fn("run.open")(function* (ref: RunRef, root: RunRef = ref) {
      if (key(ref) !== key(root))
        yield* assertOpen({ caller: { kind: "anonymous" }, run: root, root });
      if (runs.has(key(ref)))
        return yield* refused("run.closed", "a run identity cannot be reopened");
      runs.set(key(ref), { ref, root, state: { state: "open" } });
      yield* notify;
    }),
    assertOpen,
    close,
    /** A Stop between turns: completed commands still at a checkpoint lose their run too. */
    revoke: Effect.fn("run.revoke")(function* (thread: string) {
      for (const run of runs.values())
        if (run.ref.thread === thread && key(run.ref) === key(run.root))
          run.state = { state: "closed", reason: "stopped", at: yield* nowIso };
      yield* notify;
    }),
    /** A command already admitted keeps going after its turn completes; any other close ends it. */
    checkpoint: (origin: Origin) =>
      Effect.suspend(() => {
        if (origin.caller.kind !== "pea") return Effect.void;
        if (!origin.run || !origin.root)
          return Effect.fail(refused("run.none", "command has no causal run"));
        const own = runs.get(key(origin.run)),
          root = runs.get(key(origin.root));
        if (!own || !root || key(own.root) !== key(origin.root))
          return Effect.fail(
            refused("run.closed", "host restarted; old commands require explicit recovery"),
          );
        for (const [run, what] of [
          [root, "root"],
          [own, "turn"],
        ] as const)
          if (run.state.state === "closed" && run.state.reason !== "completed")
            return Effect.fail(refused("run.stopped", `${what} run stopped`));
        return Effect.void;
      }),
    closeAll,
  };
});

/**
 * The run registry (ADR 0038). A run is a turn's causal identity: a Pea command needs an open run
 * to start, and a Stop, a failed turn or a host restart ends the commands of its run. Nothing here
 * asks a person and nothing waits: the three guarded acts return "held" at their own doors
 * (`guards.ts`). Runs live in memory only, so a host restart closes every one. The name is kept:
 * splitting the registry out of the old consent service is deliberately unbuilt (homes MAP).
 */
export class RunConsents extends Context.Service<
  RunConsents,
  Effect.Success<typeof makeRunConsents>
>()("pe/RunConsents") {
  static readonly layer = Layer.effect(RunConsents, makeRunConsents);
}

/**
 * The Promise face of {@link RunConsents} for the thread store, control and the journal, which
 * are Promise code until phase 5. Every operation settles synchronously; a refusal is thrown as
 * its tagged value.
 */
export const runConsentsPromise = (consents: RunConsents["Service"]) => {
  const now = <A, E>(effect: Effect.Effect<A, E>): A => {
    // effect-edge: island, phase 5
    const exit = Effect.runFork(effect).pollUnsafe();
    if (!exit) throw Error("run registry operation suspended; it must settle synchronously");
    if (Exit.isSuccess(exit)) return exit.value;
    throw Option.getOrElse(Exit.findErrorOption(exit), () => Cause.squash(exit.cause));
  };
  return {
    subscribe: consents.subscribe,
    open: (ref: RunRef, root?: RunRef) => now(consents.open(ref, root)),
    assertOpen: (origin: Origin) => now(consents.assertOpen(origin)),
    checkpoint: (origin: Origin) => now(consents.checkpoint(origin)),
    close: (ref: RunRef, reason: CloseReason) => now(consents.close(ref, reason)),
    revoke: (thread: string) => now(consents.revoke(thread)),
    closeAll: () => now(consents.closeAll),
  };
};
export type RunConsentsPromise = ReturnType<typeof runConsentsPromise>;
