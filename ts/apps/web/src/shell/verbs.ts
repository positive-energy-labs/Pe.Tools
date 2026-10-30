import { z } from "zod";
import {
  canonicalRouteInput,
  commands,
  workKey,
  type ReadEntry,
  type ExecutionTarget,
  type Command,
  type PaneDecl,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SemanticActionKey,
  type StageDecl,
  type VerbDecl,
  type WorkHandle,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import {
  runSemanticAction,
  actionResult,
  submitAction,
  recoverAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { createRouteOwner } from "../route/route-owner";
import { refuse, writeRefusal, type Refusal } from "../route/refusal";
import { DEFAULT_WAIT_S } from "../route/waits";
import type { ReadingState } from "./readings";

export type Caller = "human" | "agent";
/** Paths address keyed Work members, never their current position in a rendered row array. */
export interface VerbSubject {
  readonly type: string;
  readonly id: string;
  readonly work: WorkKey;
  readonly path: readonly string[];
}
export interface VerbSnapshot {
  readonly target: ExecutionTarget;
  readonly work: { readonly handle: WorkHandle; readonly doc: unknown } | null;
  /** Reading versions, document change marks, or other domain prerequisites. */
  readonly basis: unknown;
  readonly failure?: string | null;
  readonly closed?: boolean;
  /** Work the host holds but cannot read; only a recovery verb acts on it. */
  readonly unreadable?: WorkKey | null;
  /**
   * Advances every time the Target or Work key changes, so A -> B -> A is three generations: a
   * result admitted for the first must not land in the third.
   */
  readonly generation?: number;
  /** Patches the host's set-aside Work would add to this readable Work; only `work.salvage` acts on them. */
  readonly salvage?: readonly RouteStatePatch[] | null;
}
export interface VerbContext<C extends Caller = Caller> {
  readonly caller: C;
  readonly receipt?: (receipt: Exclude<HostReceipt, { state: "detached" }>, press: string) => void;
  readonly page?: () => Readonly<Record<string, unknown>>;
  readonly readings?: () => Readonly<Record<string, ReadingState>>;
  /** The existing owner mints the press and admits exactly one running invocation. */
  readonly owner: Pick<ReturnType<typeof createRouteOwner>, "runAction">;
  /**
   * The verb's view of the world. Its staleness basis is what the verb declares (Work revision,
   * its `verbReadings`, the Page epoch); an undeclared reading never stales a ticket, so a verb's
   * own preview receipt cannot stale its own review.
   */
  readonly snapshot: (verb?: string) => VerbSnapshot;
  readonly subjects: Readonly<
    Record<string, (value: unknown, subject: VerbSubject) => string | null>
  >;
  readonly write: (
    key: WorkKey,
    envelope: { patches: RouteStatePatch[]; expectedRevision: number; press: string },
  ) => Promise<RouteStateWriteResult>;
  readonly changed?: (state: InvocationState, press: string | null) => void;
  readonly waitSeconds?: number;
  /** The kernel's start-fresh door; absent means that recovery cannot run. Salvage is a plain Work write. */
  readonly recover?: (key: WorkKey) => Promise<RouteStateWriteResult>;
}
export interface VerbScope {
  readonly page: Readonly<Record<string, unknown>>;
  readonly snapshot: VerbSnapshot;
  readonly subject: VerbSubject | null;
  readonly value: unknown;
  readonly readings: Readonly<Record<string, ReadingState>>;
}
export interface ReviewTicket<I = unknown> {
  readonly step?: number;
  readonly press: string;
  readonly subject: VerbSubject | null;
  readonly input: I;
  readonly target: ExecutionTarget;
  readonly basis: { readonly work: WorkHandle | null; readonly value: unknown };
  readonly evidence: unknown;
}
export type InvocationState =
  | "idle"
  | "preparing"
  | "review"
  | "applying"
  | "done"
  | "refused"
  | "failed"
  | "stale";
export type InvocationResult =
  | { state: "done"; press: string; kind: "page"; page: Record<string, unknown> }
  | {
      state: "done";
      press: string;
      kind: "rpc";
      receipt: QueryReceipt;
      page?: Record<string, unknown>;
    }
  | { state: "review"; press: string; ticket: ReviewTicket }
  | { state: "done"; press: string; kind: "work"; acknowledgement: WorkWriteAck }
  | {
      state: "done";
      press: string;
      kind: "command";
      receipt: HostReceipt;
      page?: Record<string, unknown>;
    }
  | {
      state: "done";
      press: string;
      kind: "query";
      receipt: QueryReceipt;
      /** Present when the verb's `patches` landed as one Work write. */
      acknowledgement?: WorkWriteAck;
    }
  | {
      state: "done";
      press: string;
      kind: "recovery";
      recovery: Recovery;
      acknowledgement: WorkWriteAck;
    }
  | {
      state: "refused" | "failed" | "stale";
      press: string | null;
      refusal: Refusal;
      receipt?: HostReceipt;
      page?: Record<string, unknown>;
    };
type HostReceipt = Awaited<ReturnType<typeof runSemanticAction>>;
/** Host reads outside the command table: they run through the same invocation, never a route fetch. */
/** Receipt-shaped so the timeline records a read like a command; `subject` is the Work it names. */
export interface QueryReceipt {
  readonly id: string;
  readonly key: string;
  readonly state: "succeeded";
  readonly input: unknown;
  readonly value: unknown;
  readonly subject: string | null;
}
export type Recovery = "start-fresh" | "salvage";
/** Each recovery's own predicate: the stage lists its verb, and the verb refuses, only while it holds. */
const offeredWhen: Record<Recovery, (snapshot: VerbSnapshot) => string | null> = {
  "start-fresh": (snapshot) =>
    snapshot.unreadable ? null : "This Work is readable; there is nothing to recover",
  salvage: (snapshot) =>
    snapshot.failure ??
    (snapshot.unreadable
      ? "Start fresh first; the Work cannot take a write yet"
      : !snapshot.work
        ? "Work has not been read yet"
        : snapshot.salvage?.length
          ? null
          : "Nothing set aside is missing from this Work"),
};
/** Whether a kernel recovery verb belongs on the stage now. */
export const recoveryOffered = (verb: VerbDecl, snapshot: VerbSnapshot): boolean => {
  const recovery = bindings.get(verb)?.recover;
  return recovery !== undefined && offeredWhen[recovery](snapshot) === null;
};
type Terminal = Exclude<InvocationResult, { state: "review" }>;
export type InvocationPhase<C extends Caller> =
  | { kind: "press" }
  | { kind: "commit"; ticket: ReviewTicket; answers?: unknown }
  | { kind: "cancel"; ticket: ReviewTicket }
  | (C extends "agent" ? { kind: "skip" } : never);

type Declaration<S extends z.ZodType> = Omit<VerbDecl<S>, "kind" | "review">;
interface Binding {
  receiptPage?: (receipt: HostReceipt) => Record<string, unknown>;
  raw?: (
    scope: VerbScope,
    input: unknown,
  ) => { key: string; input: Record<string, unknown> } | null;
  sequence?: (scope: VerbScope, input: unknown) => readonly Record<string, unknown>[];
  page?: (scope: VerbScope, input: unknown) => Record<string, unknown>;
  rpc?: ReadEntry;
  lands?: (result: unknown) => Record<string, unknown>;
  ready?: (scope: VerbScope, input: unknown) => string | null;
  patches?: (scope: VerbScope, input: unknown) => readonly RouteStatePatch[];
  command?: SemanticActionKey;
  intent?: (
    scope: VerbScope,
    input: unknown,
    answers: unknown,
    ticket: ReviewTicket | undefined,
  ) => Record<string, unknown>;
  /** A query's Work edit from its result, applied as one write once the read is admitted. */
  queryPatches?: (scope: VerbScope, result: unknown) => readonly RouteStatePatch[];
  queryRevision?: (scope: VerbScope, result: unknown) => number;
  queryCancel?: {
    key: ReadEntry;
    input: (request: Record<string, unknown>) => Record<string, unknown>;
  };
  prepare?: (scope: VerbScope, input: unknown) => unknown;
  answers?: z.ZodType;
  waitSeconds?: number;
  query?: ReadEntry;
  subject?: (value: unknown) => string | null;
  recover?: Recovery;
}
const bindings = new WeakMap<VerbDecl, Binding>();

export function pageVerb<S extends z.ZodType>(
  declaration: Declaration<S>,
  implementation: { page: (scope: VerbScope, input: z.output<S>) => Record<string, unknown> },
): VerbDecl<S> {
  const verb = { ...declaration, kind: "page" as const, review: "none" as const };
  bindings.set(verb, { page: (scope, input) => implementation.page(scope, input as z.output<S>) });
  return verb;
}

/** An explicit host door outside the semantic catalogue, with caller authority in its projection. */
export function rpcVerb<R extends z.ZodType, S extends z.ZodType>(
  rpc: ReadEntry<R>,
  declaration: Declaration<S> & {
    caller: "human" | "any";
    review: "none" | "shown" | "required";
    answers?: z.ZodType;
  },
  implementation: {
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    intent: (scope: VerbScope, input: z.output<S>) => z.input<R>;
    lands?: (result: unknown) => Record<string, unknown>;
  },
): VerbDecl<S> {
  const verb = { ...declaration, kind: "command" as const, does: rpc.key };
  bindings.set(verb, {
    rpc,
    answers: declaration.answers,
    lands: implementation.lands,
    ready: (scope, input) => implementation.ready?.(scope, input as z.output<S>) ?? null,
    prepare: (scope, input) => implementation.intent(scope, input as z.output<S>),
    intent: (scope, input) =>
      implementation.intent(scope, input as z.output<S>) as Record<string, unknown>,
  });
  return verb;
}

/** Catalog operations: reads use their read source; raw writes require human review and admission. */
export function operationVerb<R extends z.ZodType, S extends z.ZodType>(
  read: ReadEntry<R>,
  declaration: Omit<Parameters<typeof rpcVerb<R, S>>[1], "caller" | "review">,
  implementation: Parameters<typeof rpcVerb<R, S>>[2] & {
    raw: (
      scope: VerbScope,
      input: z.output<S>,
    ) => { key: string; input: Record<string, unknown> } | null;
    receiptPage?: (receipt: HostReceipt) => Record<string, unknown>;
  },
): VerbDecl<S> {
  const verb = rpcVerb(read, { ...declaration, caller: "human", review: "shown" }, implementation);
  const binding = bindings.get(verb)!;
  binding.raw = (scope, input) => implementation.raw(scope, input as z.output<S>);
  binding.prepare = (scope, input) => ({
    ...binding.raw!(scope, input),
    target: scope.snapshot.target,
  });
  binding.receiptPage = implementation.receiptPage;
  return verb;
}

export function workVerb<S extends z.ZodType>(
  declaration: Declaration<S>,
  implementation: {
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    patches: (scope: VerbScope, input: z.output<S>) => readonly RouteStatePatch[];
  },
): VerbDecl<S> {
  const verb = { ...declaration, kind: "work" as const, review: "none" as const };
  bindings.set(verb, {
    ready:
      implementation.ready &&
      ((scope, input) => implementation.ready!(scope, input as z.output<S>)),
    patches: (scope, input) => implementation.patches(scope, input as z.output<S>),
  });
  return verb;
}

type WithoutWork<I> = I extends unknown ? Omit<I, "work"> : never;
type CommandInput<K extends SemanticActionKey> = WithoutWork<
  z.input<(typeof commands)[K]["input"]>
>;
export function commandVerb<K extends SemanticActionKey, S extends z.ZodType>(
  command: K,
  declaration: Declaration<S> &
    (
      | { review: "required"; answers: z.ZodType }
      | { review: "none" | "shown"; answers?: z.ZodType }
    ),
  implementation: {
    lands?: (result: unknown) => Record<string, unknown>;
    waitSeconds?: number;
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    prepare?: (scope: VerbScope, input: z.output<S>) => unknown;
    /** `ticket` is the review the person (or Pea) saw, with the evidence `prepare` sealed; absent when `review` is none. */
    intent: (
      scope: VerbScope,
      input: z.output<S>,
      answers: unknown,
      ticket: ReviewTicket | undefined,
    ) => CommandInput<K>;
  },
): VerbDecl<S> {
  const { answers } = declaration;
  const verb = { does: command, ...declaration, kind: "command" as const };
  bindings.set(verb, {
    command,
    lands: implementation.lands,
    waitSeconds: implementation.waitSeconds,
    answers,
    ready:
      implementation.ready &&
      ((scope, input) => implementation.ready!(scope, input as z.output<S>)),
    prepare:
      implementation.prepare &&
      ((scope, input) => implementation.prepare!(scope, input as z.output<S>)),
    intent: (scope, input, reply, ticket) =>
      implementation.intent(scope, input as z.output<S>, reply, ticket) as Record<string, unknown>,
  });
  return verb;
}

/** One press, ordered commands, an independent review and receipt for every step. */
export function sequenceVerb<K extends SemanticActionKey, S extends z.ZodType>(
  command: K,
  declaration: Parameters<typeof commandVerb<K, S>>[1],
  implementation: Omit<Parameters<typeof commandVerb<K, S>>[2], "intent"> & {
    intent: (scope: VerbScope, input: z.output<S>) => readonly CommandInput<K>[];
  },
): VerbDecl<S> {
  const verb = commandVerb(command, declaration, {
    ...implementation,
    intent: (scope, input) => implementation.intent(scope, input)[0]!,
  });
  bindings.get(verb)!.sequence = (scope, input) =>
    implementation.intent(scope, input as z.output<S>) as readonly Record<string, unknown>[];
  return verb;
}

/** A host read verb. It writes nothing itself; `subject` names the Work its result selects. */
export function queryVerb<R extends z.ZodType, S extends z.ZodType>(
  read: ReadEntry<R>,
  declaration: Declaration<S> &
    (
      | { review: "required"; answers: z.ZodType }
      | { review: "none" | "shown"; answers?: z.ZodType }
    ),
  implementation: {
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    prepare?: (scope: VerbScope, input: z.output<S>) => unknown;
    intent?: (scope: VerbScope, input: z.output<S>, answers: unknown) => z.input<R>;
    subject?: (value: unknown) => string | null;
    /** Work edits from the admitted result: ONE write through the normal door, one undoable step. */
    patches?: (scope: VerbScope, result: unknown) => readonly RouteStatePatch[];
    /**
     * The Work revision the patches write expects. Default: the revision the read started on. A read
     * whose host wrote the Work itself (and returned that baseline in its envelope) names it here, so
     * the write lands iff nothing else moved the Work after the host did.
     */
    expectedRevision?: (scope: VerbScope, result: unknown) => number;
    /** How Stop reaches the running read: the cancel query and its input, derived from the request sent. */
    cancel?: {
      key: ReadEntry;
      input: (request: Record<string, unknown>) => Record<string, unknown>;
    };
  } = {},
): VerbDecl<S> {
  const { answers } = declaration;
  const verb: VerbDecl<S> = {
    does: read.key,
    ...declaration,
    kind: "query",
    // A read that also edits Work waits out a conflict like any writing verb.
    effect: implementation.patches ? "command" : "query",
    ...(implementation.subject && { selects: "work" as const }),
  };
  bindings.set(verb, {
    query: read,
    answers,
    subject: implementation.subject,
    queryPatches: implementation.patches,
    queryCancel: implementation.cancel,
    queryRevision: implementation.expectedRevision,
    ready:
      implementation.ready &&
      ((scope, input) => implementation.ready!(scope, input as z.output<S>)),
    prepare:
      implementation.prepare &&
      ((scope, input) => implementation.prepare!(scope, input as z.output<S>)),
    intent: (scope, input, reply) =>
      (implementation.intent?.(scope, input as z.output<S>, reply) ?? input) as Record<
        string,
        unknown
      >,
  });
  return verb;
}

/** A kernel recovery: no route patches, no command; a required review whose answers the declaration states. */
export function recoveryVerb<S extends z.ZodType>(
  recovery: Recovery,
  declaration: Omit<VerbDecl<S>, "kind" | "review" | "answers"> & { answers: z.ZodType },
): VerbDecl<S> {
  const verb: VerbDecl<S> = { ...declaration, kind: "recovery", review: "required" };
  bindings.set(verb, {
    recover: recovery,
    answers: declaration.answers,
    ready: (scope) => offeredWhen[recovery](scope.snapshot),
    prepare: (scope) =>
      recovery === "salvage"
        ? {
            work: workKey(scope.snapshot.work!.handle.key),
            members: scope.snapshot.salvage!.map((patch) => patch.path),
          }
        : { work: workKey(scope.snapshot.unreadable!) },
  });
  return verb;
}

async function runQuery(read: ReadEntry, input: Record<string, unknown>, snapshot: VerbSnapshot) {
  return read.run(read.input.parse(input), {
    target: snapshot.target,
    work: snapshot.work?.handle ?? null,
  });
}

/** Preview commands use the same admitted transport as commit, and return host-owned evidence. */
export async function prepareCommand<K extends SemanticActionKey>(
  scope: VerbScope,
  key: K,
  input: CommandInput<K>,
  waitSeconds = DEFAULT_WAIT_S,
) {
  const receipt = await runSemanticAction(
    key,
    structuredClone(input) as Record<string, unknown>,
    scope.snapshot.target,
    scope.snapshot.work?.handle,
    "",
    crypto.randomUUID(),
    waitSeconds * 1000,
  );
  if (receipt.state !== "succeeded") throw Error(`Preview ${receipt.state}; inspect its receipt`);
  const answer = actionResult(receipt) as { value?: unknown };
  return { receipt, response: answer?.value ?? answer };
}

const frozen = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};
const copy = <T>(value: T): T => frozen(structuredClone(value));
const equal = (a: unknown, b: unknown) => canonicalRouteInput(a) === canonicalRouteInput(b);
const failure = (
  state: "refused" | "failed" | "stale",
  message: string,
  press: string | null = null,
): Extract<Terminal, { refusal: Refusal }> => ({
  state,
  press,
  refusal: refuse(
    state === "stale" ? "stale-revision" : state === "failed" ? "failed" : "not-ready",
    message,
  ),
});

function resolve(
  ctx: VerbContext,
  verb: VerbDecl,
  subject: VerbSubject | null,
  snapshot: VerbSnapshot,
): VerbScope | Refusal {
  if (verb.caller === "human" && ctx.caller !== "human")
    return refuse("not-ready", "Only a person can invoke this host door");
  if (snapshot.closed && verb.kind !== "page")
    return refuse("not-ready", snapshot.failure ?? "This Work only reads");
  if (snapshot.failure && verb.kind !== "query" && verb.kind !== "recovery" && verb.kind !== "page")
    return refuse("not-ready", snapshot.failure);
  if (!verb.subject)
    return subject
      ? refuse("not-ready", "This verb has no subject")
      : {
          snapshot,
          subject,
          value: snapshot.work?.doc,
          readings: ctx.readings?.() ?? {},
          page: ctx.page?.() ?? {},
        };
  if (!subject || subject.type !== verb.subject)
    return refuse("not-ready", `Choose a ${verb.subject} first`);
  if (!snapshot.work || workKey(subject.work) !== workKey(snapshot.work.handle.key))
    return refuse("stale-revision", "That subject belongs to another Work");
  let value: unknown = snapshot.work.doc;
  for (const segment of subject.path) {
    if (
      typeof segment !== "string" ||
      ["__proto__", "prototype", "constructor"].includes(segment) ||
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Object.hasOwn(value, segment)
    )
      return refuse("stale-revision", "That subject is no longer at its Work path");
    value = Reflect.get(value, segment);
  }
  if (ctx.subjects[subject.type]?.(value, subject) !== subject.id)
    return refuse("stale-revision", "That subject's identity changed; bind it again");
  return { snapshot, subject, value, readings: ctx.readings?.() ?? {}, page: ctx.page?.() ?? {} };
}
const basisOf = (snapshot: VerbSnapshot) => ({
  work: snapshot.work?.handle ?? null,
  value: snapshot.basis,
});
const isRefusal = (scope: VerbScope | Refusal): scope is Refusal => "code" in scope;
const resultOf = (refusal: Refusal, press: string | null): Terminal => ({
  state:
    refusal.code === "stale-revision"
      ? "stale"
      : refusal.code === "failed" || refusal.code === "unknown"
        ? "failed"
        : "refused",
  refusal,
  press,
});

interface ReviewSession {
  verb: VerbDecl;
  ticket: ReviewTicket;
  press: string;
  active: boolean;
  decide: (decision: { answers: unknown } | { stop: Terminal }) => void;
  complete: Promise<InvocationResult>;
}
const reviews = new WeakMap<VerbContext, Map<string, ReviewSession>>();

/** Review tickets keep the owner's original invocation open; commit never mints a second press. */
async function invokeCore<C extends Caller>(
  ctx: VerbContext<C>,
  verb: VerbDecl,
  subject: VerbSubject | null,
  args: unknown,
  phase: InvocationPhase<C> = { kind: "press" },
  rendered?: VerbSnapshot,
): Promise<InvocationResult> {
  const binding = bindings.get(verb);
  if (!binding) return failure("refused", "This verb has no executable binding");
  if (phase.kind === "commit" || phase.kind === "cancel") {
    const session = reviews.get(ctx)?.get(phase.ticket.press);
    if (
      !session ||
      session.verb !== verb ||
      !session.active ||
      !equal(session.ticket, phase.ticket)
    )
      return failure("refused", "That review ticket is not open for this invocation");
    if (phase.kind === "cancel") {
      session.active = false;
      session.decide({ stop: failure("refused", "Review cancelled", session.press) });
      return session.complete;
    }
    const current = ctx.snapshot();
    if (
      !equal(phase.ticket.target, current.target) ||
      !equal(phase.ticket.basis, basisOf(current)) ||
      isRefusal(resolve(ctx, verb, phase.ticket.subject, current))
    ) {
      session.active = false;
      session.decide({
        stop: failure("stale", "The review basis changed; prepare a new review", session.press),
      });
      return session.complete;
    }
    if (verb.review === "required" && phase.answers == null)
      return failure("refused", "Answer the required review before committing", session.press);
    const checked = binding.answers?.safeParse(phase.answers);
    if (checked && !checked.success)
      return failure("refused", checked.error.message, session.press);
    session.active = false;
    session.decide({ answers: copy(checked?.data ?? phase.answers) });
    return session.complete;
  }
  if (phase.kind === "skip" && (ctx.caller !== "agent" || verb.review === "required"))
    return failure("refused", "This caller cannot skip this review");

  let answer!: (value: InvocationResult) => void;
  const initial = new Promise<InvocationResult>((resolve) => {
    answer = resolve;
  });
  let terminal: Terminal | undefined;
  let press: string | null = null;
  let session: ReviewSession | undefined;
  const finish = (result: Terminal) => {
    if (terminal) return "refusal" in terminal ? terminal.refusal : null;
    terminal = result;
    if (session) session.active = false;
    if (press) reviews.get(ctx)?.delete(press);
    ctx.changed?.(result.state, result.press);
    return "refusal" in result ? result.refusal : null;
  };
  ctx.changed?.("idle", null);
  void ctx.owner
    .runAction(
      verb.label,
      async (cancelWith, minted) => {
        press = minted;
        ctx.changed?.("preparing", press);
        try {
          const parsed = verb.input.safeParse(args);
          if (!parsed.success) return finish(failure("refused", parsed.error.message, press));
          const input = copy(parsed.data);
          const initialSnapshot = copy(ctx.snapshot());
          const initialScope = resolve(ctx, verb, copy(subject), initialSnapshot);
          if (isRefusal(initialScope)) return finish(resultOf(initialScope, press));
          const steps = binding.sequence?.(initialScope, input);
          if (steps && !steps.length)
            return finish(failure("refused", "This sequence has no commands", press));
          for (let step = 0; step < (steps?.length ?? 1); step++) {
            if (terminal) return "refusal" in terminal ? terminal.refusal : null;
            const snapshot = copy(ctx.snapshot());
            if (
              snapshot.generation !== initialSnapshot.generation ||
              !equal(snapshot.target, initialSnapshot.target) ||
              !equal(snapshot.work?.handle.key, initialSnapshot.work?.handle.key)
            )
              return finish(
                failure("stale", "The Target or Work changed during the sequence", press),
              );
            if (
              step === 0 &&
              rendered &&
              (!equal(rendered.target, snapshot.target) ||
                !equal(basisOf(rendered), basisOf(snapshot)))
            )
              return finish(
                failure("stale", "The bound invocation basis changed; bind again", press),
              );
            const boundSubject = copy(subject);
            const scope = resolve(ctx, verb, boundSubject, snapshot);
            if (isRefusal(scope)) return finish(resultOf(scope, press));
            const ready = binding.ready?.(scope, input);
            if (ready) return finish(failure("refused", ready, press));
            let answers: unknown;
            let ticket: ReviewTicket | undefined;
            if (verb.review !== "none" && (!binding.raw || binding.raw(scope, input))) {
              const evidence = steps ? copy(steps[step]) : await binding.prepare?.(scope, input);
              const prepared = ctx.snapshot();
              if (
                !equal(snapshot.target, prepared.target) ||
                !equal(basisOf(snapshot), basisOf(prepared))
              )
                return finish(
                  failure("stale", "The invocation basis changed during preparation", press),
                );
              ticket = copy({
                ...(steps && { step }),
                press,
                subject: boundSubject,
                input,
                target: snapshot.target,
                basis: basisOf(snapshot),
                evidence,
              });
              if (phase.kind !== "skip") {
                let decide!: ReviewSession["decide"];
                const decision = new Promise<Parameters<ReviewSession["decide"]>[0]>((resolve) => {
                  decide = resolve;
                });
                let nextAnswer!: (result: InvocationResult) => void;
                const complete = new Promise<InvocationResult>((resolve) => {
                  nextAnswer = resolve;
                });
                session = { verb, ticket, press, active: true, decide, complete };
                let open = reviews.get(ctx);
                if (!open) {
                  open = new Map();
                  reviews.set(ctx, open);
                }
                open.set(press, session);
                ctx.changed?.("review", press);
                answer({ state: "review", ticket, press });
                answer = nextAnswer;
                const reply = await decision;
                if ("stop" in reply) return finish(reply.stop);
                answers = reply.answers;
              }
            }
            const current = copy(ctx.snapshot());
            if (
              !equal(snapshot.target, current.target) ||
              !equal(basisOf(snapshot), basisOf(current))
            )
              return finish(failure("stale", "The invocation basis changed; invoke again", press));
            const fresh = resolve(ctx, verb, boundSubject, current);
            if (isRefusal(fresh)) return finish(resultOf(fresh, press));
            const refusal = binding.ready?.(fresh, input);
            if (refusal) return finish(failure("refused", refusal, press));
            ctx.changed?.("applying", press);
            if (binding.page)
              return finish({
                state: "done",
                kind: "page",
                press,
                page: binding.page(fresh, input),
              });
            if (verb.kind === "recovery") {
              if (!binding.recover)
                return finish(
                  failure("refused", "This route has no recovery for this Work", press),
                );
              let result: RouteStateWriteResult;
              if (binding.recover === "salvage") {
                // Carrying over is an ordinary Work write: one ack, one journal step, undoable.
                result = await ctx.write(current.work!.handle.key, {
                  patches: structuredClone(current.salvage!) as RouteStatePatch[],
                  expectedRevision: current.work!.handle.revision,
                  press,
                });
              } else {
                if (!ctx.recover || !current.unreadable)
                  return finish(
                    failure("refused", "This route has no recovery for this Work", press),
                  );
                result = await ctx.recover(structuredClone(current.unreadable));
              }
              if (!result.ok) return finish(resultOf(writeRefusal(result)!, press));
              return finish({
                state: "done",
                kind: "recovery",
                recovery: binding.recover,
                press,
                acknowledgement: result.write,
              });
            }
            if (verb.kind === "query") {
              if (!binding.query || !binding.intent)
                return finish(failure("refused", "This query has no read binding", press));
              if (binding.queryPatches && !current.work)
                return finish(failure("refused", "Work has not been read yet", press));
              // The read's own contract validates and normalizes what reaches the host.
              const request = binding.query.input.parse(
                structuredClone(steps?.[step] ?? binding.intent(fresh, input, answers, ticket)),
              ) as Record<string, unknown>;
              let value: unknown;
              // Stop sends the declared cancel for this very request; the native read ends, not just the wait.
              if (binding.queryCancel) {
                const cancel = binding.queryCancel;
                cancelWith(async () => {
                  await runQuery(cancel.key, cancel.input(request), current);
                });
              }
              try {
                value = await runQuery(binding.query, request, current);
              } catch (cause) {
                // A 4xx is the host refusing this read, in its own words; anything else failed.
                const status = (cause as { status?: unknown } | null)?.status;
                const refusedByHost = typeof status === "number" && status >= 400 && status < 500;
                return finish(
                  failure(
                    refusedByHost ? "refused" : "failed",
                    cause instanceof Error ? cause.message : String(cause),
                    press,
                  ),
                );
              }
              // A result for a Target or Work the person has left must not select anything now.
              const after = ctx.snapshot();
              if (
                current.generation !== after.generation ||
                !equal(current.target, after.target) ||
                (current.work ? workKey(current.work.handle.key) : null) !==
                  (after.work ? workKey(after.work.handle.key) : null)
              )
                return finish(
                  failure("stale", "The Target or Work changed while the read ran", press),
                );
              const receipt = copy({
                id: press,
                key: binding.query.key,
                state: "succeeded" as const,
                input: request,
                value,
                subject: binding.subject?.(value) ?? null,
              });
              const patches = binding.queryPatches?.(fresh, value) ?? [];
              if (!patches.length) return finish({ state: "done", kind: "query", press, receipt });
              // The generation fence above already holds, so the Work is the one the read started on.
              // The write carries the revision the read OBSERVED: a human edit that landed while the
              // read ran makes this a stale refusal, never an overwrite (S0a envelope boundary).
              const written = await ctx.write(after.work!.handle.key, {
                patches: structuredClone(patches) as RouteStatePatch[],
                expectedRevision:
                  binding.queryRevision?.(fresh, value) ?? current.work!.handle.revision,
                press,
              });
              const refused = writeRefusal(written);
              if (refused) return finish(resultOf(refused, press));
              return finish({
                state: "done",
                kind: "query",
                press,
                receipt,
                ...(written.ok && { acknowledgement: written.write }),
              });
            }
            if (verb.kind === "work") {
              if (!current.work || !binding.patches)
                return finish(failure("refused", "Work has not been read yet", press));
              const result = await ctx.write(current.work.handle.key, {
                patches: structuredClone(binding.patches(fresh, input)) as RouteStatePatch[],
                expectedRevision: current.work.handle.revision,
                press,
              });
              const refused = writeRefusal(result);
              if (refused) return finish(resultOf(refused, press));
              if (result.ok)
                return finish({
                  state: "done",
                  kind: "work",
                  press,
                  acknowledgement: result.write,
                });
            }
            const raw = binding.raw?.(fresh, input);
            if (raw) {
              const wait = (binding.waitSeconds ?? ctx.waitSeconds ?? DEFAULT_WAIT_S) * 1000;
              const receipt =
                (await recoverAction(press, raw.key, raw.input, current.target, "", wait)) ??
                (await submitAction({ id: press, ...raw, target: current.target }, "", wait));
              const after = ctx.snapshot();
              const page =
                binding.receiptPage &&
                current.generation === after.generation &&
                equal(current.target, after.target)
                  ? binding.receiptPage(receipt)
                  : undefined;
              if (receipt.state !== "succeeded")
                return finish({
                  ...failure(
                    "failed",
                    `Operation ${receipt.state}; inspect its original receipt`,
                    press,
                  ),
                  receipt,
                  page,
                });
              return finish({
                state: "done",
                kind: "command",
                press,
                receipt,
                page,
              });
            }
            if (binding.rpc && binding.intent) {
              const request = binding.rpc.input.parse(
                binding.intent(fresh, input, answers, ticket),
              ) as Record<string, unknown>;
              const value = await runQuery(binding.rpc, request, current);
              const after = ctx.snapshot();
              const sameScope =
                current.generation === after.generation &&
                equal(current.target, after.target) &&
                equal(current.work?.handle.key, after.work?.handle.key);
              return finish({
                state: "done",
                kind: "rpc",
                press,
                receipt: {
                  id: press,
                  key: binding.rpc.key,
                  state: "succeeded",
                  input: request,
                  value,
                  subject: null,
                },
                ...(sameScope && binding.lands && { page: binding.lands(value) }),
              });
            }
            if (!binding.command || !binding.intent)
              return finish(failure("refused", "This command has no transport binding", press));
            const definition: Command = commands[binding.command];
            if (definition.work && !definition.work.optional && !current.work)
              return finish(failure("refused", "Work has not been read yet", press));
            // Domain intent stays above the existing semantic runner's Work association and admission.
            const receipt = await runSemanticAction(
              binding.command,
              structuredClone(steps?.[step] ?? binding.intent(fresh, input, answers, ticket)),
              current.target,
              current.work?.handle,
              "",
              steps ? crypto.randomUUID() : press,
              (binding.waitSeconds ?? ctx.waitSeconds ?? DEFAULT_WAIT_S) * 1000,
            );
            if (receipt.state === "succeeded") {
              if (steps && step < steps.length - 1) {
                ctx.receipt?.(receipt, press);
                continue;
              }
              const after = ctx.snapshot();
              const sameScope =
                current.generation === after.generation &&
                equal(current.target, after.target) &&
                equal(current.work?.handle.key, after.work?.handle.key);
              return finish({
                state: "done",
                kind: "command",
                press,
                receipt,
                ...(sameScope && binding.lands && { page: binding.lands(receipt.result) }),
              });
            }
            const hostRefusal = "refusal" in receipt ? receipt.refusal : undefined;
            return finish({
              ...failure(
                hostRefusal?.kind === "stale" || hostRefusal?.kind === "stale_revision"
                  ? "stale"
                  : hostRefusal
                    ? "refused"
                    : "failed",
                "error" in receipt
                  ? receipt.error
                  : `Command ${receipt.state}; inspect its original receipt`,
                press,
              ),
              receipt,
            });
          }
          return finish(failure("failed", "Sequence ended without a receipt", press));
        } catch (cause) {
          return finish(
            failure("failed", cause instanceof Error ? cause.message : String(cause), press),
          );
        }
      },
      undefined,
      undefined,
      verb.label,
    )
    .then(
      (refusal) => {
        if (!terminal) {
          const stopped = refusal
            ? resultOf(refusal, press)
            : failure("failed", "The invocation stopped before completion", press);
          session?.decide({ stop: stopped });
          finish(stopped);
        }
        answer(terminal!);
      },
      (cause: unknown) => {
        finish(failure("failed", cause instanceof Error ? cause.message : String(cause), press));
        answer(terminal!);
      },
    );
  return initial;
}

export const invoke = <C extends Caller>(
  ctx: VerbContext<C>,
  verb: VerbDecl,
  subject: VerbSubject | null,
  args: unknown,
  phase: InvocationPhase<C> = { kind: "press" },
) => invokeCore(ctx, verb, subject, args, phase);

export const commit = <C extends Caller>(
  ctx: VerbContext<C>,
  verb: VerbDecl,
  ticket: ReviewTicket,
  answers?: unknown,
) => invoke(ctx, verb, ticket.subject, ticket.input, { kind: "commit", ticket, answers });

export interface BoundVerb<C extends Caller = Caller> {
  readonly label: string;
  readonly chord?: string;
  readonly refusal: string | null;
  run(phase?: InvocationPhase<C>): Promise<InvocationResult>;
}
export function bind<C extends Caller, S extends z.ZodType>(
  verb: VerbDecl<S>,
  binding: { ctx: VerbContext<C>; subject: VerbSubject | null; args: z.input<S> },
): BoundVerb<C> {
  const { ctx } = binding;
  const rendered = copy(ctx.snapshot());
  const subject = copy(binding.subject);
  const args = copy(binding.args);
  return {
    label: verb.label,
    chord: verb.chord,
    get refusal() {
      const implementation = bindings.get(verb);
      if (!implementation) return "This verb has no executable binding";
      const current = copy(ctx.snapshot());
      if (!equal(rendered.target, current.target) || !equal(basisOf(rendered), basisOf(current)))
        return "The bound invocation basis changed; bind again";
      const parsed = verb.input.safeParse(args);
      if (!parsed.success) return parsed.error.message;
      const scope = resolve(ctx, verb, subject, current);
      return isRefusal(scope)
        ? scope.message
        : (implementation.ready?.(scope, parsed.data) ?? null);
    },
    run: (phase) => invokeCore(ctx, verb, subject, args, phase, rendered),
  };
}

export interface PlacementPanes<Row, C extends Caller = Caller> {
  readonly ctx: VerbContext<C>;
  readonly declarations: Readonly<Record<string, PaneDecl<Row>>>;
  readonly verbs: Readonly<Record<string, VerbDecl>>;
  readonly binding: (
    id: string,
    row: Row | undefined,
  ) => { subject: VerbSubject | null; args: unknown };
}
export function placements<Row, C extends Caller>(
  stage: StageDecl,
  panes: PlacementPanes<Row, C>,
  row?: Row,
): BoundVerb<C>[] {
  const ids = [...stage.verbs];
  for (const paneId of stage.panes) {
    const pane = panes.declarations[paneId];
    if (!pane) throw new Error(`Unknown pane ${paneId}`);
    if (typeof pane.verbs !== "function") ids.push(...pane.verbs);
    else if (row !== undefined) {
      const placement = pane.verbs;
      const resolved = placement(row);
      if (resolved.some((id) => !placement.ids.includes(id)))
        throw new Error(`Undeclared row verb in ${paneId}`);
      ids.push(...resolved);
    }
  }
  return [...new Set(ids)].map((id) => {
    const verb = panes.verbs[id];
    if (!verb) throw new Error(`Unknown verb ${id}`);
    return bind(verb, { ctx: panes.ctx, ...panes.binding(id, row) });
  });
}
