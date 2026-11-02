import { admittedRouteEntries } from "@pe/agent-contracts";
import { catalogEntries } from "@pe/agent-contracts/pe-api";
import { catalogCommandContext } from "./catalog-command-context.ts";
import type { DispatchRefusal } from "./action-dispatch.ts";
import { StepFailure } from "./command-executor.ts";
import { Clock, Context, Deferred, Effect, Layer, PubSub, Queue, Ref, Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/http";
import { Socket } from "effect/socket";
import { HttpServerResponse as Response } from "effect/http";
import {
  bridgeDispatchRefusal,
  bridgeValidateDispatch,
  markBridgeDispatched,
  recordBridgeQueue,
} from "./gateway-owner.ts";
import { receiptProducerSchema, type DocumentRef, type ReceiptProducer } from "@pe/agent-contracts";
import { randomUUID } from "node:crypto";
import { runtimeOwnerRejection } from "@pe/host-contracts/service-identity";
import { hostOwnership } from "./host-ownership.ts";
import {
  BRIDGE_CONTRACT_VERSION,
  computeBridgeSessionId,
  bridgeFrameSchema,
  type BridgeFrame,
  type BridgeRegistrationRequest,
  type BridgeResponse,
  type BridgeStateSnapshot,
  type Lane,
  type ValidationIssue,
} from "@pe/host-contracts/contracts";

/** Provenance grants only the Internal leaves the command declares in the catalog. */
export function commandLeafRefusal(
  operationKey: string,
  command: string | undefined,
): string | null {
  const leaf = catalogEntries.find((entry) => entry.key === operationKey);
  if (!leaf?.internal) return null;
  if (
    command &&
    [...admittedRouteEntries.values()].some(
      (registration) =>
        registration.available() && registration.entries[command]?.native?.includes(operationKey),
    )
  )
    return null;
  const owner = command && catalogEntries.find((entry) => entry.key === `command:${command}`);
  return owner &&
    owner.uses.some((use) => (typeof use === "string" ? use : use.key) === operationKey)
    ? null
    : `Command '${command ?? "(none)"}' does not declare Internal leaf '${operationKey}'`;
}

// Vocabulary: a SESSION is one Revit process incarnation; a CONNECTION is one WS attachment to
// it. With stable ids (hash(pid + processStartUtc)) a reconnect re-registers the SAME session id,
// and the session (its line, its worker, its requests, its occupied slot) survives the transport
// replacement: only `connection` changes. A new socket never opens the slot for the next op.
type Connection = {
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

type Session = {
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
  // jobs that hold a place (waiting or running) and bounds the line at MAX_QUEUED_OPS.
  readonly line: Queue.Queue<Job>;
  readonly depth: Ref.Ref<number>;
};

type JobAnswer = { readonly value: unknown; readonly openDocumentId?: string | null };
type JobState = "queued" | "running" | "left";

/**
 * One ordinary op in a session's line. `state` is the single claim on its place: the waiter that
 * leaves (`queued` -> `left`) and the worker that starts it (`queued` -> `running`) race on one
 * atomic transition, so exactly one of them retires the place.
 */
type Job = {
  readonly operationKey: string;
  readonly payload: unknown;
  readonly openDocumentId: string | undefined;
  readonly requestId: string;
  /** The ALS command context, captured at enqueue: the worker fiber does not inherit it. */
  readonly command: string | undefined;
  readonly reply: Deferred.Deferred<BridgeResponse, BridgeError>;
  readonly result: Deferred.Deferred<JobAnswer, BridgeError | NoRevitSession>;
  readonly state: Ref.Ref<JobState>;
  readonly depth: number;
  readonly queuedAt: number;
};

const MAX_QUEUED_OPS = 8;
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

/** Normalize independently observed bridge outcomes at the transport boundary. */
export async function invokeBridge<A = unknown>(
  bridge: RevitBridge["Service"],
  target: { session: string; openId?: string | null },
  key: string,
  input: unknown,
  requestId?: string,
): Promise<A> {
  // effect-edge: island, phase 5
  const result = await Effect.runPromise(
    Effect.result(bridge.invoke(key, input, target.session, target.openId ?? null, requestId)),
  );
  if (result._tag === "Failure") {
    const error = result.failure;
    switch (error._tag) {
      case "BridgeError":
        throw new StepFailure(error.message, error.statusCode, error.outcome, error.evidence.result, {
          nativeOutcome: error.nativeOutcome,
          issues: error.evidence.issues ? [...error.evidence.issues] : undefined,
        });
      case "NoRevitSession":
        throw new StepFailure(error.message, 503, "refused");
    }
    // A failure outside the declared union (a fake, a defect, a future tag) is never a success.
    throw error;
  }
  return result.success.value as A;
}

export type BridgeEvidence = {
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

/** A bridge operation failed on the Revit side (statusCode mirrors the C# BridgeOperationException). */
export class BridgeError extends Schema.TaggedError<BridgeError>()("BridgeError", {
  message: Schema.String,
  statusCode: Schema.Number,
  evidence: Schema.Any,
}) {
  declare readonly evidence: BridgeEvidence;
  // Positional, so the 30 construction sites across the host stay one line each.
  constructor(message: string, statusCode: number, evidence: BridgeEvidence = {}) {
    super({ message, statusCode, evidence });
  }
  get nativeOutcome(): string | undefined {
    return this.evidence.nativeOutcome ?? rootOutcome(this.evidence.issues);
  }
  /** What happened to the action, decided from typed fields only, never from message text. */
  get outcome(): "refused" | "cancelled" | "failed" | "unknown" {
    if (this.evidence.notDispatched || REFUSED_OUTCOMES.has(this.nativeOutcome ?? ""))
      return "refused";
    if (!this.evidence.dispatched) return "unknown";
    return this.statusCode === 499 ? "cancelled" : "failed";
  }
}

/** BridgeAgent emits one root issue for a RevitTaskOutcome or a typed refusal; preserve unknown future codes. */
const rootOutcome = (issues: ReadonlyArray<ValidationIssue> | null | undefined) =>
  issues?.length === 1 && issues[0]?.instancePath === "$" ? issues[0].code : undefined;

/**
 * Answers in which Revit has no outcome yet for the request: the delegate is still on the API
 * thread, or it timed out, which `pe-revit op result` also leaves unsettled. Every other answer is
 * settled.
 */
const UNSETTLED_OUTCOMES = new Set(["AbandonedStillRunning", "TimedOut"]);

/** No attached Revit answers what was asked: `asked` names it, `attached` lists what is there. */
export class NoRevitSession extends Schema.TaggedError<NoRevitSession>()("NoRevitSession", {
  asked: Schema.optional(Schema.String),
  attached: Schema.optional(Schema.Array(Schema.String)),
}) {
  override get message() {
    return this.asked
      ? `No attached Revit session is ${this.asked} (attached: ${this.attached?.length ? this.attached.join(", ") : "none"}).`
      : "No Revit session is connected to the bridge.";
  }
}

export type BridgeSessionView = {
  readonly connected: boolean;
  /** The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id. */
  readonly sessionId?: string;
  readonly processId?: number;
  readonly processStartUtcUnixMs?: number | null;
  readonly lane?: Lane | null;
  readonly sourceRoot?: string | null;
  readonly installedRoot?: string | null;
  readonly serviceName?: string | null;
  readonly runtimeMatch?: "verified" | "unknown" | "disconnected" | "refused";
  /** The id `pe-revit session list` prints for this session, when the payload reported one. */
  readonly sdkSessionId?: string | null;
  readonly buildStamp?: string | null;
  readonly state?: BridgeStateSnapshot;
};

/**
 * A bridge frame worth relaying to browsers: Revit events, state syncs, connects/disconnects.
 * A bridge event worth relaying to browsers. `origin` carries the caller's x-pe-origin where one
 * exists. These four frames are Revit-originated, so it is usually absent.
 */
export type HostBridgeEvent = {
  readonly sessionId: string;
  readonly kind: "event" | "state-sync" | "connected" | "disconnected";
  readonly eventName?: string;
  readonly payloadJson?: string | null;
  readonly origin?: string;
  /** Active document title at the moment of the event (connected/disconnected/state-sync). */
  readonly docTitle?: string | null;
  /** state-sync only: set (with prevDocTitle) when the active document actually changed. */
  readonly docChanged?: boolean;
  readonly prevDocTitle?: string | null;
  /** State-sync's exact lifetimes, so readers fence document close synchronously. */
  readonly openDocumentIds?: readonly string[];
};

export type NativeReceiptProducer = {
  readonly fact: ReceiptProducer;
  readonly connection: Readonly<{
    sessionId: string;
    processId: number;
    processStartUtcUnixMs: number | null;
    lane: Lane | null;
    buildStamp: string | null;
  }>;
};
const receiptProducers = new Set<(producer: NativeReceiptProducer) => void>();
/** Host-only intake. The export owner validates emitter metadata and supplies opaque identity. */
export function subscribeReceiptProducers(
  consume: (producer: NativeReceiptProducer) => void,
): () => void {
  receiptProducers.add(consume);
  return () => {
    receiptProducers.delete(consume);
  };
}

/** Backpressure cap for transient world notifications; current state remains query-owned. */
const EVENT_STREAM_CAPACITY = 500;

function getBridgeRegistrationRejection(registration: BridgeRegistrationRequest) {
  if (
    !Number.isInteger(registration.processId) ||
    registration.processId <= 0 ||
    !Number.isFinite(registration.processStartUtcUnixMs) ||
    (registration.processStartUtcUnixMs ?? 0) <= 0
  )
    return "Bridge registration requires a verified process incarnation.";
  return registration.contractVersion === BRIDGE_CONTRACT_VERSION
    ? runtimeOwnerRejection(hostOwnership, registration)
    : `Unsupported bridge contract version '${registration.contractVersion}'. Expected '${BRIDGE_CONTRACT_VERSION}'.`;
}

/** Accepts only Host/UI lanes; lane-less sessions remain targetable by process identity. */
const LANES: readonly Lane[] = ["dev", "installed"];

function normalizeSessionLane(lane: string | null | undefined): Lane | null {
  const normalized = lane?.trim().toLowerCase();
  return LANES.find((known) => known === normalized) ?? null;
}

// Exact attachment registry. Session selection belongs to the SDK.
export class RevitBridge extends Context.Service<
  RevitBridge,
  {
    readonly invoke: (
      operationKey: string,
      payload: unknown,
      bridgeSessionId?: string,
      openDocumentId?: string | null,
      requestId?: string,
    ) => Effect.Effect<
      {
        value: unknown;
        target: { session: string; document: string | null; documentRef?: DocumentRef };
      },
      BridgeError | NoRevitSession
    >;
    /** Retire only a host-queued request; never send op.cancel to Revit. */
    readonly cancelQueued: (requestIds: Promise<readonly string[]>) => Promise<void>;
    readonly snapshot: (bridgeSessionId?: string) => Effect.Effect<BridgeSessionView>;
    readonly list: Effect.Effect<readonly BridgeSessionView[]>;
    readonly lastRegistrationRefusal: Effect.Effect<string | null>;
    readonly handleConnection: (
      req: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
    readonly events: PubSub.PubSub<HostBridgeEvent>;
    /** Synchronous public observation tap; a slow network reader never backpressures the bridge. */
    readonly subscribe: (listener: (event: HostBridgeEvent) => void) => () => void;
  }
>()("RevitBridge") {}

const decodeFrame = Effect.fnUntraced(function* (raw: string) {
  const value = yield* Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (error) => error,
  });
  return yield* Schema.decodeUnknownEffect(bridgeFrameSchema)(value);
});

const encodeFrame = Effect.fnUntraced(function* (frame: BridgeFrame) {
  return yield* Effect.try({
    try: () => JSON.stringify(frame),
    catch: (error) => error,
  });
});

const decodePayloadJson = Effect.fnUntraced(function* (payloadJson: string | null | undefined) {
  if (!payloadJson) return null;
  return yield* Effect.try({
    try: () => JSON.parse(payloadJson) as unknown,
    catch: (error) => new BridgeError(String(error), 502),
  });
});

const encodePayloadJson = Effect.fnUntraced(function* (payload: unknown) {
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
const completeBridgeRequest = Effect.fnUntraced(function* (
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
  yield* Deferred.succeed(request.reply, response);
  return true;
});

export const RevitBridgeLive = Layer.effect(
  RevitBridge,
  Effect.gen(function* () {
    // Session workers are forked here, so closing the host closes every line (see `serve`).
    const bridgeScope = yield* Effect.scope;
    const processAlive = yield* RevitProcessAlive;
    const sessions = yield* Ref.make(new Map<string, Session>());
    const lastRegistrationRefusal = yield* Ref.make<string | null>(null);
    const events = yield* Effect.acquireRelease(
      PubSub.sliding<HostBridgeEvent>(EVENT_STREAM_CAPACITY),
      PubSub.shutdown,
    );
    const listeners = new Set<(event: HostBridgeEvent) => void>();
    // Subscriptions die with the bridge scope, not with the process.
    yield* Effect.addFinalizer(() => Effect.sync(() => listeners.clear()));
    const subscribe = (listener: (event: HostBridgeEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const emit = (event: HostBridgeEvent) =>
      Effect.sync(() => {
        for (const listener of listeners) listener(event);
      }).pipe(Effect.andThen(PubSub.publish(events, event)), Effect.asVoid);

    /** A session is targetable only while a transport is attached. */
    const attached = Effect.fnUntraced(function* (bridgeSessionId: string | undefined) {
      const session = bridgeSessionId ? (yield* Ref.get(sessions)).get(bridgeSessionId) : undefined;
      const connection = session ? yield* Ref.get(session.connection) : null;
      return session && connection ? { session, connection } : undefined;
    });

    const viewSession = Effect.fnUntraced(function* (session: Session, connection: Connection) {
      return {
        connected: true,
        sessionId: session.sessionId,
        processId: session.processId,
        processStartUtcUnixMs: session.processStartUtcUnixMs,
        lane: connection.lane,
        sourceRoot: connection.sourceRoot,
        installedRoot: connection.installedRoot,
        serviceName: connection.serviceName,
        runtimeMatch: "verified",
        sdkSessionId: connection.sdkSessionId,
        buildStamp: connection.buildStamp,
        state: yield* Ref.get(session.state),
      } satisfies BridgeSessionView;
    });

    /** Ends a session: its line fails unsent, and its id leaves the registry (if still its own). */
    const retireSession = Effect.fnUntraced(function* (session: Session, reason: string) {
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
    const settleLoss = Effect.fnUntraced(function* (session: Session) {
      if ((yield* Ref.get(session.connection)) !== null) return;
      if (yield* hasDispatched(session)) return;
      yield* retireSession(session, "Revit bridge disconnected before this request reached it.");
    });

    // Socket-close cleanup. Only the connection still current for its session acts: an old
    // socket closing after a reconnect of the same process is harmless. A loss while Revit owns a
    // dispatched request is uncertain (native work may still run): the session stays, holding its
    // slot, until the answer arrives on a new socket or the process is observed dead.
    const cleanupConnection = Effect.fnUntraced(function* (
      session: Session,
      connection: Connection,
    ) {
      const lost = yield* Ref.modify(session.connection, (current) =>
        current === connection ? ([true, null] as const) : ([false, current] as const),
      );
      if (!lost) return;
      yield* emit({
        sessionId: session.sessionId,
        kind: "disconnected",
        docTitle: (yield* Ref.get(session.state)).activeDocumentTitle ?? null,
      });
      yield* settleLoss(session);
    });

    /**
     * Fails only on process-death evidence while the transport is lost. Reconciliation ends on
     * evidence, never on elapsed time: this loop looks every DEATH_PROBE_INTERVAL and releases
     * nothing while the process lives.
     */
    const processDeath = (session: Session, operationKey: string) =>
      Effect.gen(function* () {
        while (true) {
          if ((yield* Ref.get(session.connection)) === null && !processAlive(session.processId))
            return yield* Effect.fail(
              new BridgeError(
                `Revit process ${session.processId} exited before answering '${operationKey}'; its outcome is unknown.`,
                503,
              ),
            );
          yield* Effect.sleep(DEATH_PROBE_INTERVAL);
        }
      });

    const handleConnectionScoped = Effect.fnUntraced(function* (
      req: HttpServerRequest.HttpServerRequest,
    ) {
      const socket = yield* Effect.orDie(req.upgrade);
      const write = yield* socket.writer;
      const send = (frame: BridgeFrame) =>
        Effect.flatMap(Effect.orDie(encodeFrame(frame)), (encoded) =>
          Effect.orDie(write.write(encoded)),
        );
      // This socket's attachment: the session it serves and the connection it is.
      let session: Session | null = null;
      let connection: Connection | null = null;
      /** Frames from a socket a reconnect replaced still answer requests, but never steer state. */
      const current = Effect.suspend(() =>
        session
          ? Effect.map(Ref.get(session.connection), (live) => live === connection)
          : Effect.succeed(false),
      );

      const onFrame = Effect.fnUntraced(function* (raw: string) {
        const decoded = yield* Effect.result(decodeFrame(raw));
        if (decoded._tag === "Failure") {
          yield* Effect.logWarning("invalid bridge frame");
          return;
        }
        const frame = decoded.success;
        switch (frame.kind) {
          case "Registration": {
            if (!frame.registration) {
              yield* Effect.logWarning("bridge Registration frame missing registration");
              return;
            }
            const rejection = getBridgeRegistrationRejection(frame.registration);
            if (rejection) {
              yield* Ref.set(lastRegistrationRefusal, rejection.slice(0, 512));
              yield* send({
                kind: "RegistrationAck",
                registrationAck: {
                  accepted: false,
                  errorMessage: rejection,
                },
              });
              return;
            }
            // Registration admitted a valid process incarnation before assigning its broker id.
            const registration = frame.registration;
            const sessionId = (yield* Effect.promise(() => computeBridgeSessionId(registration)))!;
            const previous = (yield* Ref.get(sessions)).get(sessionId);
            const previousConnection = previous ? yield* Ref.get(previous.connection) : null;
            const attachment: Connection = {
              epoch: previousConnection ? previousConnection.epoch + 1 : 0,
              send,
              lane: normalizeSessionLane(registration.lane),
              sourceRoot: registration.sourceRoot ?? null,
              installedRoot: registration.installedRoot ?? null,
              serviceName: registration.serviceName!,
              sdkSessionId: registration.sdkSessionId ?? null,
              buildStamp: registration.buildStamp ?? null,
            };
            if (previous) {
              // Reconnect of the SAME process: the session, its line and its occupied slot carry
              // over; only the transport is replaced. The old socket's close is then harmless.
              yield* Effect.logInfo(
                `bridge session ${sessionId} re-registered (pid ${registration.processId}); epoch ${attachment.epoch} replaces the previous connection`,
              );
              yield* Ref.set(previous.state, registration.state);
              yield* Ref.set(previous.connection, attachment);
              session = previous;
            } else {
              const registered: Session = {
                requests: yield* Ref.make<ReadonlyMap<string, BridgeRequest>>(new Map()),
                sessionId,
                processId: registration.processId,
                processStartUtcUnixMs: registration.processStartUtcUnixMs ?? null,
                connection: yield* Ref.make<Connection | null>(attachment),
                state: yield* Ref.make(registration.state),
                line: yield* Queue.unbounded<Job>(),
                depth: yield* Ref.make(0),
              };
              yield* Effect.forkIn(serve(registered), bridgeScope);
              yield* Ref.update(sessions, (map) => new Map(map).set(sessionId, registered));
              session = registered;
            }
            connection = attachment;
            yield* Ref.set(lastRegistrationRefusal, null);
            yield* send({
              kind: "RegistrationAck",
              registrationAck: { accepted: true, sessionId },
            });
            yield* emit({
              sessionId,
              kind: "connected",
              docTitle: registration.state.activeDocumentTitle ?? null,
            });
            return;
          }
          case "StateSync":
            if (!frame.stateSync) {
              yield* Effect.logWarning("bridge StateSync frame missing stateSync");
              return;
            }
            if (session && (yield* current)) {
              const prevState = yield* Ref.get(session.state);
              const nextState = frame.stateSync.state;
              yield* Ref.set(session.state, nextState);
              yield* emit({
                sessionId: session.sessionId,
                kind: "state-sync",
                openDocumentIds: nextState.openDocuments.map((document) => document.openId),
                docTitle: nextState.activeDocumentTitle ?? null,
                ...(prevState.activeDocumentKey !== nextState.activeDocumentKey
                  ? { docChanged: true, prevDocTitle: prevState.activeDocumentTitle ?? null }
                  : {}),
              });
            }
            return;
          case "Response": {
            if (!frame.response) {
              yield* Effect.logWarning("bridge Response frame missing response");
              return;
            }
            // Matched by request id from any socket of the session: a late answer from a replaced
            // socket settles its request instead of being dropped as unknown.
            if (session && connection)
              yield* completeBridgeRequest(session.requests, frame.response, connection.epoch);
            return;
          }
          case "Event": {
            if (!frame.event) {
              yield* Effect.logWarning("bridge Event frame missing event");
              return;
            }
            // This is producer evidence, never a browser event, including when malformed.
            if (frame.event.eventName === "receipt.producer") {
              if (
                !session ||
                !connection ||
                (yield* Ref.get(sessions)).get(session.sessionId) !== session
              )
                return;
              const raw = frame.event.payloadJson;
              try {
                if (!raw || raw.length > 256 * 1024) throw Error("Invalid producer size");
                const fact = receiptProducerSchema.parse(JSON.parse(raw));
                const emitter = {
                  sessionId: session.sessionId,
                  processId: session.processId,
                  processStartUtcUnixMs: session.processStartUtcUnixMs,
                  lane: connection.lane,
                  buildStamp: connection.buildStamp,
                };
                for (const consume of receiptProducers) {
                  try {
                    consume({ fact: structuredClone(fact), connection: { ...emitter } });
                  } catch {
                    yield* Effect.logWarning("Native receipt subscriber failed");
                  }
                }
              } catch {
                yield* Effect.logWarning("Native receipt producer envelope refused");
              }
              return;
            }
            yield* Effect.log(`bridge event: ${frame.event.eventName}`);
            if (session && (yield* current))
              yield* emit({
                sessionId: session.sessionId,
                kind: "event",
                eventName: frame.event.eventName,
                payloadJson: frame.event.payloadJson,
              });
            return;
          }
          default:
            return;
        }
      });

      // 4.0.2 has no Socket.runString: pull string batches and run each frame in order.
      yield* Effect.flatMap(Socket.readerString(socket), (pullFrames) =>
        Effect.forever(
          Effect.flatMap(pullFrames, (frames) =>
            Effect.forEach(frames, onFrame, { discard: true }),
          ),
        ),
      ).pipe(
        Effect.ensuring(
          Effect.suspend(() =>
            session && connection ? cleanupConnection(session, connection) : Effect.void,
          ),
        ),
        Effect.ignore({ log: true }), // log socket closes
      );
      return Response.empty();
    });

    const handleConnection = Effect.fnUntraced(function* (
      req: HttpServerRequest.HttpServerRequest,
    ) {
      return yield* Effect.scoped(handleConnectionScoped(req));
    });

    let revocation: Promise<void> = Promise.resolve();

    const invokeSession = Effect.fnUntraced(function* (
      session: Session,
      operationKey: string,
      payload: unknown,
      openDocumentId: string | undefined,
      command: string | undefined,
      requestId = randomUUID(),
      // The line reserves the reply before it queues, so a cancel can fail it before dispatch.
      reserved?: Deferred.Deferred<BridgeResponse, BridgeError>,
    ) {
      const provenanceRefusal = commandLeafRefusal(operationKey, command);
      if (provenanceRefusal)
        return yield* Effect.fail(new BridgeError(provenanceRefusal, 403, { notDispatched: true }));
      const reply = reserved ?? (yield* Deferred.make<BridgeResponse, BridgeError>());
      let dispatchedOn: Connection | undefined;
      // A revoke fences dispatch synchronously, before its asynchronous journal census answers.
      // Checking that fence and changing the request phase are one atomic decision.
      while (true) {
        const fence = revocation;
        if (reserved)
          yield* Effect.tryPromise({
            try: () => fence,
            catch: (error) =>
              new BridgeError(`Grant revoke census failed: ${String(error)}`, 503, {
                notDispatched: true,
              }),
          });
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
          const invalid = yield* Effect.promise(() => bridgeValidateDispatch(requestId));
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
            const refusal = reserved ? bridgeDispatchRefusal(requestId) : null;
            if (refusal) return [{ refusal }, requests] as const;
            const next = new Map(requests);
            next.set(requestId, {
              operationKey,
              requestId,
              reply,
              phase: "dispatched",
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
        const payloadJson = yield* encodePayloadJson(payload);
        yield* dispatchedOn!.send({
          kind: "Request",
          request: {
            requestId,
            operationKey,
            payloadJson,
            openDocumentId,
            derivedCommand: command,
          },
        });
        if (reserved) yield* Effect.promise(() => markBridgeDispatched(requestId));
        // The slot is released by Revit's answer to THIS request (from any socket of the
        // session) or by process death; never by a reconnect, a timer, or a cancel's acceptance.
        // Only host stop interrupts the worker mid-op (a leaving waiter never does).
        const res = yield* Deferred.await(reply).pipe(
          Effect.raceFirst(processDeath(session, operationKey)),
          Effect.onInterrupt(() =>
            reserved ? cancelInFlight(session, requestId, reply) : Effect.void,
          ),
        );
        if (!res.ok) {
          const state = yield* Ref.get(session.state);
          const targetOpenId = res.openDocumentId ?? openDocumentId;
          return yield* Effect.fail(
            new BridgeError(res.errorMessage ?? `${operationKey} failed`, res.statusCode ?? 500, {
              issues: res.issues,
              // A refusal is an answer, not a lost reply: it must never leave the action unknown.
              ...(UNSETTLED_OUTCOMES.has(rootOutcome(res.issues) ?? "")
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
          Effect.andThen(forgetBridgeRequest(session.requests, requestId), settleLoss(session)),
        ),
      );
    });

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

    const cancelQueuedRequest = Effect.fnUntraced(function* (requestId: string) {
      let known = false;
      for (const session of (yield* Ref.get(sessions)).values()) {
        const cancelled = yield* Ref.modify(session.requests, (requests) => {
          const request = requests.get(requestId);
          if (request?.phase !== "queued") return [false, requests] as const;
          const next = new Map(requests);
          next.set(requestId, { ...request, phase: "cancelled" });
          return [true, next] as const;
        });
        if (cancelled) return true;
        known ||= (yield* Ref.get(session.requests)).has(requestId);
      }
      if (!known) rememberRevoked(requestId);
      return false;
    });

    const cancelQueued = (requestIds: Promise<readonly string[]>): Promise<void> => {
      revocation = Promise.all([revocation, requestIds]).then(async ([, ids]) => {
        // effect-edge: island, phase 5
        for (const id of ids) await Effect.runPromise(cancelQueuedRequest(id));
      });
      return revocation;
    };

    /**
     * The whole point of cancel: it never takes a place in the session's line, so it reaches Revit
     * while the op it names is still running there. Returns null when no connected session owns
     * the id, so the caller falls through to ordinary targeting and Revit answers the refusal.
     */
    const cancelRequest = Effect.fnUntraced(function* (requestId: string) {
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
            catalogCommandContext.getStore(),
          );
          return { value: result.value, target };
        }
        // Still in the line: mark it and let the worker drop it. Revit never sees it at all.
        yield* trackBridgeRequest(session.requests, { ...request, phase: "cancelled" });
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

    const invoke = Effect.fnUntraced(function* (
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
          catalogCommandContext.getStore(),
        );
        return {
          value: result.value,
          target: { session: session.sessionId, document: null },
        };
      }

      const state = yield* Ref.get(session.state);
      const selectedDocument =
        openDocumentId === null
          ? undefined
          : (openDocumentId ?? state.openDocuments.find((document) => document.isActive)?.openId);

      // Interruption-safe enqueue: nothing below allocates a place (depth, request, job) before
      // `leave` is installed to retire it, and the waiter is interruptible only while it waits.
      const command = catalogCommandContext.getStore();
      const wireId = requestId ?? randomUUID();
      const result = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const depth = yield* Ref.updateAndGet(session.depth, (n) => n + 1);
          if (depth > MAX_QUEUED_OPS) {
            yield* Ref.update(session.depth, (n) => n - 1);
            return yield* Effect.fail(
              new BridgeError(
                `Revit queue is full (${MAX_QUEUED_OPS} waiting). Retry '${operationKey}' shortly.`,
                423,
                { notDispatched: true },
              ),
            );
          }
          const job: Job = {
            operationKey,
            payload,
            openDocumentId: selectedDocument,
            requestId: wireId,
            command,
            reply: yield* Deferred.make<BridgeResponse, BridgeError>(),
            result: yield* Deferred.make<JobAnswer, BridgeError | NoRevitSession>(),
            state: yield* Ref.make<JobState>("queued"),
            depth,
            queuedAt: yield* Clock.currentTimeMillis,
          };
          // Reserve the request under its wire id BEFORE queueing, so a cancel that arrives while
          // it waits has something to name (and something to fail) instead of a 404.
          yield* trackBridgeRequest(session.requests, {
            operationKey,
            requestId: wireId,
            reply: job.reply,
            phase: revokedBeforeQueue.delete(wireId) ? "cancelled" : "queued",
          });
          return yield* Effect.gen(function* () {
            // Depth includes this op; a contended enqueue stays visible even if it never starts.
            if (depth > 1)
              yield* restore(
                Effect.promise(() =>
                  recordBridgeQueue(operationKey, wireId, session.sessionId, "queued", depth).catch(
                    (error) => {
                      console.error("Queue receipt persistence failed", error);
                    },
                  ),
                ),
              );
            yield* Effect.logInfo(
              `Revit queue queued op=${operationKey} session=${session.sessionId} depth=${depth}`,
            );
            if (!(yield* Queue.offer(session.line, job)))
              return yield* Effect.fail(new NoRevitSession());
            return yield* restore(Deferred.await(job.result));
          }).pipe(Effect.ensuring(leave(session, job)));
        }),
      );
      return {
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
      };
    });

    /** Gives back a job's place: its request id and its depth. Called once, by whoever retires it. */
    const retire = (session: Session, job: Job) =>
      Effect.andThen(
        forgetBridgeRequest(session.requests, job.requestId),
        Ref.update(session.depth, (n) => n - 1),
      );

    /** Claims a job still waiting; false when the worker or another leaver got there first. */
    const claimQueued = (job: Job) =>
      Ref.modify(job.state, (state) =>
        state === "queued" ? ([true, "left"] as const) : ([false, state] as const),
      );

    /** A waiter that leaves before its turn takes itself out of the line, and nothing else. */
    const leave = Effect.fnUntraced(function* (session: Session, job: Job) {
      if (yield* claimQueued(job)) yield* retire(session, job);
    });

    /** Runs one job to Revit's answer. A job whose waiter left is dropped here, unsent. */
    const runJob = Effect.fnUntraced(function* (session: Session, job: Job) {
      const started = yield* Ref.modify(job.state, (state) =>
        state === "queued" ? ([true, "running"] as const) : ([false, state] as const),
      );
      if (!started) return;
      const startedAt = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        recordBridgeQueue(
          job.operationKey,
          job.requestId,
          session.sessionId,
          "started",
          job.depth,
          startedAt - job.queuedAt,
        ).catch((error) => {
          console.error("Queue receipt persistence failed", error);
        }),
      );
      yield* Effect.logInfo(
        `Revit queue started op=${job.operationKey} session=${session.sessionId} depth=${job.depth} wait_ms=${startedAt - job.queuedAt}`,
      );
      yield* invokeSession(
        session,
        job.operationKey,
        job.payload,
        job.openDocumentId,
        job.command,
        job.requestId,
        job.reply,
      ).pipe(
        Effect.exit,
        Effect.flatMap((exit) => Deferred.done(job.result, exit)),
        Effect.onInterrupt(() =>
          Deferred.fail(
            job.result,
            new BridgeError(
              "The host bridge stopped while Revit ran this request; its outcome is unknown here.",
              503,
            ),
          ),
        ),
        Effect.ensuring(retire(session, job)),
      );
      yield* Effect.logInfo(
        `Revit queue completed op=${job.operationKey} session=${session.sessionId} duration_ms=${(yield* Clock.currentTimeMillis) - startedAt}`,
      );
    });

    /** Refuses new jobs and fails every waiting one; a running job settles on its own reply. */
    const closeLine = Effect.fnUntraced(function* (session: Session, reason: string) {
      yield* Queue.interrupt(session.line);
      for (const job of yield* Queue.clear(session.line)) {
        if (!(yield* claimQueued(job))) continue;
        yield* Deferred.fail(job.result, new BridgeError(reason, 503, { notDispatched: true }));
        yield* retire(session, job);
      }
    });

    /** The session's one worker: FIFO, one op at a time, until the line closes or the host stops. */
    const serve = (session: Session) =>
      Effect.forever(Effect.flatMap(Queue.take(session.line), (job) => runJob(session, job))).pipe(
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

    // Exact attachment lookup only; absence never selects a socket.
    const snapshot = Effect.fnUntraced(function* (bridgeSessionId?: string) {
      const live = yield* attached(bridgeSessionId);
      return live
        ? yield* viewSession(live.session, live.connection)
        : ({ connected: false } satisfies BridgeSessionView);
    });

    const list = Effect.gen(function* () {
      const views: BridgeSessionView[] = [];
      for (const session of (yield* Ref.get(sessions)).values()) {
        const connection = yield* Ref.get(session.connection);
        if (connection) views.push(yield* viewSession(session, connection));
      }
      return views;
    });

    return {
      invoke,
      cancelQueued,
      snapshot,
      list,
      handleConnection,
      events,
      subscribe,
      lastRegistrationRefusal: Ref.get(lastRegistrationRefusal),
    };
  }),
);
