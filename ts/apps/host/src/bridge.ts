import { BridgeError as DispatchBridgeError } from "@pe/host-internal/dispatch";
import {
  makeDispatcher,
  completeBridgeRequest,
  type Connection,
  type NativeDispatchHandle,
  type Session,
} from "@pe/host-internal/dispatch";
export { RevitProcessAlive, CANCEL_OPERATION_KEY } from "@pe/host-internal/dispatch";
export type { BridgeRequest } from "@pe/host-internal/dispatch";
import type { BridgeStateSnapshot, ValidationIssue } from "@pe/host-contracts/contracts";

import { admittedRouteEntries } from "@pe/agent-contracts";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { catalogCommandContext } from "./catalog-command-context.ts";
import { StepFailure } from "./command-executor.ts";
import { Context, Effect, Layer, Option, PubSub, Ref, Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/http";
import { Socket } from "effect/socket";
import { HttpServerResponse as Response } from "effect/http";
import { dispatchRefusal, markDispatched, validateDispatch } from "./action-dispatch.ts";
import { ActionJournalService } from "./receipt-services.ts";
import { receiptProducerSchema, type DocumentRef, type ReceiptProducer } from "@pe/agent-contracts";
import { runtimeOwnerRejection } from "@pe/host-contracts/service-identity";
import { hostOwnership } from "./host-ownership.ts";
import {
  BRIDGE_CONTRACT_VERSION,
  computeBridgeSessionId,
  bridgeFrameSchema,
  type BridgeFrame,
  type BridgeRegistrationRequest,
  type Lane,
} from "@pe/host-contracts/contracts";

/** Unit I removes this shared transitional edge when B/C/R convert the remaining callers. */
const runCompatibility = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  // effect-edge: island, phase 5
  return Effect.runPromise(effect);
};
/** Provenance grants only the Internal leaves the command declares in the catalog. */
export function commandLeafRefusal(
  operationKey: string,
  command: string | undefined,
): string | null {
  const leaf = linkedCatalog().entries.get(operationKey);
  if (!leaf?.internal) return null;
  if (
    command &&
    [...admittedRouteEntries.values()].some(
      (registration) =>
        registration.available() && registration.entries[command]?.native?.includes(operationKey),
    )
  )
    return null;
  const owner = command && linkedCatalog().entries.get(`command:${command}`);
  return owner &&
    owner.uses.some((use) => (typeof use === "string" ? use : use.key) === operationKey)
    ? null
    : `Command '${command ?? "(none)"}' does not declare Internal leaf '${operationKey}'`;
}

