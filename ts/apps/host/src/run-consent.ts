import { randomUUID } from "node:crypto";
import { Clock, Context, Deferred, Effect } from "effect";
import type {
  AllowDecision,
  CommandConsent,
  Footprint,
  Origin,
  RunConsent,
  RunRef,
  DocumentRef,
} from "@pe/agent-contracts";

/**
 * The "Reject?" window before an auto-approved write applies. Paid once per thread (consent lasts
 * until Stop), so it can stay long enough to notice an OS notice and press Reject.
 */
export const WRITE_COUNTDOWN_MS = 60_000;

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
const key = (run: RunRef) => JSON.stringify([run.thread, run.turn]);
type Run = {
  ref: RunRef;
  root: RunRef;
  state: RunConsent;
  waiters: Map<string, { run: RunRef; resolve: (decision: AllowDecision | null) => void }>;
  /** Completed by any answer or close; the window fiber then ends without auto-approving. */
  answered?: Deferred.Deferred<void>;
  rejectedBy?: string;
};
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

/**
 * Run consent per thread (ADR 0027 rule 11). The first consequential command in a thread asks once;
 * the decision then covers every later turn of that thread (and its delegated descendants) until a
 * Stop. Auto-approve on: the ask carries a deadline and applies when it passes. Off: a person must
 * allow. Per-turn runs remain the causal identity: a command from an ended turn is still refused.
 * The thread record owns durable grants. Active waits and their clock are never restored: a restart
 * rejects an open countdown, and the next write must open a fresh window.
 */
