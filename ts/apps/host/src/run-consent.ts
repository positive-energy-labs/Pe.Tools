import { Cause, Clock, Context, Crypto, DateTime, Deferred, Effect, Exit, Layer, Option, Schema } from "effect";
import type {
  AllowDecision,
  CommandConsent,
  DocumentRef,
  Footprint,
  Origin,
  RunConsent,
  RunRef,
} from "@pe/agent-contracts";

/**
 * The "Reject?" window before an auto-approved write applies. Paid once per thread (consent lasts
 * until Stop), so it can stay long enough to notice an OS notice and press Reject.
 */
export const WRITE_COUNTDOWN_MS = 60_000;

/** A run refuses this command: no run, an ended run, or writes stopped or rejected. */
export class ConsentRefused extends Schema.TaggedError<ConsentRefused>()("ConsentRefused", {
  code: Schema.Literals(["run.none", "run.closed", "consent.stopped", "consent.rejected"]),
  message: Schema.String,
}) {}

/** The thread record did not take the grant: no waiter reads this answer as an approval. */
export class ConsentPersistFailed extends Schema.TaggedError<ConsentPersistFailed>()(
  "ConsentPersistFailed",
  { thread: Schema.String, message: Schema.String },
) {}

const refused = (code: ConsentRefused["code"], message: string) =>
  new ConsentRefused({ code, message: code === "consent.rejected" ? message : `${code}: ${message}` });

/** How a window ends: a person's answer through `decide`, or its deadline passing. */
export type WindowEnd = "answered" | "deadline";

/** The window's deadline, read from `Clock`: the timestamp the ask shows is the one the window keeps. */
export const windowDeadline = Clock.currentTimeMillis.pipe(
  Effect.map((now) => now + WRITE_COUNTDOWN_MS),
);

/**
 * The consent window (ADR 0027 rule 11) on `Clock`: it ends when `answered` completes (Allow,
 * Reject or a close) or at `deadlineMs`, whichever comes first. Sleeping to the stored deadline,
 * not for a fresh 60 s, keeps the auto-approve instant equal to the deadline the UI read.
 */
export const consentWindow = Effect.fn("consent.window")(function* (
  answered: Deferred.Deferred<void>,
  deadlineMs: number,
) {
  const now = yield* Clock.currentTimeMillis;
  return yield* Deferred.await(answered).pipe(
    Effect.as<WindowEnd>("answered"),
    Effect.timeoutOrElse({
      duration: Math.max(0, deadlineMs - now),
      orElse: () => Effect.succeed<WindowEnd>("deadline"),
    }),
  );
});

export type ConsentEvent =
  | { kind: "run_consent"; run: RunRef; consent: RunConsent }
  | {
      kind: "permission_request";
      turnId: string;
      requestId: string;
      scope: "run";
      deadline?: string;
      commands: string[];
      toolCall: { toolCallId: string; title: string };
      options: { optionId: string; name: string; kind: "allow_once" | "reject_once" }[];
    }
  | {
      kind: "permission_resolved";
      turnId: string;
      requestId: string;
      by: "user" | "deadline";
      optionId: string;
    }
  | { kind: "permission_resolved"; turnId: string; requestId: string; by: "cancel" };

/** Where consent lands: the thread store's transcript and grant record. */
export interface ConsentSink {
  readonly emit: (run: RunRef, event: ConsentEvent) => void;
  /** Throws when the record did not take the grant; the settlement then fails, never succeeds. */
  readonly persist: (thread: string, decision: AllowDecision | null) => void;
  readonly documentName?: (ref: DocumentRef) => string | undefined;
  readonly autoApprove: () => boolean;
}

type Waiter = { run: RunRef; answer: Deferred.Deferred<AllowDecision, ConsentError> };
type Run = {
  ref: RunRef;
  root: RunRef;
  state: RunConsent;
  waiters: Map<string, Waiter>;
  /** Completed by any answer or close; the window fiber then ends without auto-approving. */
  answered?: Deferred.Deferred<void>;
  rejectedBy?: string;
};
export type ConsentError = ConsentRefused | ConsentPersistFailed;
type CloseReason = "completed" | "failed" | "stopped" | "restart";

