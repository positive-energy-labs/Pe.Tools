import { z } from "zod";
import {
  canonicalRouteInput,
  commands,
  familyReads,
  scheduleReads,
  workKey,
  type FamilyReadKey,
  type ScheduleReadKey,
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
  readFamilyCapture,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { readScheduleCapture } from "../../../../packages/mcps/src/shared/schedule-client";
import type { createRouteOwner } from "../route/route-owner";
import { refuse, writeRefusal, type Refusal } from "../route/refusal";
import { DEFAULT_WAIT_S } from "../route/waits";

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
  /** Work the host holds but cannot read; only a recovery verb acts on it. */
  readonly unreadable?: WorkKey | null;
}
export interface VerbContext<C extends Caller = Caller> {
  readonly caller: C;
  /** The existing owner mints the press and admits exactly one running invocation. */
  readonly owner: Pick<ReturnType<typeof createRouteOwner>, "runAction">;
  readonly snapshot: () => VerbSnapshot;
  readonly subjects: Readonly<
    Record<string, (value: unknown, subject: VerbSubject) => string | null>
  >;
  readonly write: (
    key: WorkKey,
    envelope: { patches: RouteStatePatch[]; expectedRevision: number; press: string },
  ) => Promise<RouteStateWriteResult>;
  readonly changed?: (state: InvocationState, press: string | null) => void;
  readonly waitSeconds?: number;
  /** The kernel's recovery door; absent means no recovery verb can run. */
  readonly recover?: (recovery: Recovery, key: WorkKey) => Promise<RouteStateWriteResult>;
}
export interface VerbScope {
  readonly snapshot: VerbSnapshot;
  readonly subject: VerbSubject | null;
  readonly value: unknown;
}
export interface ReviewTicket<I = unknown> {
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
  | { state: "review"; press: string; ticket: ReviewTicket }
  | { state: "done"; press: string; kind: "work"; acknowledgement: WorkWriteAck }
  | { state: "done"; press: string; kind: "command"; receipt: HostReceipt }
  | { state: "done"; press: string; kind: "query"; receipt: QueryReceipt }
  | { state: "done"; press: string; kind: "recovery"; acknowledgement: WorkWriteAck }
  | {
      state: "refused" | "failed" | "stale";
      press: string | null;
      refusal: Refusal;
      receipt?: HostReceipt;
    };
type HostReceipt = Awaited<ReturnType<typeof runSemanticAction>>;
/** Host reads outside the command table: they run through the same invocation, never a route fetch. */
export type QueryKey = ScheduleReadKey | FamilyReadKey;
const reads = { ...scheduleReads, ...familyReads };
/** Receipt-shaped so the timeline records a read like a command; `subject` is the Work it names. */
export interface QueryReceipt {
  readonly id: string;
  readonly key: QueryKey;
  readonly state: "succeeded";
  readonly input: unknown;
  readonly value: unknown;
  readonly subject: string | null;
}
export type Recovery = "start-fresh";
type Terminal = Exclude<InvocationResult, { state: "review" }>;
export type InvocationPhase<C extends Caller> =
  | { kind: "press" }
  | { kind: "commit"; ticket: ReviewTicket; answers?: unknown }
  | { kind: "cancel"; ticket: ReviewTicket }
  | (C extends "agent" ? { kind: "skip" } : never);

type Declaration<S extends z.ZodType> = Omit<VerbDecl<S>, "kind" | "review">;
interface Binding {
  ready?: (scope: VerbScope, input: unknown) => string | null;
  patches?: (scope: VerbScope, input: unknown) => readonly RouteStatePatch[];
  command?: SemanticActionKey;
  intent?: (scope: VerbScope, input: unknown, answers: unknown) => Record<string, unknown>;
  prepare?: (scope: VerbScope, input: unknown) => unknown;
  answers?: z.ZodType;
  waitSeconds?: number;
  query?: QueryKey;
  subject?: (value: unknown) => string | null;
  recover?: Recovery;
}
const bindings = new WeakMap<VerbDecl, Binding>();

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
    waitSeconds?: number;
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    prepare?: (scope: VerbScope, input: z.output<S>) => unknown;
    intent: (scope: VerbScope, input: z.output<S>, answers: unknown) => CommandInput<K>;
  },
): VerbDecl<S> {
  const { answers, ...metadata } = declaration;
  const verb = { does: command, ...metadata, kind: "command" as const };
  bindings.set(verb, {
    command,
    waitSeconds: implementation.waitSeconds,
    answers,
    ready:
      implementation.ready &&
      ((scope, input) => implementation.ready!(scope, input as z.output<S>)),
    prepare:
      implementation.prepare &&
      ((scope, input) => implementation.prepare!(scope, input as z.output<S>)),
    intent: (scope, input, reply) =>
      implementation.intent(scope, input as z.output<S>, reply) as Record<string, unknown>,
  });
  return verb;
}