/** Normalize independently observed bridge outcomes at the transport boundary. */
export async function invokeBridge<A = unknown>(
  bridge: RevitBridge["Service"],
  target: { session: string; openId?: string | null },
  key: string,
  input: unknown,
  requestId?: string,
): Promise<A> {
  const result = await runCompatibility(
    Effect.result(bridge.invoke(key, input, target.session, target.openId ?? null, requestId)),
  );
  if (result._tag === "Failure") {
    const error = result.failure;
    switch (error._tag) {
      case "BridgeError":
        throw new StepFailure(
          error.message,
          error.statusCode,
          error.outcome,
          error.evidence.result,
          {
            nativeOutcome: error.nativeOutcome,
            issues: error.evidence.issues ? [...error.evidence.issues] : undefined,
          },
        );
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
  /** Jobs physically retained in the line, waiting (each holds its payload). Diagnostic. */
  readonly lineJobs?: number;
  readonly lineBytes?: number;
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
    /** Independent caller answer and native settlement, owned by the queued job. */
    readonly invokeHandle: (
      operationKey: string,
      payload: unknown,
      bridgeSessionId?: string,
      openDocumentId?: string | null,
      requestId?: string,
    ) => Effect.Effect<
      NativeDispatchHandle,
      import("@pe/host-internal/request-contracts").DoorFailure
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

export const RevitBridgeLive = Layer.effect(
  RevitBridge,
  Effect.gen(function* () {
    // Queue facts go to this runtime's journal, which outlives the bridge (its Layer is built first, so
    // released last). The one bridge composed without a journal is `liveNativeRecipe` (native-read-root.ts),
    // which `builtin-inputs.ts` builds for recording before `host-program.ts` opens the journal; it only
    // reads, so a queue fact there is refused.
    const journal = Option.getOrUndefined(yield* Effect.serviceOption(ActionJournalService));
    // Session workers are forked here, so closing the host closes every line (see `serve`).
    const dispatcher = yield* makeDispatcher({
      command: () => catalogCommandContext.getStore(),
      commandLeafRefusal,
      bridgeValidateDispatch: validateDispatch,
      bridgeDispatchRefusal: dispatchRefusal,
      markBridgeDispatched: markDispatched,
      recordBridgeQueue: (...args) =>
        journal
          ? journal.recordQueue(...args)
          : Promise.reject(Error("Receipt owner has not been initialized")),
    });
    const { sessions, attached, settleLoss, endIncarnation, settleTerminal } = dispatcher;
    // Transitional legacy failure projection; B/C/I retire this with existing consumers.
    const invoke = (...args: Parameters<typeof dispatcher.invoke>) =>
      dispatcher
        .invoke(...args)
        .pipe(
          Effect.mapError((error) =>
            error._tag === "BridgeError"
              ? new BridgeError(error.message, error.statusCode, error.evidence)
              : new NoRevitSession({ asked: error.asked, attached: error.attached }),
          ),
        );
    // Temporary facade for unit C's revoke caller; I removes this with that caller.
    const cancelQueued = (ids: Promise<readonly string[]>) =>
      runCompatibility(
        dispatcher.cancelQueued(
          Effect.tryPromise({
            try: () => ids,
            catch: (error) => new DispatchBridgeError(String(error), 503, { notDispatched: true }),
          }),
        ),
      );

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
        ...(yield* dispatcher.retention(session)),
      } satisfies BridgeSessionView;
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
            // inFlight is captured from one process handle. Evidence tagged with another
            // incarnation than the registration's cannot vouch for this session's old jobs.
            const inFlight = registration.inFlight ?? null;
            const vouched =
              !inFlight ||
              (inFlight.processId === registration.processId &&
                inFlight.processStartUtcUnixMs === registration.processStartUtcUnixMs);
            // A registration proves which incarnation of its pid is alive. Every other session for
            // that pid, and this id's own session when unvouched, is dead: its jobs settle unknown.
            for (const other of (yield* Ref.get(sessions)).values())
              if (
                other.processId === registration.processId &&
                (other.sessionId !== sessionId || !vouched)
              )
                yield* endIncarnation(other);
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
              const registered = yield* dispatcher.register({
                sessionId,
                processId: registration.processId,
                processStartUtcUnixMs: registration.processStartUtcUnixMs ?? null,
                connection: attachment,
                state: registration.state,
              });
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
            // Re-adoption: a request inFlight lists is still held, because the carried-over session
            // keeps it dispatched and its worker reconciling. Only replayed terminals act here.
            for (const terminal of inFlight?.terminals ?? [])
              yield* settleTerminal(session, terminal);
            return;
          }
          case "Terminal": {
            if (!frame.terminal) {
              yield* Effect.logWarning("bridge Terminal frame missing terminal");
              return;
            }
            // Like a Response, it is matched by request id from any socket of the session.
            if (session) yield* settleTerminal(session, frame.terminal);
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
      invokeHandle: dispatcher.invokeHandle,
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

/**
 * {@link RevitBridgeLive} with no socket attached: every member it does not override gives the live
 * no-session answer (`NoRevitSession`, an empty list, `connected: false`). Its PubSub and listeners
 * close with the layer's scope. `overrides` replace members by name.
 */
export const RevitBridgeDetached = (overrides: Partial<RevitBridge["Service"]> = {}) =>
  Layer.effect(
    RevitBridge,
    Effect.gen(function* () {
      return { ...(yield* RevitBridge), ...overrides };
    }),
  ).pipe(Layer.provide(RevitBridgeLive));