const key = (run: RunRef) => JSON.stringify([run.thread, run.turn]);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const describe = (footprint: Footprint, documentName?: (ref: DocumentRef) => string | undefined) =>
  footprint
    .map((effect) => {
      switch (effect.kind) {
        // A person reads document names, never session/open ids (Manual D #5 defect 7); the
        // decision record keeps the exact refs.
        case "document":
          return `document ${documentName?.(effect.ref) ?? "(unnamed)"}`;
        case "session":
          return "the Revit session";
        case "member":
          return `member ${effect.pod}/${effect.path}`;
        case "file":
          return `file ${effect.path}`;
        case "directory":
          return `directory ${effect.path}`;
        case "publication":
          return `publication ${effect.page}`;
      }
    })
    .join(", ");

const makeRunConsents = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const crypto = yield* Crypto.Crypto;
  const runs = new Map<string, Run>();
  /** Open consent windows: thread id to the decision that opened it. Stop closes it. */
  const threads = new Map<string, AllowDecision>();
  const answers = new Map<string, string>();
  const listeners = new Set<() => void>();
  // The thread store owns the transcript and grant record, and it is not a service until phase 4,
  // so it attaches itself here (ADR 0029 rule 3 wants a layer dependency). Until it does, nothing
  // opens a run, so the detached sink is never consulted for a real ask.
  let sink: ConsentSink = { emit: () => {}, persist: () => {}, autoApprove: () => false };

  /** Notification is isolated: a throwing subscriber is logged, never decides a settlement. */
  const notify = (run: Run, event?: ConsentEvent) =>
    Effect.suspend(() => {
      const calls = [
        () =>
          sink.emit(run.ref, {
            kind: "run_consent",
            run: run.ref,
            consent: structuredClone(run.state),
          }),
        ...(event ? [() => sink.emit(run.ref, event)] : []),
        ...[...listeners].map((listener) => () => listener()),
      ];
      return Effect.forEach(
        calls,
        (call) =>
          Effect.try(call).pipe(
            Effect.catch((error) => Effect.logWarning(`consent notification failed: ${String(error.cause)}`)),
          ),
        { discard: true },
      );
    });
  const persist = (thread: string, decision: AllowDecision | null) =>
    Effect.try({
      try: () => sink.persist(thread, decision),
      catch: (cause) =>
        new ConsentPersistFailed({
          thread,
          message: `consent.persist: the thread record did not take the ${decision ? "grant" : "revocation"} (${String(cause)})`,
        }),
    });
  const endWindow = (run: Run) =>
    Effect.sync(() => run.answered && Deferred.doneUnsafe(run.answered, Effect.void));

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

  /**
   * The one settlement. Window ends, the record takes the answer, the transcript hears it, and
   * every waiter settles in the exit handler: a persist failure fails them with it, and any other
   * exit (an interrupt included) still settles them. No waiter outlives a settlement.
   */
  const settle = (
    waiters: Waiter[],
    body: Effect.Effect<AllowDecision | ConsentRefused, ConsentError>,
  ) =>
    body.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const outcome: Effect.Effect<AllowDecision, ConsentError> = Exit.isSuccess(exit)
            ? exit.value instanceof ConsentRefused
              ? Effect.fail(exit.value)
              : Effect.succeed(exit.value)
            : Effect.fail(
                Option.getOrElse(Exit.findErrorOption(exit), () =>
                  refused("consent.stopped", "consent settlement did not finish"),
                ),
              );
          const settled = new Set(waiters);
          for (const waiter of waiters) Deferred.doneUnsafe(waiter.answer, outcome);
          for (const run of runs.values())
            for (const [id, waiter] of run.waiters) if (settled.has(waiter)) run.waiters.delete(id);
        }),
      ),
    );

  const allow = Effect.fn("consent.allow")(function* (
    run: Run,
    requestId: string,
    optionId: string,
    by: "user" | "deadline",
  ) {
    return yield* settle(
      [...run.waiters.values()],
      Effect.gen(function* () {
        yield* endWindow(run);
        const decision: AllowDecision = {
          id: requestId,
          by: by === "deadline" ? "deadline" : "human",
          at: yield* nowIso,
        };
        const persisted = yield* Effect.exit(persist(run.ref.thread, decision));
        if (Exit.isFailure(persisted)) {
          // Not a grant: the ask ends, the next write opens a fresh window.
          run.state = { state: "idle" };
          yield* notify(run, {
            kind: "permission_resolved",
            turnId: run.ref.turn,
            requestId,
            by: "cancel",
          });
          return yield* Effect.failCause(persisted.cause);
        }
        answers.set(requestId, run.ref.thread);
        run.state = { state: "allowed", decision };
        threads.set(run.ref.thread, decision);
        yield* notify(run, {
          kind: "permission_resolved",
          turnId: run.ref.turn,
          requestId,
          by,
          optionId,
        });
        return decision;
      }),
    );
  });

  /** `stopped` is a Stop: it also closes the thread's consent window. `failed` keeps it. */
  const close = Effect.fn("consent.close")(function* (ref: RunRef, reason: CloseReason) {
    const run = runs.get(key(ref));
    if (!run || run.state.state === "closed") return;
    const root = runs.get(key(run.root));
    // A child's end cancels only its own unapproved commands, leaving the root countdown intact.
    const childWaiters =
      root && root !== run ? [...root.waiters.values()].filter((w) => key(w.run) === key(ref)) : [];
    const refusal = refused(
      run.rejectedBy ? "consent.rejected" : "consent.stopped",
      run.rejectedBy ? `rejected by ${run.rejectedBy}` : "writes stopped before approval",
    );
    let persisted: Exit.Exit<void, ConsentPersistFailed> = Exit.void;
    yield* settle(
      [...run.waiters.values(), ...childWaiters],
      Effect.gen(function* () {
          if (reason === "stopped" && key(run.ref) === key(run.root)) {
            // Closing is the safe direction: it proceeds, and the failed write is reported after.
            persisted = yield* Effect.exit(persist(ref.thread, null));
            threads.delete(ref.thread);
          }
          yield* endWindow(run);
          const ask = run.state.state === "waiting" ? run.state.requestId : null;
          const decision =
            root?.state.state === "allowed" || root?.state.state === "closed"
              ? root.state.decision
              : null;
          run.state = { state: "closed", reason, decision, at: yield* nowIso };
          if (ask) answers.set(ask, run.ref.thread);
          yield* notify(
            run,
            ask
              ? { kind: "permission_resolved", turnId: run.ref.turn, requestId: ask, by: "cancel" }
              : undefined,
          );
          return refusal;
      }),
    );
    return yield* persisted;
  });

  const decide = Effect.fn("consent.decide")(function* (
    thread: string,
    requestId: string,
    optionId: string,
    by: "user" | "deadline" = "user",
  ) {
    if (answers.get(requestId) === thread) return true;
    const run = [...runs.values()].find(
      (r) =>
        r.ref.thread === thread &&
        ((r.state.state === "waiting" && r.state.requestId === requestId) ||
          (r.state.state === "allowed" && r.state.decision.id === requestId)),
    );
    if (!run) return false;
    if (run.state.state === "allowed") return true;
    if (optionId === "stop_writes") {
      run.rejectedBy = "you";
      yield* close(run.ref, "stopped");
      return true;
    }
    if (optionId !== "allow_now") return false;
    yield* allow(run, requestId, optionId, by);
    return true;
  });

  const authorize = Effect.fn("consent.authorize")(function* (
    origin: Origin,
    id: string,
    footprint: Footprint,
  ) {
    if (origin.caller.kind === "human") return { by: "press" } as CommandConsent;
    if (origin.caller.kind !== "pea") return null;
    yield* assertOpen(origin);
    const run = runs.get(key(origin.root!))!;
    if (run.state.state === "allowed")
      return { run: run.ref, decision: run.state.decision } as CommandConsent;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const waiter = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const waiter = {
              run: origin.run!,
              answer: Deferred.makeUnsafe<AllowDecision, ConsentError>(),
            };
            run.waiters.set(id, waiter);
            return waiter;
          }),
          (waiter) =>
            Effect.gen(function* () {
              // An older invocation must never unregister a replacement with the same command id.
              if (run.waiters.get(id) !== waiter) return;
              run.waiters.delete(id);
              if (run.state.state === "waiting") {
                run.state.commands = run.state.commands.filter((command) => command !== id);
                yield* notify(run);
              }
            }),
        );
        if (run.state.state === "idle") {
          const requestId = yield* Effect.orDie(crypto.randomUUIDv4),
            auto = sink.autoApprove(),
            deadlineMs = auto ? yield* windowDeadline : undefined,
            deadline =
              deadlineMs === undefined
                ? undefined
                : DateTime.formatIso(DateTime.makeUnsafe(deadlineMs));
          run.state = {
            state: "waiting",
            requestId,
            ...(deadline ? { deadline } : {}),
            commands: [id],
          };
          yield* notify(run, {
            kind: "permission_request",
            turnId: run.ref.turn,
            requestId,
            ...(deadline ? { deadline } : {}),
            scope: "run",
            commands: [id],
            toolCall: {
              toolCallId: `writes:${run.ref.turn}`,
              title: `First write: ${describe(footprint, sink.documentName)}. Then all writes in this thread until Stop.`,
            },
            options: [
              { optionId: "allow_now", name: auto ? "Allow now" : "Allow", kind: "allow_once" },
              { optionId: "stop_writes", name: "Reject", kind: "reject_once" },
            ],
          });
          if (deadlineMs !== undefined) {
            const answered = Deferred.makeUnsafe<void>();
            run.answered = answered;
            // Forked into the service scope: closing it interrupts every open window.
            yield* Effect.forkIn(
              consentWindow(answered, deadlineMs).pipe(
                Effect.flatMap((end) =>
                  end === "deadline"
                    ? decide(run.ref.thread, requestId, "allow_now", "deadline").pipe(
                        Effect.catch((error) => Effect.logWarning(error.message)),
                      )
                    : Effect.void,
                ),
              ),
              scope,
            );
          }
        } else if (run.state.state === "waiting" && !run.state.commands.includes(id)) {
          run.state.commands.push(id);
          yield* notify(run);
        }
        return { run: run.ref, decision: yield* Deferred.await(waiter.answer) } as CommandConsent;
      }),
    );
  });

  const closeAll = Effect.suspend(() =>
    Effect.forEach([...runs.values()], (run) => Effect.exit(close(run.ref, "restart"))),
  ).pipe(Effect.flatMap((exits) => exits.find(Exit.isFailure) ?? Effect.void));

  yield* Effect.addFinalizer(() => Effect.ignore(closeAll));

  return {
    /** The thread store attaches its transcript and grant record (see `sink`). */
    attach: (next: ConsentSink) => {
      sink = next;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Only the currently open window for this invocation; decisions stay in the transcript. */
    commandWindow: (id: string): { requestId: string; deadline?: string } | undefined => {
      for (const run of runs.values())
        if (run.state.state === "waiting" && run.state.commands.includes(id))
          return {
            requestId: run.state.requestId,
            ...(run.state.deadline ? { deadline: run.state.deadline } : {}),
          };
      return undefined;
    },
    restore: (thread: string, decision: AllowDecision | null | undefined) => {
      if (decision) threads.set(thread, decision);
    },
    open: Effect.fn("consent.open")(function* (ref: RunRef, root: RunRef = ref) {
      if (key(ref) !== key(root))
        yield* assertOpen({ caller: { kind: "anonymous" }, run: root, root });
      if (runs.has(key(ref)))
        return yield* refused("run.closed", "a run identity cannot be reopened");
      const carried = key(ref) === key(root) ? threads.get(ref.thread) : undefined;
      const run: Run = {
        ref,
        root,
        state: carried ? { state: "allowed", decision: carried } : { state: "idle" },
        waiters: new Map(),
      };
      runs.set(key(ref), run);
      yield* notify(run);
    }),
    assertOpen,
    authorize,
    decide,
    close,
    /** Revoke even between turns; completed commands waiting at a checkpoint lose authority too. */
    revoke: Effect.fn("consent.revoke")(function* (thread: string) {
      const persisted = yield* Effect.exit(persist(thread, null));
      threads.delete(thread);
      for (const run of runs.values())
        if (run.ref.thread === thread && key(run.ref) === key(run.root)) {
          if (run.state.state === "closed") {
            run.state = { state: "closed", reason: "stopped", decision: null, at: yield* nowIso };
            yield* notify(run);
          } else yield* Effect.ignore(close(run.ref, "stopped"));
        }
      return yield* persisted;
    }),
    checkpoint: (origin: Origin, consent: CommandConsent | null) =>
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
        if (root.state.state === "closed" && root.state.reason !== "completed")
          return Effect.fail(refused("consent.stopped", "root writes stopped"));
        if (own.state.state === "closed" && own.state.reason !== "completed")
          return Effect.fail(refused("consent.stopped", "turn writes stopped"));
        if (
          (own.state.state === "closed" && !own.state.decision) ||
          (root.state.state === "closed" && !root.state.decision)
        )
          return Effect.fail(refused("run.closed", "turn ended before write approval"));
        if (consent && "decision" in consent) {
          const decision =
            root.state.state === "allowed" || root.state.state === "closed"
              ? root.state.decision
              : null;
          if (!decision || decision.id !== consent.decision.id)
            return Effect.fail(
              refused("consent.stopped", "authorization is no longer valid"),
            );
        }
        return Effect.void;
      }),
    closeAll,
  };
});

