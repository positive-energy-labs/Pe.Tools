import type { createRouteOwner } from "#/shell/owner";
import {
  canonicalRouteInput,
  invocationOutcome,
  type InvocationOutcome,
  commands,
  workKey,
  type ReadEntry,
  type ExecutionTarget,
  type Command,
  type PaneDecl,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SemanticActionKey,
  writePreviewKey,
  type StageDecl,
  type VerbDecl,
  type WorkHandle,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { z } from "zod";
import {
  runSemanticAction,
  actionResult,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { refuse, writeRefusal, type Refusal } from "../route/refusal";
import { DEFAULT_WAIT_S } from "../route/waits";
import type { JournalDetail } from "./journal";
import { legacyLiveVerbs, type LegacyVerbEnvironment } from "./legacy-environment-bridge";
import { worksharingOf, type VerbPresentation } from "./review-contract";
import { reviewChanges } from "./review-value";
import type { ReadingState } from "./source-contract";
import { createWorkScopeAcceptance, type WorkScopeAcceptance } from "./work-scope-acceptance";

export interface WorkHistory<I> {
  /** Complete the metadata only from fresh Readings of the acknowledged Work revision. */
  readings?: readonly string[];
  describe(
    before: VerbScope,
    input: I,
    after?: Readonly<Record<string, ReadingState>>,
  ): JournalDetail;
}
export interface PendingWorkHistory {
  entry: JournalDetail;
  readings: readonly string[];
  complete(after: Readonly<Record<string, ReadingState>>): JournalDetail;
}

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
  /**
   * Advances every time the Target or Work key changes, so A -> B -> A is three generations: a
   * result admitted for the first must not land in the third.
   */
  readonly generation?: number;
}
export interface VerbContext<C extends Caller = Caller> {
  readonly acceptance?: WorkScopeAcceptance;
  readonly environment?: LegacyVerbEnvironment;
  readonly caller: C;
  readonly receipt?: (receipt: Exclude<HostReceipt, { state: "detached" }>, press: string) => void;
  readonly page?: () => Readonly<Record<string, unknown>>;
  /** Lands a review's declared Page patch before sealing its basis, so it cannot stale itself. */
  readonly landReview?: (page: Record<string, unknown>) => void;
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
    history?: PendingWorkHistory,
    sequential?: boolean,
  ) => Promise<RouteStateWriteResult>;
  readonly changed?: (state: InvocationState, press: string | null) => void;
  readonly waitSeconds?: number;
}
export interface VerbScope {
  readonly page: Readonly<Record<string, unknown>>;
  readonly snapshot: VerbSnapshot;
  readonly subject: VerbSubject | null;
  readonly value: unknown;
  readonly readings: Readonly<Record<string, ReadingState>>;
}
export interface ReviewTicket<I = unknown> {
  readonly presentation: Omit<VerbPresentation, "page">;
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
export type VerbDelivery =
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
      state: "refused" | "failed" | "stale";
      press: string | null;
      refusal: Refusal;
      receipt?: HostReceipt;
      page?: Record<string, unknown>;
    };
export type VerbCompletion = VerbDelivery & { readonly outcome: InvocationOutcome };
export function completeVerb(result: VerbDelivery, input: unknown): VerbCompletion {
  const receipt = "receipt" in result ? result.receipt : undefined;
  const outcome: InvocationOutcome =
    receipt && "steps" in receipt
      ? invocationOutcome(receipt)
      : receipt?.state === "detached"
        ? {
            id: receipt.id,
            input,
            state: "outcome-unknown",
            reason: "Transport ended before the original receipt settled",
            recovery: "reconcile",
            receiptId: receipt.id,
          }
        : {
            id: result.press ?? "",
            input,
            state:
              result.state === "done"
                ? "succeeded"
                : result.state === "review"
                  ? "queued"
                  : result.state,
            ...("refusal" in result ? { reason: result.refusal.message } : {}),
          };
  return { ...result, outcome };
}
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
type Terminal = Exclude<VerbDelivery, { state: "review" }>;
export type InvocationPhase<C extends Caller> =
  | { kind: "press" }
  | { kind: "commit"; ticket: ReviewTicket }
  | { kind: "cancel"; ticket: ReviewTicket }
  | (C extends "agent" ? { kind: "skip" } : never);

