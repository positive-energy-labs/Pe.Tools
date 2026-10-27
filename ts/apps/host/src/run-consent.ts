import { randomUUID } from "node:crypto";
import type {
  AllowDecision,
  CommandConsent,
  Footprint,
  Origin,
  RunConsent,
  RunRef,
} from "@pe/agent-contracts";

export const WRITE_COUNTDOWN_MS = 60_000;
const key = (run: RunRef) => JSON.stringify([run.thread, run.turn]);
type Run = {
  ref: RunRef;
  root: RunRef;
  state: RunConsent;
  waiters: Map<string, (decision: AllowDecision | null) => void>;
  timer?: ReturnType<typeof setTimeout>;
};
export type ConsentEvent =
  | { kind: "run_consent"; run: RunRef; consent: RunConsent }
  | {
      kind: "permission_request";
      turnId: string;
      requestId: string;
      scope: "run";
      deadline: string;
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

/** The transcript owns durable decisions. This registry owns only active waits and their clock. */
export class RunConsents {
  private readonly runs = new Map<string, Run>();
  private readonly answers = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  constructor(private readonly emit: (run: RunRef, event: ConsentEvent) => void) {}
  open(ref: RunRef, root = ref) {
    if (key(ref) !== key(root)) this.assertOpen({ caller: { kind: "anonymous" }, run: root, root });
    if (this.runs.has(key(ref))) throw Error("run.closed: a run identity cannot be reopened");
    const run: Run = { ref, root, state: { state: "idle" }, waiters: new Map() };
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
    _footprint: Footprint,
  ): Promise<CommandConsent | null> {
    if (origin.caller.kind === "human") return { by: "press" };
    if (origin.caller.kind !== "pea") return null;
    this.assertOpen(origin);
    const run = this.runs.get(key(origin.root!))!;
    if (run.state.state === "allowed") return { run: run.ref, decision: run.state.decision };
    const answer = new Promise<AllowDecision | null>((resolve) => run.waiters.set(id, resolve));
    if (run.state.state === "idle") {
      const requestId = randomUUID(),
        deadline = new Date(Date.now() + WRITE_COUNTDOWN_MS).toISOString();
      run.state = { state: "waiting", requestId, deadline, commands: [id] };
      this.record(run);
      this.emit(run.ref, {
        kind: "permission_request",
        turnId: run.ref.turn,
        requestId,
        deadline,
        scope: "run",
        commands: [id],
        toolCall: { toolCallId: `writes:${run.ref.turn}`, title: "Writes for this turn" },
        options: [
          { optionId: "allow_now", name: "Allow now", kind: "allow_once" },
          { optionId: "stop_writes", name: "Stop writes for this turn", kind: "reject_once" },
        ],
      });
      run.timer = setTimeout(
        () => this.decide(run.ref.thread, requestId, "allow_now", "deadline"),
        WRITE_COUNTDOWN_MS,
      );
      run.timer.unref();
    } else if (run.state.state === "waiting" && !run.state.commands.includes(id)) {
      run.state.commands.push(id);
      this.record(run);
    }
    const decision = await answer;
    if (!decision) throw Error("consent.stopped: writes stopped before approval");
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
    clearTimeout(run.timer);
    this.answers.set(requestId, thread);
    if (optionId === "stop_writes") {
      this.close(run.ref, "stopped");
      return true;
    }
    const decision: AllowDecision = {
      id: requestId,
      by: by === "deadline" ? "deadline" : "human",
      at: new Date().toISOString(),
    };
    run.state = { state: "allowed", decision };
    this.record(run);
    this.emit(run.ref, {
      kind: "permission_resolved",
      turnId: run.ref.turn,
      requestId,
      by,
      optionId,
    });
    for (const resolve of run.waiters.values()) resolve(decision);
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
    if (consent && "decision" in consent) {
      const decision =
        root.state.state === "allowed" || root.state.state === "closed"
          ? root.state.decision
          : null;
      if (!decision || decision.id !== consent.decision.id)
        throw Error("consent.stopped: authorization is no longer valid");
    }
  }
  close(ref: RunRef, reason: "completed" | "stopped" | "restart") {
    const run = this.runs.get(key(ref));
    if (!run) return;
    if (run.state.state === "closed") return;
    clearTimeout(run.timer);
    const ask = run.state.state === "waiting" ? run.state.requestId : null;
    const decision = run.state.state === "allowed" ? run.state.decision : null;
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
    for (const resolve of run.waiters.values()) resolve(null);
    run.waiters.clear();
  }
  closeAll() {
    for (const run of this.runs.values()) this.close(run.ref, "restart");
  }
}