/**
 * Run consent per thread (ADR 0027 rule 11). The first consequential command in a thread asks once;
 * the decision then covers every later turn of that thread (and its delegated descendants) until a
 * Stop. Auto-approve on: the ask carries a deadline and applies when it passes. Off: a person must
 * allow. Per-turn runs remain the causal identity: a command from an ended turn is still refused.
 * The thread record owns durable grants. Active waits and their clock are never restored: a restart
 * rejects an open countdown, and the next write must open a fresh window. Closing the layer's
 * scope interrupts every open window and closes every run, so no waiter outlives the host.
 */
export class RunConsents extends Context.Service<
  RunConsents,
  Effect.Success<typeof makeRunConsents>
>()("pe/RunConsents") {
  static readonly layer = Layer.effect(RunConsents, makeRunConsents);
}

/**
 * The Promise face of {@link RunConsents} for the thread store, control and the journal, which
 * are Promise code until phase 5. Every crossing goes through `edge`; a refusal or persist
 * failure is thrown as its tagged value.
 */
export const runConsentsPromise = (consents: RunConsents["Service"]) => {
  const edge = <A, E>(effect: Effect.Effect<A, E>) =>
    // effect-edge: island, phase 5
    Effect.runFork(effect);
  /** Settlements and checks never suspend; a fiber that does is a defect, not a silent wait. */
  const thrown = <E>(exit: Exit.Failure<unknown, E>) =>
    Option.getOrElse(Exit.findErrorOption(exit), () => Cause.squash(exit.cause));
  const now = <A, E>(effect: Effect.Effect<A, E>): A => {
    const exit = edge(effect).pollUnsafe();
    if (!exit) throw Error("consent operation suspended; it must settle synchronously");
    if (Exit.isSuccess(exit)) return exit.value;
    throw thrown(exit);
  };
  return {
    attach: consents.attach,
    subscribe: consents.subscribe,
    commandWindow: consents.commandWindow,
    restore: consents.restore,
    open: (ref: RunRef, root?: RunRef) => now(consents.open(ref, root)),
    assertOpen: (origin: Origin) => now(consents.assertOpen(origin)),
    checkpoint: (origin: Origin, consent: CommandConsent | null) =>
      now(consents.checkpoint(origin, consent)),
    decide: (thread: string, requestId: string, optionId: string) =>
      now(consents.decide(thread, requestId, optionId)),
    close: (ref: RunRef, reason: CloseReason) => now(consents.close(ref, reason)),
    revoke: (thread: string) => now(consents.revoke(thread)),
    closeAll: () => now(consents.closeAll),
    authorize: (origin: Origin, id: string, footprint: Footprint) =>
      new Promise<CommandConsent | null>((resolve, reject) =>
        edge(consents.authorize(origin, id, footprint)).addObserver((exit) =>
          Exit.isSuccess(exit)
            ? resolve(exit.value)
            : reject(thrown(exit)),
        ),
      ),
  };
};
export type RunConsentsPromise = ReturnType<typeof runConsentsPromise>;