export class RunConsents {
  private readonly runs = new Map<string, Run>();
  /** Open consent windows: thread id to the decision that opened it. Stop closes it. */
  private readonly threads = new Map<string, AllowDecision>();
  private readonly answers = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  /** Only the currently open window for this invocation; decisions stay in the transcript. */
  commandWindow(id: string): { requestId: string; deadline?: string } | undefined {
    for (const run of this.runs.values()) {
      const state = run.state;
      if (state.state === "waiting" && state.commands.includes(id))
        return {
          requestId: state.requestId,
          ...(state.deadline ? { deadline: state.deadline } : {}),
        };
    }
    return undefined;
  }
  constructor(
    private readonly emit: (run: RunRef, event: ConsentEvent) => void,
    private readonly documentName?: (ref: DocumentRef) => string | undefined,
    private readonly autoApprove: () => boolean = () => true,
    private readonly persist: (thread: string, decision: AllowDecision | null) => void = () => {},
    /** Services the window runs on; a test passes a context carrying `TestClock`. */
    private readonly services: Context.Context<never> = Context.empty(),
  ) {}
  restore(thread: string, decision: AllowDecision | null | undefined) {
    if (decision) this.threads.set(thread, decision);
  }
  /** Revoke even between turns; completed commands waiting at a checkpoint lose authority too. */
  revoke(thread: string) {
    this.persist(thread, null);
    this.threads.delete(thread);
    for (const run of this.runs.values())
      if (run.ref.thread === thread && key(run.ref) === key(run.root)) {
        if (run.state.state === "closed") {
          run.state = {
            state: "closed",
            reason: "stopped",
            decision: null,
            at: new Date().toISOString(),
          };
          this.record(run);
        } else this.close(run.ref, "stopped");
      }
  }
  private describe(footprint: Footprint) {
    return footprint
      .map((effect) => {
        switch (effect.kind) {
          // A person reads document names, never session/open ids (Manual D #5 defect 7); the
          // decision record keeps the exact refs.
          case "document":
            return `document ${this.documentName?.(effect.ref) ?? "(unnamed)"}`;
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
  }
  open(ref: RunRef, root = ref) {
    if (key(ref) !== key(root)) this.assertOpen({ caller: { kind: "anonymous" }, run: root, root });
    if (this.runs.has(key(ref))) throw Error("run.closed: a run identity cannot be reopened");
    const carried = key(ref) === key(root) ? this.threads.get(ref.thread) : undefined;
    const run: Run = {
      ref,
      root,
      state: carried ? { state: "allowed", decision: carried } : { state: "idle" },
      waiters: new Map(),
    };
    this.runs.set(key(ref), run);
    this.record(run);
  }
  private record(run: Run) {
    this.emit(run.ref, { kind: "run_consent", run: run.ref, consent: structuredClone(run.state) });
    for (const listener of this.listeners) listener();
  }
  assertOpen(origin: Origin) {
    if (!origin.run || !origin.root)
      throw Error(
        "run.none: this Pea process has no immutable turn context; invoke from a running Pea turn",
      );
    const own = this.runs.get(key(origin.run)),
      root = this.runs.get(key(origin.root));
    if (
      !own ||
      !root ||
      key(own.root) !== key(origin.root) ||
      own.state.state === "closed" ||
      root.state.state === "closed"
    )
      throw Error("run.closed: this turn has ended; submit a new command from the current turn");
  }
  async authorize(
    origin: Origin,
    id: string,
    footprint: Footprint,
  ): Promise<CommandConsent | null> {
    if (origin.caller.kind === "human") return { by: "press" };
    if (origin.caller.kind !== "pea") return null;
    this.assertOpen(origin);
    const run = this.runs.get(key(origin.root!))!;
    if (run.state.state === "allowed") return { run: run.ref, decision: run.state.decision };
    const answer = new Promise<AllowDecision | null>((resolve) =>
      run.waiters.set(id, { run: origin.run!, resolve }),
    );
    if (run.state.state === "idle") {
      const requestId = randomUUID(),
        auto = this.autoApprove(),
        // effect-edge: island, phase 5
        deadlineMs = auto ? Effect.runSyncWith(this.services)(windowDeadline) : undefined,
        deadline = deadlineMs === undefined ? undefined : new Date(deadlineMs).toISOString();
      run.state = {
        state: "waiting",
        requestId,
        ...(deadline ? { deadline } : {}),
        commands: [id],
      };
      this.record(run);
      this.emit(run.ref, {
        kind: "permission_request",
        turnId: run.ref.turn,
        requestId,
        ...(deadline ? { deadline } : {}),
        scope: "run",
        commands: [id],
        toolCall: {
          toolCallId: `writes:${run.ref.turn}`,
          title: `First write: ${this.describe(footprint)}. Then all writes in this thread until Stop.`,
        },
        options: [
          { optionId: "allow_now", name: auto ? "Allow now" : "Allow", kind: "allow_once" },
          { optionId: "stop_writes", name: "Reject", kind: "reject_once" },
        ],
      });
      if (deadlineMs !== undefined) {
        const answered = Deferred.makeUnsafe<void>();
        run.answered = answered;
        // effect-edge: island, phase 5
        Effect.runForkWith(this.services)(
          consentWindow(answered, deadlineMs).pipe(
            Effect.flatMap((end) =>
              end === "deadline"
                ? Effect.sync(() => this.decide(run.ref.thread, requestId, "allow_now", "deadline"))
                : Effect.void,
            ),
          ),
        );
      }
    } else if (run.state.state === "waiting" && !run.state.commands.includes(id)) {
      run.state.commands.push(id);
      this.record(run);
    }
    const decision = await answer;
    if (!decision)
      throw Error(
        run.rejectedBy
          ? `rejected by ${run.rejectedBy}`
          : "consent.stopped: writes stopped before approval",
      );
    return { run: run.ref, decision };
  }
  decide(thread: string, requestId: string, optionId: string, by: "user" | "deadline" = "user") {
    if (this.answers.get(requestId) === thread) return true;
    const run = [...this.runs.values()].find(
      (r) =>
        r.ref.thread === thread &&
        ((r.state.state === "waiting" && r.state.requestId === requestId) ||
          (r.state.state === "allowed" && r.state.decision.id === requestId)),
    );
    if (!run) return false;
    if (run.state.state === "allowed") return true;
    if (optionId !== "allow_now" && optionId !== "stop_writes") return false;
    this.endWindow(run);
    this.answers.set(requestId, thread);
    if (optionId === "stop_writes") {
      run.rejectedBy = "you";
      this.close(run.ref, "stopped");
      return true;
    }
    const decision: AllowDecision = {
      id: requestId,
      by: by === "deadline" ? "deadline" : "human",
      at: new Date().toISOString(),
    };
    this.persist(run.ref.thread, decision);
    run.state = { state: "allowed", decision };
    this.threads.set(run.ref.thread, decision);
    this.record(run);
    this.emit(run.ref, {
      kind: "permission_resolved",
      turnId: run.ref.turn,
      requestId,
      by,
      optionId,
    });
    for (const { resolve } of run.waiters.values()) resolve(decision);
    run.waiters.clear();
    return true;
  }
  checkpoint(origin: Origin, consent: CommandConsent | null) {
    if (origin.caller.kind !== "pea") return;
    if (!origin.run || !origin.root) throw Error("run.none: command has no causal run");
    const own = this.runs.get(key(origin.run)),
      root = this.runs.get(key(origin.root));
    if (!own || !root || key(own.root) !== key(origin.root))
      throw Error("run.closed: host restarted; old commands require explicit recovery");
    if (root.state.state === "closed" && root.state.reason !== "completed")
      throw Error("consent.stopped: root writes stopped");
    if (own.state.state === "closed" && own.state.reason !== "completed")
      throw Error("consent.stopped: turn writes stopped");
    if (
      (own.state.state === "closed" && !own.state.decision) ||
      (root.state.state === "closed" && !root.state.decision)
    )
      throw Error("run.closed: turn ended before write approval");
    if (consent && "decision" in consent) {
      const decision =
        root.state.state === "allowed" || root.state.state === "closed"
          ? root.state.decision
          : null;
      if (!decision || decision.id !== consent.decision.id)
        throw Error("consent.stopped: authorization is no longer valid");
    }
  }
  /** `stopped` is a Stop: it also closes the thread's consent window. `failed` keeps it. */
  close(ref: RunRef, reason: "completed" | "failed" | "stopped" | "restart") {
    const run = this.runs.get(key(ref));
    if (!run || run.state.state === "closed") return;
    if (reason === "stopped" && key(run.ref) === key(run.root)) {
      this.persist(ref.thread, null);
      this.threads.delete(ref.thread);
    }
    this.endWindow(run);
    const ask = run.state.state === "waiting" ? run.state.requestId : null;
    const root = this.runs.get(key(run.root));
    const decision =
      root?.state.state === "allowed" || root?.state.state === "closed"
        ? root.state.decision
        : null;
    run.state = { state: "closed", reason, decision, at: new Date().toISOString() };
    this.record(run);
    if (ask) this.answers.set(ask, run.ref.thread);
    if (ask)
      this.emit(run.ref, {
        kind: "permission_resolved",
        turnId: run.ref.turn,
        requestId: ask,
        by: "cancel",
      });
    for (const { resolve } of run.waiters.values()) resolve(null);
    run.waiters.clear();
    // Child completion cancels only its unapproved commands, leaving the root countdown intact.
    if (root && root !== run)
      for (const [id, waiter] of root.waiters)
        if (key(waiter.run) === key(ref)) {
          waiter.resolve(null);
          root.waiters.delete(id);
        }
  }
  private endWindow(run: Run) {
    if (run.answered) Deferred.doneUnsafe(run.answered, Effect.void);
  }
  closeAll() {
    for (const run of this.runs.values()) this.close(run.ref, "restart");
  }
}
