import type {
  BridgeError as FrozenBridgeError,
  NoRevitSession as FrozenNoRevitSession,
  DoorEvidence,
  NativeOutcome,
  NativeAnswer,
  DoorFailure,
} from "./request-contracts.d.ts";
import { Clock, Context, Deferred, Effect, Exit, Queue, Ref, Schema } from "effect";
import { randomUUID } from "node:crypto";
import type {
  BridgeFrame,
  BridgeResponse,
  BridgeStateSnapshot,
  BridgeTerminal,
  Lane,
  ValidationIssue,
} from "@pe/host-contracts/contracts";

type DispatchRefusal = { kind: "cancelled" | "refused"; message: string };
/** Job-owned evidence; no completed-id registry. Freshness must be supplied by read admission. */
export interface NativeDispatchHandle {
  readonly answer: Effect.Effect<NativeAnswer<unknown, "unavailable">, DoorFailure>;
  readonly terminal: Effect.Effect<NativeOutcome>;
}

export interface DispatchPorts {
  command(): string | undefined;
  commandLeafRefusal(key: string, command: string | undefined): string | null;
  bridgeValidateDispatch(id: string): Promise<DispatchRefusal | null>;
  bridgeDispatchRefusal(id: string): DispatchRefusal | null;
  markBridgeDispatched(id: string): Promise<void>;
  recordBridgeQueue(
    key: string,
    id: string,
    session: string,
    phase: "queued" | "started",
    depth: number,
    waitMs?: number,
  ): Promise<unknown>;
}
// Vocabulary: a SESSION is one Revit process incarnation; a CONNECTION is one WS attachment to
// it. With stable ids (hash(pid + processStartUtc)) a reconnect re-registers the SAME session id,
// and the session (its line, its worker, its requests, its occupied slot) survives the transport
// replacement: only `connection` changes. A new socket never opens the slot for the next op.
export type Connection = {
  /** Increments per attachment of one session; a late answer from an older epoch still matches. */
  readonly epoch: number;
  readonly send: (frame: BridgeFrame) => Effect.Effect<void>;
  // Observed selector metadata, never process identity or custody authority.
  readonly lane: Lane | null;
  readonly sourceRoot: string | null;
  readonly installedRoot: string | null;
  readonly serviceName: string;
  readonly sdkSessionId: string | null;
  readonly buildStamp: string | null;
};

export type Session = {
  // Every request this session owns, keyed by the id the wire carries. Responses route by that
  // id from any of the session's sockets, so several requests may be live at once: the serial
  // worker below keeps ordinary ops serial, and `op.cancel` is the one op that walks past it.
  readonly requests: Ref.Ref<ReadonlyMap<string, BridgeRequest>>;
  readonly sessionId: string;
  readonly processId: number;
  readonly processStartUtcUnixMs: number | null;
  /**
   * The current attachment; null while the transport is lost. A loss with a dispatched request is
   * reconciliation: the slot stays held until the answer arrives (on any socket) or the process
   * is observed dead. A loss with nothing dispatched retires the session.
   */
  readonly connection: Ref.Ref<Connection | null>;
  readonly state: Ref.Ref<BridgeStateSnapshot>;
  // One worker fiber per session, forked in the bridge scope, takes `line` in FIFO order: one op
  // at a time, no priority, no preemption. Machine callers (SSE-invalidated refetch bursts, IDE
  // $ref resolution, agents) collide constantly; queueing beats instant-423. `depth` counts the
  // jobs that hold a place (waiting or running) and bounds the line at limits.entries.
  readonly line: Queue.Queue<Job>;
  readonly depth: Ref.Ref<number>;
  /** Done when a newer incarnation of this pid registers: death evidence the pid probe cannot see. */
  readonly ended: Deferred.Deferred<void>;
};

type JobAnswer = { readonly value: unknown; readonly openDocumentId?: string | null };
type JobState = "queued" | "running" | "sent" | "left";

/**
 * One ordinary op in a session's line. `state` is the single claim on its place: the waiter that
 * leaves (`queued` -> `left`) and the worker that starts it (`queued` -> `running`) race on one
 * atomic transition, so exactly one of them retires the place.
 */
type Job = {
  readonly operationKey: string;
  readonly payloadJson: string;
  readonly bytes: number;
  readonly openDocumentId: string | undefined;
  readonly requestId: string;
  /** The ALS command context, captured at enqueue: the worker fiber does not inherit it. */
  readonly command: string | undefined;
  readonly reply: Deferred.Deferred<BridgeResponse, BridgeError>;
  readonly result: Deferred.Deferred<JobAnswer, BridgeError | NoRevitSession>;
  readonly terminal: Deferred.Deferred<NativeOutcome>;
  readonly state: Ref.Ref<JobState>;
  /**
   * Set when the caller's answer fails but Revit may still own the dispatch: the request stays
   * tracked under this reply, and the worker holds the slot (see `reconcile`).
   */
  readonly owed: Ref.Ref<Deferred.Deferred<BridgeResponse, BridgeError> | null>;
  readonly depth: number;
  readonly queuedAt: number;
};

export const DispatchLimits = Context.Reference<{ entries: number; itemBytes: number }>(
  "DispatchLimits",
  {
    defaultValue: () => ({ entries: 8, itemBytes: 8 * 1024 * 1024 }),
  },
);
/** Revoked ids awaiting a request that may never queue; the oldest fall off past this. */
const MAX_REVOKED_BEFORE_QUEUE = 1024;

/**
 * One live request. `queued` = the host holds it in the line and Revit has never seen it;
 * `dispatched` = Revit owns it; `cancelled` = a cancel reached it before dispatch, so the worker
 * drops it instead of sending it.
 */
export type BridgeRequest = {
  readonly operationKey: string;
  readonly reply: Deferred.Deferred<BridgeResponse, BridgeError>;
  readonly requestId: string;
  readonly phase: "queued" | "dispatched" | "cancelled";
  readonly terminal?: Deferred.Deferred<NativeOutcome>;
  /** The connection epoch a dispatched request went out on. */
  readonly epoch?: number;
};

/**
 * Process-death evidence for a session in reconciliation. The default asks the OS whether the pid
 * exists (signal 0); EPERM means it exists. Ceiling: pid reuse inside one reconciliation would
 * read as alive, which holds the slot (never releases it early).
 */