/** A host read verb. It writes nothing itself; `subject` names the Work its result selects. */
export function queryVerb<K extends QueryKey, S extends z.ZodType>(
  read: K,
  declaration: Declaration<S> &
    (
      | { review: "required"; answers: z.ZodType }
      | { review: "none" | "shown"; answers?: z.ZodType }
    ),
  implementation: {
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    prepare?: (scope: VerbScope, input: z.output<S>) => unknown;
    intent?: (
      scope: VerbScope,
      input: z.output<S>,
      answers: unknown,
    ) => z.input<(typeof reads)[K]["input"]>;
    subject?: (value: unknown) => string | null;
  } = {},
): VerbDecl<S> {
  const { answers, ...metadata } = declaration;
  const verb: VerbDecl<S> = {
    does: read,
    ...metadata,
    kind: "query",
    effect: "query",
    ...(implementation.subject && { selects: "work" as const }),
  };
  bindings.set(verb, {
    query: read,
    answers,
    subject: implementation.subject,
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

/** A kernel recovery: no patches, no command; a required review whose answers the declaration states. */
export function recoveryVerb<S extends z.ZodType>(
  recovery: Recovery,
  declaration: Omit<VerbDecl<S>, "kind" | "review" | "answers"> & { answers: z.ZodType },
): VerbDecl<S> {
  const verb: VerbDecl<S> = { ...declaration, kind: "recovery", review: "required" };
  bindings.set(verb, {
    recover: recovery,
    answers: declaration.answers,
    ready: (scope) =>
      scope.snapshot.unreadable ? null : "This Work is readable; there is nothing to recover",
    prepare: (scope) => ({ work: workKey(scope.snapshot.unreadable!) }),
  });
  return verb;
}

async function runQuery(key: QueryKey, input: Record<string, unknown>, snapshot: VerbSnapshot) {
  const target = snapshot.target.kind === "document" ? snapshot.target.ref : undefined;
  if (Object.hasOwn(scheduleReads, key))
    return readScheduleCapture(key as ScheduleReadKey, input, target);
  if (!snapshot.work) throw Error("Work has not been read yet");
  return readFamilyCapture(key as FamilyReadKey, input, snapshot.work.handle.key, target);
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
  if (!verb.subject)
    return subject
      ? refuse("not-ready", "This verb has no subject")
      : { snapshot, subject, value: snapshot.work?.doc };
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
  return { snapshot, subject, value };
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
  complete: Promise<Terminal>;
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
  let finishWait!: (value: Terminal) => void;
  const complete = new Promise<Terminal>((resolve) => {
    finishWait = resolve;
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
      async (_cancelWith, minted) => {
        press = minted;
        ctx.changed?.("preparing", press);
        try {
          const parsed = verb.input.safeParse(args);
          if (!parsed.success) return finish(failure("refused", parsed.error.message, press));
          const input = copy(parsed.data);
          const snapshot = copy(ctx.snapshot());
          if (
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
          if (verb.review !== "none") {
            const evidence = await binding.prepare?.(scope, input);
            const prepared = ctx.snapshot();
            if (
              !equal(snapshot.target, prepared.target) ||
              !equal(basisOf(snapshot), basisOf(prepared))
            )
              return finish(
                failure("stale", "The invocation basis changed during preparation", press),
              );
            const ticket = copy({
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
              session = { verb, ticket, press, active: true, decide, complete };
              let open = reviews.get(ctx);
              if (!open) {
                open = new Map();
                reviews.set(ctx, open);
              }
              open.set(press, session);
              ctx.changed?.("review", press);
              answer({ state: "review", ticket, press });
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
          if (verb.kind === "recovery") {
            if (!binding.recover || !ctx.recover || !current.unreadable)
              return finish(failure("refused", "This route has no recovery for this Work", press));
            const result = await ctx.recover(binding.recover, structuredClone(current.unreadable));
            if (!result.ok) return finish(resultOf(writeRefusal(result)!, press));
            return finish({
              state: "done",
              kind: "recovery",
              press,
              acknowledgement: result.write,
            });
          }
          if (verb.kind === "query") {
            if (!binding.query || !binding.intent)
              return finish(failure("refused", "This query has no read binding", press));
            // The read's own contract validates and normalizes what reaches the host.
            const request = reads[binding.query].input.parse(
              structuredClone(binding.intent(fresh, input, answers)),
            ) as Record<string, unknown>;
            const value = await runQuery(binding.query, request, current);
            return finish({
              state: "done",
              kind: "query",
              press,
              receipt: copy({
                id: press,
                key: binding.query,
                state: "succeeded" as const,
                input: request,
                value,
                subject: binding.subject?.(value) ?? null,
              }),
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
              return finish({ state: "done", kind: "work", press, acknowledgement: result.write });
          }
          if (!binding.command || !binding.intent)
            return finish(failure("refused", "This command has no transport binding", press));
          const definition: Command = commands[binding.command];
          if (definition.work && !definition.work.optional && !current.work)
            return finish(failure("refused", "Work has not been read yet", press));
          // Domain intent stays above the existing semantic runner's Work association and admission.
          const receipt = await runSemanticAction(
            binding.command,
            structuredClone(binding.intent(fresh, input, answers)),
            current.target,
            current.work?.handle,
            "",
            press,
            (binding.waitSeconds ?? ctx.waitSeconds ?? DEFAULT_WAIT_S) * 1000,
          );
          if (receipt.state === "succeeded")
            return finish({ state: "done", kind: "command", press, receipt });
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
        finishWait(terminal!);
      },
      (cause: unknown) => {
        finish(failure("failed", cause instanceof Error ? cause.message : String(cause), press));
        answer(terminal!);
        finishWait(terminal!);
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