type Declaration<S extends z.ZodType> = Omit<VerbDecl<S>, "kind" | "review">;
interface Binding {
  present?: (result: unknown, scope: VerbScope) => VerbPresentation;
  receiptPage?: (receipt: HostReceipt) => Record<string, unknown>;
  raw?: (
    scope: VerbScope,
    input: unknown,
  ) => { key: string; input: Record<string, unknown> } | null;
  stageSequence?: (scope: VerbScope, input: unknown) => readonly Record<string, unknown>[];
  sequence?: (scope: VerbScope, input: unknown) => readonly Record<string, unknown>[];
  page?: (scope: VerbScope, input: unknown) => Record<string, unknown>;
  rpc?: ReadEntry;
  lands?: (result: unknown) => Record<string, unknown>;
  ready?: (scope: VerbScope, input: unknown) => string | null;
  patches?: (scope: VerbScope, input: unknown) => readonly RouteStatePatch[];
  history?: WorkHistory<unknown>;
  command?: SemanticActionKey;
  stage?: (scope: VerbScope, input: unknown) => Record<string, unknown>;
  intent?: (
    scope: VerbScope,
    input: unknown,
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
  waitSeconds?: number;
  query?: ReadEntry;
  subject?: (value: unknown) => string | null;
}
const implementation = Symbol("verb implementation");
class VerbImplementation {
  constructor(readonly binding: Binding) {}
}
function bindImplementation(verb: VerbDecl, binding: Binding): void {
  Object.defineProperty(verb, implementation, {
    value: new VerbImplementation(binding),
    enumerable: true,
  });
}
function implementationOf(verb: VerbDecl): Binding | undefined {
  return implementation in verb && verb[implementation] instanceof VerbImplementation
    ? verb[implementation].binding
    : undefined;
}

export function pageVerb<S extends z.ZodType>(
  declaration: Declaration<S>,
  implementation: { page: (scope: VerbScope, input: z.output<S>) => Record<string, unknown> },
): VerbDecl<S> {
  const verb = { ...declaration, kind: "page" as const, review: "none" as const };
  bindImplementation(verb, {
    page: (scope, input) => implementation.page(scope, input as z.output<S>),
  });
  return verb;
}

/** An explicit host door outside the semantic catalogue, with caller authority in its projection. */
export function rpcVerb<R extends z.ZodType, S extends z.ZodType>(
  rpc: ReadEntry<R>,
  declaration: Declaration<S> & {
    caller: "human" | "any";
    review: "none" | "shown";
  },
  implementation: {
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    intent: (scope: VerbScope, input: z.output<S>) => z.input<R>;
    lands?: (result: unknown) => Record<string, unknown>;
  },
): VerbDecl<S> {
  const verb = { ...declaration, kind: "command" as const, does: rpc.key };
  bindImplementation(verb, {
    rpc,
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
  const binding = implementationOf(verb)!;
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
    history?: WorkHistory<z.output<S>>;
  },
): VerbDecl<S> {
  const verb = { ...declaration, kind: "work" as const, review: "none" as const };
  bindImplementation(verb, {
    ready:
      implementation.ready &&
      ((scope, input) => implementation.ready!(scope, input as z.output<S>)),
    patches: (scope, input) => implementation.patches(scope, input as z.output<S>),
    history: implementation.history && {
      readings: implementation.history.readings,
      describe: (scope, input, after) =>
        implementation.history!.describe(scope, input as z.output<S>, after),
    },
  });
  return verb;
}

type WithoutWork<I> = I extends unknown ? Omit<I, "work"> : never;
type CommandInput<K extends SemanticActionKey> = WithoutWork<
  z.input<(typeof commands)[K]["input"]>
>;
export function commandVerb<K extends SemanticActionKey, S extends z.ZodType>(
  command: K,
  declaration: Declaration<S> & { review: "none" | "shown" },
  implementation: {
    lands?: (result: unknown) => Record<string, unknown>;
    /** Reads the prepared evidence for review, and the receipt result after success. */
    present?: (result: unknown, scope: VerbScope) => VerbPresentation;
    waitSeconds?: number;
    stage?: (scope: VerbScope, input: z.output<S>) => Record<string, unknown>;
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    prepare?: (scope: VerbScope, input: z.output<S>) => unknown;
    /** `ticket` is the review the person (or Pea) saw, with the evidence `prepare` sealed; absent when `review` is none. */
    intent: (
      scope: VerbScope,
      input: z.output<S>,
      ticket: ReviewTicket | undefined,
    ) => CommandInput<K>;
  },
): VerbDecl<S> {
  const verb = { does: command, ...declaration, kind: "command" as const };
  bindImplementation(verb, {
    command,
    stage:
      implementation.stage &&
      ((scope, input) => implementation.stage!(scope, input as z.output<S>)),
    present: implementation.present,
    lands: implementation.lands,
    waitSeconds: implementation.waitSeconds,
    ready:
      implementation.ready &&
      ((scope, input) => implementation.ready!(scope, input as z.output<S>)),
    prepare:
      implementation.prepare &&
      ((scope, input) => implementation.prepare!(scope, input as z.output<S>)),
    intent: (scope, input, ticket) =>
      implementation.intent(scope, input as z.output<S>, ticket) as Record<string, unknown>,
  });
  return verb;
}

/** One press, ordered commands, an independent review and receipt for every step. */
export function sequenceVerb<K extends SemanticActionKey, S extends z.ZodType>(
  command: K,
  declaration: Parameters<typeof commandVerb<K, S>>[1],
  implementation: Omit<Parameters<typeof commandVerb<K, S>>[2], "intent" | "stage"> & {
    stage?: (scope: VerbScope, input: z.output<S>) => readonly Record<string, unknown>[];
    intent: (scope: VerbScope, input: z.output<S>) => readonly CommandInput<K>[];
  },
): VerbDecl<S> {
  const verb = commandVerb(command, declaration, {
    ...implementation,
    stage: implementation.stage && ((scope, input) => implementation.stage!(scope, input)[0]!),
    intent: (scope, input) => implementation.intent(scope, input)[0]!,
  });
  if (implementation.stage)
    implementationOf(verb)!.stageSequence = (scope, input) =>
      implementation.stage!(scope, input as z.output<S>);
  implementationOf(verb)!.sequence = (scope, input) =>
    implementation.intent(scope, input as z.output<S>) as readonly Record<string, unknown>[];
  return verb;
}

/** A host read verb. It writes nothing itself; `subject` names the Work its result selects. */
export function queryVerb<R extends z.ZodType, S extends z.ZodType>(
  read: ReadEntry<R>,
  declaration: Declaration<S> & { review: "none" | "shown" },
  implementation: {
    ready?: (scope: VerbScope, input: z.output<S>) => string | null;
    prepare?: (scope: VerbScope, input: z.output<S>) => unknown;
    intent?: (scope: VerbScope, input: z.output<S>) => z.input<R>;
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
  const verb: VerbDecl<S> = {
    does: read.key,
    ...declaration,
    kind: "query",
    // A read that also edits Work waits out a conflict like any writing verb.
    effect: implementation.patches ? "command" : "query",
    ...(implementation.subject && { selects: "work" as const }),
  };
  bindImplementation(verb, {
    query: read,
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
    intent: (scope, input) =>
      (implementation.intent?.(scope, input as z.output<S>) ?? input) as Record<string, unknown>,
  });
  return verb;
}

/** Preview commands use the same admitted transport as commit, and return host-owned evidence. */
export async function prepareCommand<K extends SemanticActionKey>(
  scope: VerbScope,
  key: K,
  input: CommandInput<K>,
  waitSeconds = DEFAULT_WAIT_S,
  environment: LegacyVerbEnvironment = legacyLiveVerbs,
) {
  const receipt = await environment.commands.semantic(
    key,
    structuredClone(input) as Record<string, unknown>,
    scope.snapshot.target,
    scope.snapshot.work?.handle,
    "",
    crypto.randomUUID(),
    waitSeconds * 1000,
  ).result;
  if (receipt.state !== "succeeded") throw Error(`Preview ${receipt.state}; inspect its receipt`);
  const answer = actionResult(receipt) as { value?: unknown };
  return { receipt, response: answer?.value ?? answer };
}

/** Unpresented evidence stays sealed in the ticket; only a short count summary reaches the UI. */
const genericReview = (verb: VerbDecl, evidence: unknown): VerbPresentation => {
  const result = evidence as { response?: { counts?: object }; counts?: object } | null;
  const counts = result?.response?.counts ?? result?.counts;
  const words = Object.entries(counts ?? {})
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([word, count]) => `${count} ${word}`);
  return {
    sentence: `${verb.label}: ${words.join(" · ") || "review the proposed changes"}.`,
    rows: [],
  };
};

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
  if (snapshot.failure && verb.kind !== "query" && verb.kind !== "page")
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
  decide: (decision: { proceed: true } | { stop: Terminal }) => void;
  complete: Promise<VerbDelivery>;
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
): Promise<VerbDelivery> {
  const environment = ctx.environment ?? legacyLiveVerbs;
  if (verb.kind === "command" && environment.commands.refusal)
    return failure("refused", environment.commands.refusal);
  const binding = implementationOf(verb);
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
    session.active = false;
    session.decide({ proceed: true });
    return session.complete;
  }
  if (phase.kind === "skip" && ctx.caller !== "agent")
    return failure("refused", "This caller cannot skip this review");