export const RevitProcessAlive = Context.Reference<(processId: number) => boolean>(
  "RevitProcessAlive",
  {
    defaultValue: () => (processId) => {
      try {
        process.kill(processId, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    },
  },
);

/** How often a session in reconciliation looks for death evidence. Not a release timer. */
const DEATH_PROBE_INTERVAL = "1 second";

/** The op that must never wait behind the op it names. */
export const CANCEL_OPERATION_KEY = "op.cancel";

export type BridgeEvidence = DoorEvidence & {
  /** Opaque: bridge.ts reads only `code` and `instancePath` (see rootOutcome). */
  readonly issues?: ReadonlyArray<ValidationIssue> | null;
  readonly nativeOutcome?: string;
  /** Revit never saw the request. */
  readonly notDispatched?: true;
  /** Revit answered the request with a settled verdict, so its outcome is known. */
  readonly dispatched?: true;
  readonly result?: unknown;
  readonly resolvedTarget?: { readonly session: string; readonly document: string | null };
};

/** Native outcomes in which Revit refused the request before running it. */
const REFUSED_OUTCOMES = new Set([
  "CancelledBeforeDispatch",
  "RefusedQueueUnresponsive",
  "RefusedQueueDisposed",
]);

const nativeOutcomes = {
  "never-dispatched": true,
  "native-cancel-requested": true,
  "native-acknowledged": true,
  committed: true,
  "unknown-until-reconciled": true,
} satisfies Record<NativeOutcome, true>;
const nativeOutcomeSchema = Schema.declare<NativeOutcome>(
  (value): value is NativeOutcome =>
    typeof value === "string" && Object.hasOwn(nativeOutcomes, value),
);

/** A bridge operation failed on the Revit side (statusCode mirrors the C# BridgeOperationException). */
export class BridgeError
  extends Schema.TaggedError<BridgeError>()("BridgeError", {
    message: Schema.String,

    evidence: Schema.Any,
    status: Schema.Number,
    problem: Schema.String,
    nativeOutcome: Schema.optionalKey(nativeOutcomeSchema),
  })
  implements FrozenBridgeError
{
  declare readonly evidence: BridgeEvidence;
  constructor(
    fields: Pick<
      FrozenBridgeError,
      "message" | "status" | "problem" | "evidence" | "nativeOutcome"
    >,
  );
  constructor(message: string, status: number, evidence?: BridgeEvidence);
  constructor(
    fields:
      | string
      | Pick<FrozenBridgeError, "message" | "status" | "problem" | "evidence" | "nativeOutcome">,
    status = 503,
    evidence: BridgeEvidence = {},
  ) {
    if (typeof fields !== "string") {
      super({ ...fields, evidence: fields.evidence ?? {} });
      return;
    }
    const code = evidence.nativeOutcome ?? rootOutcome(evidence.issues);
    super({
      message: fields,
      status,
      evidence,
      problem: "bridge",
      nativeOutcome:
        evidence.notDispatched || REFUSED_OUTCOMES.has(code ?? "")
          ? "never-dispatched"
          : evidence.dispatched
            ? "native-acknowledged"
            : "unknown-until-reconciled",
    });
  }
  get statusCode() {
    return this.status;
  }
  get nativeCode(): string | undefined {
    return this.evidence.nativeOutcome ?? rootOutcome(this.evidence.issues);
  }
  /** What happened to the action, decided from typed fields only, never from message text. */
  get outcome(): "refused" | "cancelled" | "failed" | "unknown" {
    if (this.evidence.notDispatched || REFUSED_OUTCOMES.has(this.nativeCode ?? ""))
      return "refused";
    if (!this.evidence.dispatched) return "unknown";
    return this.statusCode === 499 ? "cancelled" : "failed";
  }
}

/** BridgeAgent emits one root issue for a RevitTaskOutcome or a typed refusal; preserve unknown future codes. */
const rootOutcome = (issues: ReadonlyArray<ValidationIssue> | null | undefined) =>
  issues?.length === 1 && issues[0]?.instancePath === "$" ? issues[0].code : undefined;

/**
 * Answers after which Revit still owes an outcome for the request: the add-in sends a Terminal frame
 * for that id once the native work really finishes. Every other answer is settled.
 */
const UNSETTLED_OUTCOMES = new Set(["AbandonedStillRunning", "TimedOut"]);
const isUnsettled = (res: BridgeResponse) =>
  !res.ok && UNSETTLED_OUTCOMES.has(rootOutcome(res.issues) ?? "");

const responseOutcome = (response: BridgeResponse): NativeOutcome =>
  REFUSED_OUTCOMES.has(rootOutcome(response.issues) ?? "")
    ? "never-dispatched"
    : "native-acknowledged";

/** A Terminal settled the request but carries no payload: the caller cannot get the value. */
const SETTLED_WITHOUT_PAYLOAD = "TerminalSucceeded";

/**
 * A Terminal frame as the settled answer its request's reply expects. Failed and Cancelled read as
 * ordinary dispatched answers; Succeeded carries no payload, so it gets its own root code.
 */
const terminalResponse = (terminal: BridgeTerminal): BridgeResponse => {
  const code = `Terminal${terminal.outcome}`;
  const message = `Revit finished this request after answering it (${terminal.outcome}); no payload was returned.`;
  return {
    requestId: terminal.requestId,
    ok: false,
    payloadJson: null,
    openDocumentId: null,
    errorMessage: message,
    statusCode: terminal.outcome === "Cancelled" ? 499 : terminal.outcome === "Failed" ? 500 : 502,
    issues: [
      { instancePath: "$", code, message, severity: "error", schemaPath: null, suggestion: null },
    ],
    metrics: {
      requestBytes: 0,
      responseBytes: 0,
      revitExecutionMs: terminal.completedAtUnixMs - terminal.startedAtUnixMs,
      roundTripMs: 0,
      serializationMs: 0,
    },
  };
};

/** No attached Revit answers what was asked: `asked` names it, `attached` lists what is there. */
export class NoRevitSession
  extends Schema.TaggedError<NoRevitSession>()("NoRevitSession", {
    message: Schema.String,
    status: Schema.Number,
    problem: Schema.String,
    evidence: Schema.optionalKey(Schema.Any),
    nativeOutcome: Schema.optionalKey(nativeOutcomeSchema),
    asked: Schema.optionalKey(Schema.String),
    attached: Schema.optionalKey(Schema.Array(Schema.String)),
  })
  implements FrozenNoRevitSession
{
  constructor(
    fields: Partial<
      Pick<FrozenNoRevitSession, "message" | "status" | "problem" | "evidence" | "nativeOutcome">
    > & { asked?: string; attached?: readonly string[] } = {},
  ) {
    super({
      message: "No Revit session is connected to the bridge.",
      status: 503,
      problem: "no-revit-session",
      ...fields,
    });
  }
}

const decodePayloadJson = Effect.fn("Dispatcher.decodePayloadJson")(function* (
  payloadJson: string | null | undefined,
) {
  if (!payloadJson) return null;
  return yield* Effect.try({
    try: () => JSON.parse(payloadJson) as unknown,
    catch: (error) => new BridgeError(String(error), 502),
  });
});

const encodePayloadJson = Effect.fn("Dispatcher.encodePayloadJson")(function* (payload: unknown) {
  return yield* Effect.try({
    try: () => JSON.stringify(payload ?? {}),
    catch: (error) => new BridgeError(String(error), 400, { notDispatched: true }),
  });
});

/** Records one request under its wire id; a later phase for the same id replaces the earlier one. */
const trackBridgeRequest = (
  requests: Ref.Ref<ReadonlyMap<string, BridgeRequest>>,
  request: BridgeRequest,
) => Ref.update(requests, (live) => new Map(live).set(request.requestId, request));

const forgetBridgeRequest = (
  requests: Ref.Ref<ReadonlyMap<string, BridgeRequest>>,
  requestId: string,
) =>
  Ref.update(requests, (live) => {
    const next = new Map(live);
    next.delete(requestId);
    return next;
  });

/** Routes one Response frame to the request that carries its id. */
export const completeBridgeRequest = Effect.fn("Dispatcher.completeBridgeRequest")(function* (
  requests: Ref.Ref<ReadonlyMap<string, BridgeRequest>>,
  response: BridgeResponse,
  epoch: number,
) {
  const request = (yield* Ref.get(requests)).get(response.requestId);
  if (!request) {
    yield* Effect.logWarning(
      `bridge response for an unknown requestId: received=${response.requestId}`,
    );
    return false;
  }
  if (request.epoch !== undefined && request.epoch !== epoch)
    yield* Effect.logInfo(
      `bridge response for ${response.requestId} arrived on epoch ${epoch}; dispatched on epoch ${request.epoch}`,
    );
  if (request.phase !== "dispatched") return false;
  if (request.terminal && !isUnsettled(response))
    yield* Deferred.succeed(request.terminal, responseOutcome(response));
  yield* Deferred.succeed(request.reply, response);
  return true;
});

export const makeDispatcher = (ports: DispatchPorts) =>
  Effect.gen(function* () {
    const limits = yield* DispatchLimits;
    if (
      !Number.isSafeInteger(limits.entries) ||
      limits.entries < 1 ||
      !Number.isSafeInteger(limits.itemBytes) ||
      limits.itemBytes < 1
    )
      return yield* Effect.die(new Error("Dispatcher bounds must be positive safe integers"));
    const bridgeScope = yield* Effect.scope;
    const processAlive = yield* RevitProcessAlive;
    const sessions = yield* Ref.make(new Map<string, Session>());
    yield* Effect.addFinalizer(() => Ref.set(sessions, new Map()));
    /** A session is targetable only while a transport is attached. */
    const attached = Effect.fn("Dispatcher.attached")(function* (
      bridgeSessionId: string | undefined,
    ) {
      const session = bridgeSessionId ? (yield* Ref.get(sessions)).get(bridgeSessionId) : undefined;
      const connection = session ? yield* Ref.get(session.connection) : null;
      return session && connection ? { session, connection } : undefined;
    });

    /** Ends a session: its line fails unsent, and its id leaves the registry (if still its own). */
    const retireSession = Effect.fn("Dispatcher.retireSession")(function* (
      session: Session,
      reason: string,
    ) {
      yield* closeLine(session, reason);
      yield* Ref.update(sessions, (current) => {
        if (current.get(session.sessionId) !== session) return current;
        const next = new Map(current);
        next.delete(session.sessionId);
        return next;
      });
    });

    const hasDispatched = (session: Session) =>
      Effect.map(Ref.get(session.requests), (requests) =>
        [...requests.values()].some((request) => request.phase === "dispatched"),
      );

    /** After a request settles: a session whose transport is gone and owes no answer retires. */
    const settleLoss = Effect.fn("Dispatcher.settleLoss")(function* (session: Session) {
      if ((yield* Ref.get(session.connection)) !== null) return;
      if (yield* hasDispatched(session)) return;
      yield* retireSession(session, "Revit bridge disconnected before this request reached it.");
    });

    /**
     * Fails only on process-death evidence while the transport is lost. Reconciliation ends on
     * evidence, never on elapsed time: this loop looks every DEATH_PROBE_INTERVAL and releases
     * nothing while the process lives.
     */
    const processDeath = (
      session: Session,
      operationKey: string,
      terminal?: Deferred.Deferred<NativeOutcome>,
    ) =>
      Effect.gen(function* () {
        while (true) {
          if ((yield* Ref.get(session.connection)) === null && !processAlive(session.processId)) {
            if (terminal) yield* Deferred.succeed(terminal, "unknown-until-reconciled");
            return yield* Effect.fail(
              new BridgeError(
                `Revit process ${session.processId} exited before answering '${operationKey}'; its outcome is unknown.`,
                503,
              ),
            );
          }
          yield* Effect.sleep(DEATH_PROBE_INTERVAL);
        }
      }).pipe(
        Effect.raceFirst(
          Effect.andThen(
            Deferred.await(session.ended).pipe(
              Effect.andThen(
                terminal ? Deferred.succeed(terminal, "unknown-until-reconciled") : Effect.void,
              ),
            ),
            Effect.fail(
              new BridgeError(
                `Revit process ${session.processId} was replaced by a new incarnation before answering '${operationKey}'; its outcome is unknown.`,
                503,
              ),
            ),
          ),
        ),
      );

    /** A newer incarnation registered: the old one is dead, so its jobs settle `unknown` now. */
    const endIncarnation = Effect.fn("Dispatcher.endIncarnation")(function* (session: Session) {
      // Close the line before waking the worker, so waiting jobs are refused unsent, not taken.
      yield* Ref.set(session.connection, null);
      yield* retireSession(
        session,
        "The Revit process incarnation ended before this request reached it.",
      );
      yield* Deferred.succeed(session.ended, undefined);
    });

    /**
     * Terminal evidence for one request id, from a Terminal frame or a registration replay. It
     * completes the request's current reply, so a reconciling worker ends and releases the slot.
     * Settles once: an id already released, or never known, is ignored (duplicates are legal).
     */
    const settleTerminal = Effect.fn("Dispatcher.settleTerminal")(function* (
      session: Session,
      terminal: BridgeTerminal,
    ) {
      const settled = terminalResponse(terminal);
      while (true) {
        const request = (yield* Ref.get(session.requests)).get(terminal.requestId);
        if (request?.phase !== "dispatched") {
          yield* Effect.logInfo(
            `bridge terminal for ${terminal.requestId} ignored: no dispatched request holds it`,
          );
          return;
        }
        if (request.terminal) yield* Deferred.succeed(request.terminal, responseOutcome(settled));
        if (yield* Deferred.succeed(request.reply, settled)) return;
        // The reply already holds the unsettled answer and its worker has not re-armed yet: arm the
        // next answer, unless the worker won. On effect 4.0.2 the worker re-arms before the next
        // frame of the same socket batch decodes (the batch test passes without this branch), so it
        // only guards against a scheduler order change, which would otherwise strand the slot.
        const next = yield* Deferred.make<BridgeResponse, BridgeError>();
        yield* Deferred.succeed(next, settled);
        const armed = yield* Ref.modify(session.requests, (live) => {
          const current = live.get(terminal.requestId);
          return current?.reply === request.reply
            ? ([true, new Map(live).set(terminal.requestId, { ...current, reply: next })] as const)
            : ([false, live] as const);
        });
        if (armed) return;
      }
    });

    let revocation: Effect.Effect<void, BridgeError> = Effect.void;

    const invokeSession = Effect.fn("Dispatcher.invokeSession")(function* (
      session: Session,
      operationKey: string,
      payload: unknown,
      openDocumentId: string | undefined,
      command: string | undefined,
      requestId = randomUUID(),
      // Set for a line job: its reply is reserved before it queues, so a cancel can fail it
      // before dispatch; out-of-line ops (op.cancel) pass none.
      job?: Job,
    ) {
      const reserved = job?.reply;
      const owed = job?.owed;
      const provenanceRefusal = ports.commandLeafRefusal(operationKey, command);
      if (provenanceRefusal)
        return yield* Effect.fail(new BridgeError(provenanceRefusal, 403, { notDispatched: true }));
      const reply = reserved ?? (yield* Deferred.make<BridgeResponse, BridgeError>());
      let dispatchedOn: Connection | undefined;
      // A revoke fences dispatch synchronously, before its asynchronous journal census answers.
      // Checking that fence and changing the request phase are one atomic decision.
      while (true) {
        const fence = revocation;
        if (reserved) yield* fence;
        if (reserved) {
          const live = (yield* Ref.get(sessions)).get(session.sessionId);
          if (live !== session || !(yield* Ref.get(session.connection)))
            return yield* Effect.fail(new NoRevitSession());
          const state = yield* Ref.get(session.state);
          if (openDocumentId && !state.openDocuments.some((doc) => doc.openId === openDocumentId))
            return yield* Effect.fail(
              new BridgeError("The selected document lifetime closed before dispatch", 409, {
                notDispatched: true,
              }),
            );
        }
        if (reserved) {
          const invalid = yield* Effect.promise(() => ports.bridgeValidateDispatch(requestId));
          if (invalid)
            return yield* Effect.fail(
              new BridgeError(invalid.message, invalid.kind === "cancelled" ? 499 : 409, {
                notDispatched: true,
              }),
            );
        }
        // Dispatch is fenced by incarnation (this session object) and connection epoch: the
        // request records the epoch it goes out on, read in the same step that marks it dispatched.
        const connection = yield* Ref.get(session.connection);
        if (!connection) return yield* Effect.fail(new NoRevitSession());
        const phase = yield* Ref.modify(
          session.requests,
          (
            requests,
          ): readonly [
            "cancelled" | "waiting" | "dispatched" | { refusal: DispatchRefusal },
            ReadonlyMap<string, BridgeRequest>,
          ] => {
            if (requests.get(requestId)?.phase === "cancelled")
              return ["cancelled", requests] as const;
            if (reserved && fence !== revocation) return ["waiting", requests] as const;
            const refusal = reserved ? ports.bridgeDispatchRefusal(requestId) : null;
            if (refusal) return [{ refusal }, requests] as const;
            const next = new Map(requests);
            next.set(requestId, {
              operationKey,
              requestId,
              reply,
              phase: "dispatched",
              terminal: job?.terminal,
              epoch: connection.epoch,
            });
            return ["dispatched", next] as const;
          },
        );
        if (phase === "dispatched") {
          dispatchedOn = connection;
          break;
        }
        if (typeof phase !== "string")
          return yield* Effect.fail(
            new BridgeError(phase.refusal.message, phase.refusal.kind === "cancelled" ? 499 : 403, {
              notDispatched: true,
            }),
          );
        if (phase === "cancelled")
          return yield* Effect.fail(
            new BridgeError(`'${operationKey}' was cancelled before dispatch.`, 499, {
              notDispatched: true,
              nativeOutcome: "CancelledBeforeDispatch",
            }),
          );
      }
      return yield* Effect.gen(function* () {
        const payloadJson = job?.payloadJson ?? (yield* encodePayloadJson(payload));
        // From here a Request frame may be on the wire: a stopped worker reports `unknown`.
        if (job) yield* Ref.set(job.state, "sent");
        const delivered = yield* Effect.exit(
          dispatchedOn!.send({
            kind: "Request",
            request: {
              requestId,
              operationKey,
              payloadJson,
              openDocumentId,
              derivedCommand: command,
            },
          }),
        );
        if (Exit.isFailure(delivered)) {
          // A failed write may still have reached Revit: the caller gets `unknown`, and the
          // still-tracked request keeps its reply for a late answer from any socket.
          if (owed) yield* Ref.set(owed, reply);
          return yield* Effect.fail(
            new BridgeError(
              `Sending '${operationKey}' to Revit failed; it may have been delivered, so its outcome is unknown.`,
              503,
            ),
          );
        }
        if (owed) yield* Ref.set(owed, reply);
        if (reserved)
          yield* Effect.tryPromise({
            try: () => ports.markBridgeDispatched(requestId),
            catch: () =>
              new BridgeError("Dispatched; the journal did not record it", 503, {
                dispatched: true,
              }),
          });
        // The slot is released by Revit's answer to THIS request (from any socket of the
        // session) or by process death; never by a reconnect, a timer, or a cancel's acceptance.
        // Only host stop interrupts the worker mid-op (a leaving waiter never does).
        const res = yield* Deferred.await(reply).pipe(
          Effect.raceFirst(processDeath(session, operationKey, job?.terminal)),
          Effect.onInterrupt(() =>
            reserved ? cancelInFlight(session, requestId, reply) : Effect.void,
          ),
        );
        if (owed && !isUnsettled(res)) yield* Ref.set(owed, null);
        if (!res.ok) {
          const state = yield* Ref.get(session.state);
          const targetOpenId = res.openDocumentId ?? openDocumentId;
          const unsettled = isUnsettled(res);
          // Rule 11: the caller's answer fails now, but the native dispatch stays occupied.
          if (unsettled && owed) yield* Ref.set(owed, yield* awaitAgain(session, requestId, reply));
          return yield* Effect.fail(
            new BridgeError(res.errorMessage ?? `${operationKey} failed`, res.statusCode ?? 500, {
              issues: res.issues,
              // A refusal is an answer, not a lost reply: it must never leave the action unknown.
              // A payload-less Terminal settled the op, but its value is lost: unknown here too.
              ...(unsettled || rootOutcome(res.issues) === SETTLED_WITHOUT_PAYLOAD
                ? {}
                : { dispatched: true as const }),
              resolvedTarget: {
                session: session.sessionId,
                document: targetOpenId
                  ? (state.openDocuments.find((document) => document.openId === targetOpenId)
                      ?.address ?? null)
                  : null,
              },
            }),
          );
        }
        return {
          value: yield* decodePayloadJson(res.payloadJson),
          openDocumentId: res.openDocumentId,
        };
      }).pipe(
        Effect.ensuring(
          Effect.flatMap(owed ? Ref.get(owed) : Effect.succeed(null), (pending) =>
            pending ? Effect.void : releaseRequest(session, requestId),
          ),
        ),
      );
    });

    const releaseRequest = (session: Session, requestId: string) =>
      Effect.andThen(forgetBridgeRequest(session.requests, requestId), settleLoss(session));

    /**
     * Re-arms a dispatched request with a fresh reply, so its next answer has somewhere to land.
     * A Terminal that arrived first already armed one (see `settleTerminal`): that one is returned.
     */
    const awaitAgain = Effect.fn("Dispatcher.awaitAgain")(function* (
      session: Session,
      requestId: string,
      previous: Deferred.Deferred<BridgeResponse, BridgeError>,
    ) {
      const fresh = yield* Deferred.make<BridgeResponse, BridgeError>();
      return yield* Ref.modify(session.requests, (live) => {
        const request = live.get(requestId);
        if (request && request.reply !== previous) return [request.reply, live] as const;
        return request
          ? ([fresh, new Map(live).set(requestId, { ...request, reply: fresh })] as const)
          : ([fresh, live] as const);
      });
    });

    /**
     * Holds the serial slot after the caller already has its `unknown` answer: the worker waits for
     * terminal evidence for THIS request id or process death. Terminal evidence is a settled
     * Response on any socket, a Terminal frame, or a Terminal replayed in Registration.inFlight
     * (all via `settleTerminal`). No timer releases it, and the host polls no receipt.
     * Host and add-in ship in lockstep (the exact contract version gate refuses a mismatch at
     * registration), so no fallback exists for an add-in that never sends Terminal frames.
     */
    const reconcile = (session: Session, job: Job): Effect.Effect<void> =>
      Effect.flatMap(Ref.get(job.owed), (first) =>
        first ? reconcileFrom(session, job, first) : Effect.void,
      );

    const reconcileFrom = (
      session: Session,
      job: Job,
      first: Deferred.Deferred<BridgeResponse, BridgeError>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        let reply: Deferred.Deferred<BridgeResponse, BridgeError> | null = first;
        yield* Effect.logWarning(
          `Revit queue reconciling op=${job.operationKey} request=${job.requestId} session=${session.sessionId}: holding the slot until terminal evidence`,
        );
        while (reply) {
          const settled: Deferred.Deferred<BridgeResponse, BridgeError> = reply;
          const evidence: Exit.Exit<BridgeResponse, BridgeError> = yield* Deferred.await(
            settled,
          ).pipe(
            Effect.raceFirst(processDeath(session, job.operationKey, job.terminal)),
            Effect.onInterrupt(() => cancelInFlight(session, job.requestId, settled)),
            Effect.exit,
          );
          reply =
            Exit.isSuccess(evidence) && isUnsettled(evidence.value)
              ? yield* awaitAgain(session, job.requestId, settled)
              : null;
          if (!reply)
            yield* Effect.logInfo(
              `Revit queue reconciled op=${job.operationKey} request=${job.requestId} outcome=${
                Exit.isSuccess(evidence)
                  ? evidence.value.ok
                    ? "ok"
                    : (rootOutcome(evidence.value.issues) ?? "failed")
                  : "unknown"
              }`,
            );
        }
      }).pipe(Effect.ensuring(releaseRequest(session, job.requestId)));

    // Ids a revoke named before their request reached this registry: a begun step may still be
    // validating when the revoke lands. Such a request is refused the moment it queues.
    // Bounded: an id a revoke names that never queues would otherwise live as long as the host.
    const revokedBeforeQueue = new Set<string>();
    const rememberRevoked = (requestId: string) => {
      revokedBeforeQueue.add(requestId);
      for (const oldest of revokedBeforeQueue) {
        if (revokedBeforeQueue.size <= MAX_REVOKED_BEFORE_QUEUE) break;
        revokedBeforeQueue.delete(oldest);
      }
    };

    const cancelQueuedRequest = Effect.fn("Dispatcher.cancelQueuedRequest")(function* (
      requestId: string,
    ) {
      let known = false;
      for (const session of (yield* Ref.get(sessions)).values()) {
        const cancelled = yield* Ref.modify(session.requests, (requests) => {
          const request = requests.get(requestId);
          if (request?.phase !== "queued") return [false, requests] as const;
          const next = new Map(requests);
          next.set(requestId, { ...request, phase: "cancelled" });
          return [true, next] as const;
        });
        if (cancelled) {
          const jobs = yield* Effect.sync(() => {
            const all: Job[] = [];
            for (let n = Queue.sizeUnsafe(session.line); n > 0; n--) {
              const next = Queue.takeUnsafe(session.line);
              if (next && Exit.isSuccess(next)) all.push(next.value);
            }
            Queue.offerAllUnsafe(session.line, all);
            return all;
          });
          const job = jobs.find((job) => job.requestId === requestId);
          if (job) {
            yield* Deferred.fail(
              job.result,
              new BridgeError("Cancelled before dispatch", 499, { notDispatched: true }),
            );
            yield* leave(session, job);
          }
          return true;
        }
        known ||= (yield* Ref.get(session.requests)).has(requestId);
      }
      if (!known) rememberRevoked(requestId);
      return false;
    });

    const cancelQueued = (requestIds: Effect.Effect<readonly string[], BridgeError>) =>
      Effect.gen(function* () {
        const previous = revocation;
        const settled = yield* Deferred.make<void, BridgeError>();
        revocation = Deferred.await(settled);
        return yield* Effect.gen(function* () {
          yield* previous;
          const ids = yield* requestIds;
          for (const id of ids) yield* cancelQueuedRequest(id);
        }).pipe(Effect.onExit((exit) => Deferred.done(settled, exit)));
      });

    /**
     * The whole point of cancel: it never takes a place in the session's line, so it reaches Revit
     * while the op it names is still running there. Returns null when no connected session owns
     * the id, so the caller falls through to ordinary targeting and Revit answers the refusal.
     */
    const cancelRequest = Effect.fn("Dispatcher.cancelRequest")(function* (requestId: string) {
      for (const session of (yield* Ref.get(sessions)).values()) {
        const request = (yield* Ref.get(session.requests)).get(requestId);
        if (!request) continue;
        const target = {
          session: session.sessionId,
          document: null,
        };
        if (request.phase === "dispatched") {
          const result = yield* invokeSession(
            session,
            CANCEL_OPERATION_KEY,
            { requestId },
            undefined,
            ports.command(),
          );
          return { value: result.value, target };
        }
        // Still in the line: mark it and let the worker drop it. Revit never sees it at all.
        yield* cancelQueuedRequest(requestId);
        return {
          value: {
            cancelled: true,
            requestId,
            message: `Request '${requestId}' had not reached Revit; it will not be dispatched.`,
          },
          target,
        };
      }
      return null;
    });

    const invoke = Effect.fn("Dispatcher.invoke")(function* (
      operationKey: string,
      payload: unknown,
      bridgeSessionId?: string,
      openDocumentId?: string | null,
      requestId?: string,
    ) {
      // The SDK adapter supplies one exact attachment. Census goes through `list`.
      // `op.cancel` is the exception in two ways: the request it names picks the session (an
      // untargeted cancel must work while several sessions are connected), and it NEVER queues —
      // waiting behind the op it is meant to stop is the whole bug it exists to fix.
      if (operationKey === CANCEL_OPERATION_KEY) {
        const named = (payload as { requestId?: unknown } | null)?.requestId;
        const known = typeof named === "string" ? yield* cancelRequest(named) : null;
        if (known) return known;
      }
      // New work targets only an attached session; a session in reconciliation takes none.
      const session = (yield* attached(bridgeSessionId))?.session;
      if (!session) return yield* Effect.fail(new NoRevitSession());

      // An id this host never queued: let Revit answer for it, but still outside the line.
      if (operationKey === CANCEL_OPERATION_KEY) {
        const result = yield* invokeSession(
          session,
          operationKey,
          payload,
          undefined,
          ports.command(),
        );
        return {
          value: result.value,
          target: { session: session.sessionId, document: null },
        };
      }

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.flatMap(
          enqueue(session, operationKey, payload, openDocumentId, requestId),
          (handle) => restore(handle.answer),
        ),
      );
    });

    const enqueue = Effect.fn("Dispatcher.enqueue")(function* (
      session: Session,
      operationKey: string,
      payload: unknown,
      openDocumentId?: string | null,
      requestId?: string,
    ) {
      const state = yield* Ref.get(session.state);
      const selectedDocument =
        openDocumentId === null
          ? undefined
          : (openDocumentId ?? state.openDocuments.find((document) => document.isActive)?.openId);

      // Interruption-safe enqueue: nothing below allocates a place (depth, request, job) before
      // `leave` is installed to retire it, and the waiter is interruptible only while it waits.
      const command = ports.command();
      const wireId = requestId ?? randomUUID();
      const handle = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          for (const actor of (yield* Ref.get(sessions)).values())
            if ((yield* Ref.get(actor.requests)).has(wireId))
              return yield* Effect.fail(
                new BridgeError("Duplicate native request id", 409, { notDispatched: true }),
              );
          const payloadJson = yield* encodePayloadJson(payload);
          const bytes =
            Buffer.byteLength(payloadJson) +
            Buffer.byteLength(operationKey) +
            Buffer.byteLength(wireId) +
            Buffer.byteLength(selectedDocument ?? "") +
            Buffer.byteLength(command ?? "");
          if (bytes > limits.itemBytes)
            return yield* Effect.fail(
              new BridgeError("Native dispatch item exceeds its byte bound", 413, {
                notDispatched: true,
              }),
            );
          const depth = yield* Ref.updateAndGet(session.depth, (n) => n + 1);
          if (depth > limits.entries) {
            yield* Ref.update(session.depth, (n) => n - 1);
            return yield* Effect.fail(
              new BridgeError(
                `Revit queue is full (${limits.entries} waiting). Retry '${operationKey}' shortly.`,
                423,
                { notDispatched: true },
              ),
            );
          }
          const job: Job = {
            operationKey,
            payloadJson,
            bytes,
            openDocumentId: selectedDocument,
            requestId: wireId,
            command,
            reply: yield* Deferred.make<BridgeResponse, BridgeError>(),
            result: yield* Deferred.make<JobAnswer, BridgeError | NoRevitSession>(),
            terminal: yield* Deferred.make<NativeOutcome>(),
            state: yield* Ref.make<JobState>("queued"),
            owed: yield* Ref.make<Deferred.Deferred<BridgeResponse, BridgeError> | null>(null),
            depth,
            queuedAt: yield* Clock.currentTimeMillis,
          };
          // Reserve the request under its wire id BEFORE queueing, so a cancel that arrives while
          // it waits has something to name (and something to fail) instead of a 404.
          yield* trackBridgeRequest(session.requests, {
            operationKey,
            requestId: wireId,
            reply: job.reply,
            terminal: job.terminal,
            phase: revokedBeforeQueue.delete(wireId) ? "cancelled" : "queued",
          });
          return yield* Effect.gen(function* () {
            // Depth includes this op; a contended enqueue stays visible even if it never starts.
            if (depth > 1)
              yield* restore(
                Effect.promise(() =>
                  ports
                    .recordBridgeQueue(operationKey, wireId, session.sessionId, "queued", depth)
                    .catch((error) => {
                      console.error("Queue receipt persistence failed", error);
                    }),
                ),
              );
            yield* Effect.logInfo(
              `Revit queue queued op=${operationKey} session=${session.sessionId} depth=${depth}`,
            );
            if (!(yield* Queue.offer(session.line, job)))
              return yield* Effect.fail(new NoRevitSession());
            return {
              answer: Deferred.await(job.result).pipe(Effect.ensuring(leave(session, job))),
              terminal: Deferred.await(job.terminal),
              nativeRequestId: wireId,
            };
          }).pipe(
            Effect.onExit((exit) => (Exit.isFailure(exit) ? leave(session, job) : Effect.void)),
          );
        }),
      );
      return {
        terminal: handle.terminal,
        nativeRequestId: handle.nativeRequestId,
        answer: Effect.map(handle.answer, (result) => ({
          value: result.value,
          target: {
            session: session.sessionId,
            // The native reply confirms the execution lifetime. Never fill it from a selector or census.
            ...(result.openDocumentId
              ? { documentRef: { session: session.sessionId, openId: result.openDocumentId } }
              : {}),
            document:
              state.openDocuments.find((document) => document.openId === result.openDocumentId)
                ?.address ?? null,
          },
        })),
      };
    });

    /** Cancel uses invoke(op.cancel), which bypasses the line and never becomes a queued job. */
    const invokeHandle = Effect.fn("Dispatcher.invokeHandle")(function* (
      operationKey: string,
      payload: unknown,
      bridgeSessionId?: string,
      openDocumentId?: string | null,
      requestId?: string,
    ) {
      if (operationKey === CANCEL_OPERATION_KEY)
        return yield* Effect.fail(
          new BridgeError("Use invoke for out-of-band cancellation", 400, { notDispatched: true }),
        );
      const session = (yield* attached(bridgeSessionId))?.session;
      if (!session) return yield* Effect.fail(new NoRevitSession());
      const handle = yield* enqueue(session, operationKey, payload, openDocumentId, requestId);
      return {
        terminal: handle.terminal,
        answer: Effect.map(handle.answer, (result) => ({
          value: result.value,
          nativeRequestId: handle.nativeRequestId,
          actualTarget: {
            processIncarnation: {
              pid: session.processId,
              startedAt: session.processStartUtcUnixMs!,
            },
            openDocumentLifetime: result.target.documentRef
              ? { openId: result.target.documentRef.openId }
              : { kind: "session-only" as const },
          },
          freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" as const },
          cost: {},
          outcome: "native-acknowledged" as const,
        })),
      } satisfies NativeDispatchHandle;
    });

    /** Gives back a job's place: its request id and its depth. Called once, by whoever retires it. */
    const retire = (session: Session, job: Job) =>
      Effect.gen(function* () {
        if ((yield* Ref.get(job.state)) !== "sent")
          yield* Deferred.succeed(job.terminal, "never-dispatched");
        else yield* Deferred.interrupt(job.terminal);
        yield* forgetBridgeRequest(session.requests, job.requestId);
        yield* Ref.update(session.depth, (n) => n - 1);
      });

    /** Claims a job still waiting; false when the worker or another leaver got there first. */
    const claimQueued = (job: Job) =>
      Ref.modify(job.state, (state) =>
        state === "queued" ? ([true, "left"] as const) : ([false, state] as const),
      );

    /**
     * A waiter that leaves before its turn takes itself out of the line, and nothing else. Its Job
     * (payload, deferreds) leaves the physical Queue too, so retained bytes follow live waiters:
     * the bound is limits.entries jobs, each holding one payload no larger than the request body
     * the route admitted. Effect's Queue has no remove, so this rotates the buffer in one
     * synchronous step (no fiber can offer or take in between, so FIFO holds); n <= limits.entries.
     */
    const leave = Effect.fn("Dispatcher.leave")(function* (session: Session, job: Job) {
      if (!(yield* claimQueued(job))) return;
      yield* Deferred.fail(
        job.result,
        new BridgeError("Waiter left before dispatch", 499, { notDispatched: true }),
      );
      const refused = yield* Effect.sync(() => {
        const kept: Job[] = [];
        for (let n = Queue.sizeUnsafe(session.line); n > 0; n--) {
          const next = Queue.takeUnsafe(session.line);
          if (next && Exit.isSuccess(next) && next.value !== job) kept.push(next.value);
        }
        return Queue.offerAllUnsafe(session.line, kept);
      });
      yield* retire(session, job);
      // A line that closed meanwhile refuses the rotation: settle those as closeLine would.
      for (const other of refused) {
        if (!(yield* claimQueued(other))) continue;
        yield* Deferred.fail(
          other.result,
          new BridgeError("The Revit bridge line closed before this request reached it.", 503, {
            notDispatched: true,
          }),
        );
        yield* retire(session, other);
      }
    });

    /**
     * Runs one job to Revit's answer. A job whose waiter left is dropped here, unsent. Called
     * uninterruptibly right after the take: settlement and release are installed before the first
     * suspension, and only `restore` regions (journal, invocation, reconciliation) can be stopped.
     * A stopped job settles typed: `unknown` once a Request frame may be out, else refused unsent.
     */
    const runJob = (
      session: Session,
      job: Job,
      restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
    ) =>
      Effect.gen(function* () {
        const started = yield* Ref.modify(job.state, (state) =>
          state === "queued" ? ([true, "running"] as const) : ([false, state] as const),
        );
        if (!started) return;
        yield* restore(
          Effect.gen(function* () {
            const startedAt = yield* Clock.currentTimeMillis;
            yield* Effect.promise(() =>
              ports
                .recordBridgeQueue(
                  job.operationKey,
                  job.requestId,
                  session.sessionId,
                  "started",
                  job.depth,
                  startedAt - job.queuedAt,
                )
                .catch((error) => {
                  console.error("Queue receipt persistence failed", error);
                }),
            );
            yield* Effect.logInfo(
              `Revit queue started op=${job.operationKey} session=${session.sessionId} depth=${job.depth} wait_ms=${startedAt - job.queuedAt}`,
            );
            const exit = yield* Effect.exit(
              invokeSession(
                session,
                job.operationKey,
                undefined,
                job.openDocumentId,
                job.command,
                job.requestId,
                job,
              ),
            );
            yield* Deferred.done(job.result, exit);
            // The caller has its answer; an unsettled dispatch still holds this worker (rule 11).
            yield* reconcile(session, job);
            yield* Effect.logInfo(
              `Revit queue completed op=${job.operationKey} session=${session.sessionId} duration_ms=${(yield* Clock.currentTimeMillis) - startedAt}`,
            );
          }),
        ).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : Effect.flatMap(Ref.get(job.state), (state) =>
                  Deferred.fail(
                    job.result,
                    state === "sent"
                      ? new BridgeError(
                          "The host bridge stopped while Revit ran this request; its outcome is unknown here.",
                          503,
                        )
                      : new BridgeError(
                          "The host bridge stopped before this request reached Revit.",
                          503,
                          { notDispatched: true },
                        ),
                  ),
                ),
          ),
          Effect.ensuring(retire(session, job)),
        );
      });

    /** Refuses new jobs and fails every waiting one; a running job settles on its own reply. */
    const closeLine = Effect.fn("Dispatcher.closeLine")(function* (
      session: Session,
      reason: string,
    ) {
      yield* Queue.interrupt(session.line);
      // Interrupt is graceful: clear still returns buffered jobs. On an EMPTY line the queue is
      // already Done with an interrupt cause, which `clear` re-raises; that means "none left".
      const waiting = yield* Queue.clear(session.line).pipe(
        Effect.catchCause(() => Effect.succeed([] as Job[])),
      );
      for (const job of waiting) {
        if (!(yield* claimQueued(job))) continue;
        yield* Deferred.fail(job.result, new BridgeError(reason, 503, { notDispatched: true }));
        yield* retire(session, job);
      }
    });

    /** The session's one worker: FIFO, one op at a time, until the line closes or the host stops. */
    const serve = (session: Session) =>
      Effect.forever(
        Effect.uninterruptibleMask((restore) =>
          Effect.flatMap(restore(Queue.take(session.line)), (job) => runJob(session, job, restore)),
        ),
      ).pipe(
        Effect.ensuring(
          closeLine(session, "The host bridge stopped before this request reached Revit."),
        ),
      );

    /**
     * Host stop only: send the op Revit is running an out-of-band cancel and wait for that op's own
     * terminal answer (a cancel's acceptance is not proof it stopped). The 5 s bound is the host's
     * shutdown budget, not a slot release: no op can take this line after the host stops.
     */
    const cancelInFlight = (
      session: Session,
      requestId: string,
      reply: Deferred.Deferred<BridgeResponse, BridgeError>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.forkChild(
          invokeSession(session, CANCEL_OPERATION_KEY, { requestId }, undefined, undefined),
        );
        yield* Deferred.await(reply);
      }).pipe(Effect.timeout("5 seconds"), Effect.exit, Effect.asVoid);

    const register = (input: {
      sessionId: string;
      processId: number;
      processStartUtcUnixMs: number | null;
      connection: Connection;
      state: BridgeStateSnapshot;
    }) =>
      Effect.gen(function* () {
        const session: Session = {
          ...input,
          requests: yield* Ref.make<ReadonlyMap<string, BridgeRequest>>(new Map()),
          connection: yield* Ref.make<Connection | null>(input.connection),
          state: yield* Ref.make(input.state),
          line: yield* Queue.unbounded<Job>(),
          depth: yield* Ref.make(0),
          ended: yield* Deferred.make<void>(),
        };
        yield* Effect.forkIn(serve(session), bridgeScope);
        yield* Ref.update(sessions, (map) => new Map(map).set(session.sessionId, session));
        return session;
      });
    const retention = (session: Session) =>
      Effect.sync(() => {
        const jobs: Job[] = [];
        for (let n = Queue.sizeUnsafe(session.line); n > 0; n--) {
          const next = Queue.takeUnsafe(session.line);
          if (next && Exit.isSuccess(next)) jobs.push(next.value);
        }
        Queue.offerAllUnsafe(session.line, jobs);
        return {
          lineJobs: jobs.length,
          lineBytes: jobs.reduce((total, job) => total + job.bytes, 0),
        };
      });
    return {
      retention,
      sessions,
      attached,
      settleLoss,
      endIncarnation,
      settleTerminal,
      invoke,
      invokeHandle,
      cancelQueued,
      register,
    };
  });