  let answer!: (value: VerbDelivery) => void;
  const initial = new Promise<VerbDelivery>((resolve) => {
    answer = resolve;
  });
  let terminal: Terminal | undefined;
  let press: string | null = null;
  let session: ReviewSession | undefined;
  const finish = (result: Terminal) => {
    if (terminal) return "refusal" in terminal ? terminal.refusal : null;
    terminal = result;
    localAcceptance?.close();
    if (session) session.active = false;
    if (press) reviews.get(ctx)?.delete(press);
    ctx.changed?.(result.state, result.press);
    return "refusal" in result ? result.refusal : null;
  };
  ctx.changed?.("idle", null);
  // The write acknowledgement is authoritative before its Reading reaches React.
  // TODO: docs/features/routes/LEDGER.md#s10-families-live-drive Verify Families preview, consent and Revit readback in the fresh detached-local drive.
  // TODO: F3a: close browser review/commit proof after transient preparation-basis refusals and shared-tree HMR; .artifacts/accept/u2-f3a/RESULTS.md records the boundary.
  const localAcceptance = ctx.acceptance
    ? null
    : createWorkScopeAcceptance(() => {
        const seen = ctx.snapshot();
        return {
          target: seen.target,
          work: seen.work?.handle.key ?? null,
          generation: seen.generation,
        };
      });
  const acceptance = ctx.acceptance ?? localAcceptance!;
  const started = acceptance.capture();
  const snapshotNow = (): VerbSnapshot => {
    const seen = ctx.snapshot();
    acceptance.observe(seen.work);
    return { ...seen, work: acceptance.readWork() };
  };
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
          const initialSnapshot = copy(snapshotNow());
          const initialScope = resolve(ctx, verb, copy(subject), initialSnapshot);
          if (isRefusal(initialScope)) return finish(resultOf(initialScope, press));
          const steps = binding.sequence?.(initialScope, input);
          if (steps && !steps.length)
            return finish(failure("refused", "This sequence has no commands", press));
          for (let step = 0; step < (steps?.length ?? 1); step++) {
            if (terminal) return "refusal" in terminal ? terminal.refusal : null;
            let snapshot = copy(snapshotNow());
            if (!acceptance.current(started))
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
            let scope = resolve(ctx, verb, boundSubject, snapshot);
            if (isRefusal(scope)) return finish(resultOf(scope, press));
            const ready = binding.ready?.(scope, input);
            if (ready) return finish(failure("refused", ready, press));
            if (binding.stage) {
              if (!snapshot.work || !binding.command)
                return finish(failure("refused", "Work has not been read yet", press));
              const definition = commands[binding.command];
              if (!("authoredInput" in definition))
                return finish(
                  failure("refused", "This command has no Work intent boundary", press),
                );
              const value = definition.authoredInput.parse(
                binding.stageSequence?.(initialScope, input)[step] ?? binding.stage(scope, input),
              );
              const writing = acceptance.begin();
              const written = await ctx.write(snapshot.work.handle.key, {
                patches: [{ path: ["writeIntent", binding.command], value: { edit: { value } } }],
                expectedRevision: snapshot.work.handle.revision,
                press,
              });
              if (!written.ok) return finish(resultOf(writeRefusal(written)!, press));
              const accepted = acceptance.accept(writing, written.write);
              if (accepted.kind !== "published" && accepted.kind !== "duplicate")
                return finish(failure("stale", "Work acceptance requires a fresh read", press));
              snapshot = copy(snapshotNow());
              scope = resolve(ctx, verb, boundSubject, snapshot);
              if (isRefusal(scope)) return finish(resultOf(scope, press));
            }
            // Derived writes require the host's seal even when this verb has no shown review.
            if (binding.command && "writeBoundary" in commands[binding.command]) {
              await prepareCommand(
                scope,
                writePreviewKey(binding.command),
                {} as CommandInput<SemanticActionKey>,
                binding.waitSeconds,
                environment,
              );
              const afterPreview = snapshotNow();
              if (
                !equal(snapshot.target, afterPreview.target) ||
                !equal(basisOf(snapshot), basisOf(afterPreview))
              )
                return finish(
                  failure("stale", "The invocation basis changed during preview", press),
                );
            }
            let ticket: ReviewTicket | undefined;
            if (verb.review !== "none" && (!binding.raw || binding.raw(scope, input))) {
              const evidence = steps ? copy(steps[step]) : await binding.prepare?.(scope, input);
              const prepared = snapshotNow();
              if (
                !equal(snapshot.target, prepared.target) ||
                !equal(basisOf(snapshot), basisOf(prepared))
              )
                return finish(
                  failure("stale", "The invocation basis changed during preparation", press),
                );
              const presentation = {
                ...(binding.present?.(evidence, scope) ?? genericReview(verb, evidence)),
                worksharing: worksharingOf(evidence),
              };
              // Exact changes are mandatory even when a route supplies its own summary.
              presentation.rows = [...new Set([...presentation.rows, ...reviewChanges(evidence)])];
              const { page, ...words } = presentation;
              if (page && ctx.landReview) {
                ctx.landReview(copy(page));
                const landed = copy(snapshotNow());
                if (!acceptance.current(started) || !equal(snapshot.work, landed.work))
                  return finish(
                    failure(
                      "stale",
                      "The Target or Work changed while presenting the review",
                      press,
                    ),
                  );
                snapshot = landed;
              }
              ticket = copy({
                presentation: words,
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
                let nextAnswer!: (result: VerbDelivery) => void;
                const complete = new Promise<VerbDelivery>((resolve) => {
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
              }
            }
            const current = copy(snapshotNow());
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
            if (verb.kind === "query") {
              if (!binding.query || !binding.intent)
                return finish(failure("refused", "This query has no read binding", press));
              if (binding.queryPatches && !current.work)
                return finish(failure("refused", "Work has not been read yet", press));
              // The read's own contract validates and normalizes what reaches the host.
              const request = binding.query.input.parse(
                structuredClone(steps?.[step] ?? binding.intent(fresh, input, ticket)),
              ) as Record<string, unknown>;
              let value: unknown;
              // Stop sends the declared cancel for this very request; the native read ends, not just the wait.
              if (binding.queryCancel) {
                const cancel = binding.queryCancel;
                cancelWith(async () => {
                  await environment.reads.query(cancel.key, cancel.input(request), current);
                });
              }
              try {
                value = await environment.reads.query(binding.query, request, current);
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
              if (!acceptance.current(started))
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
              // The scope token above is still current, so the Work is the one the read started on.
              // The write carries the revision the read OBSERVED: a human edit that landed while the
              // read ran makes this a stale refusal, never an overwrite (S0a envelope boundary).
              const written = await ctx.write(current.work!.handle.key, {
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
              const history = binding.history;
              const before = history ? structuredClone(fresh) : fresh;
              const result = await ctx.write(
                current.work.handle.key,
                {
                  patches: structuredClone(binding.patches(fresh, input)) as RouteStatePatch[],
                  expectedRevision: current.work.handle.revision,
                  press,
                },
                history && {
                  entry: history.describe(before, input),
                  readings: history.readings ?? [],
                  complete: (after) => history.describe(before, input, after),
                },
                true,
              );
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
              const receipt = await environment.commands.raw(
                press,
                raw.key,
                raw.input,
                current,
                wait,
              ).result;
              const page =
                binding.receiptPage && acceptance.current(started)
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
                binding.intent(fresh, input, ticket),
              ) as Record<string, unknown>;
              const value = await environment.reads.query(binding.rpc, request, current);
              const sameScope = acceptance.current(started);
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
            const receipt = await environment.commands.semantic(
              binding.command,
              structuredClone(steps?.[step] ?? binding.intent(fresh, input, ticket)),
              current.target,
              current.work?.handle,
              "",
              steps ? crypto.randomUUID() : press,
              (binding.waitSeconds ?? ctx.waitSeconds ?? DEFAULT_WAIT_S) * 1000,
            ).result;
            if (receipt.state === "succeeded") {
              if (steps && step < steps.length - 1) {
                ctx.receipt?.(receipt, press);
                continue;
              }
              const sameScope = acceptance.current(started);
              return finish({
                state: "done",
                kind: "command",
                press,
                receipt,
                ...(sameScope &&
                  (binding.lands || binding.present) && {
                    page: {
                      ...binding.lands?.(receipt.result),
                      ...binding.present?.(receipt.result, fresh).page,
                    },
                  }),
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
        localAcceptance?.close();
        answer(terminal!);
      },
      (cause: unknown) => {
        finish(failure("failed", cause instanceof Error ? cause.message : String(cause), press));
        localAcceptance?.close();
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
) => invokeCore(ctx, verb, subject, args, phase).then((result) => completeVerb(result, args));

export const commit = <C extends Caller>(
  ctx: VerbContext<C>,
  verb: VerbDecl,
  ticket: ReviewTicket,
) => invoke(ctx, verb, ticket.subject, ticket.input, { kind: "commit", ticket });

export interface BoundVerb<C extends Caller = Caller> {
  readonly label: string;
  readonly chord?: string;
  readonly refusal: string | null;
  run(phase?: InvocationPhase<C>): Promise<VerbCompletion>;
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
      const environment = ctx.environment ?? legacyLiveVerbs;
      if (verb.kind === "command" && environment.commands.refusal)
        return environment.commands.refusal;
      const implementation = implementationOf(verb);
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
    run: (phase) =>
      invokeCore(ctx, verb, subject, args, phase, rendered).then((result) =>
        completeVerb(result, args),
      ),
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
