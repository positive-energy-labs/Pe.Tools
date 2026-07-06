import { Context, Deferred, Effect, Layer, PubSub, Ref, Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpServerResponse as Response } from "effect/unstable/http";
import { randomUUID } from "node:crypto";
import {
  BRIDGE_CONTRACT_VERSION,
  bridgeFrameSchema,
  type BridgeFrame,
  type BridgeRegistrationRequest,
  type BridgeResponse,
  type BridgeStateSnapshot,
} from "@pe/host-contracts/contracts";

type Session = {
  readonly send: (frame: BridgeFrame) => Effect.Effect<void>;
  readonly pending: Ref.Ref<BridgePendingRequest | null>; // single in-flight mailbox
  readonly sessionId: string;
  readonly processId: number;
  readonly state: Ref.Ref<BridgeStateSnapshot>;
  // FIFO turn chain: each invoke awaits the previous invoke's completion gate.
  // Machine callers (SSE-invalidated refetch bursts, IDE $ref resolution, agents)
  // collide constantly; queueing beats instant-423. Depth-bounded below.
  readonly queueTail: Ref.Ref<Deferred.Deferred<void>>;
  readonly queueDepth: Ref.Ref<number>;
};

const MAX_QUEUED_OPS = 8;

type BridgePendingRequest = {
  readonly operationKey: string;
  readonly reply: Deferred.Deferred<BridgeResponse, BridgeError>;
  readonly requestId: string;
};

/** A bridge operation failed on the Revit side (statusCode mirrors the C# BridgeOperationException). */
export class BridgeError {
  readonly _tag = "BridgeError";
  constructor(
    readonly message: string,
    readonly statusCode: number,
  ) {}
}

/** No Revit process is currently connected to the bridge. */
export class NoRevitSession {
  readonly _tag = "NoRevitSession";
  readonly message = "No Revit session is connected to the bridge.";
}

export type BridgeSessionView = {
  readonly connected: boolean;
  readonly sessionId?: string;
  readonly processId?: number;
  readonly state?: BridgeStateSnapshot;
};

/** A bridge frame worth relaying to browsers: Revit events, state syncs, connects/disconnects. */
export type HostBridgeEvent = {
  readonly sessionId: string;
  readonly kind: "event" | "state-sync" | "connected" | "disconnected";
  readonly eventName?: string;
  readonly payloadJson?: string | null;
};

export function getBridgeRegistrationRejection(registration: BridgeRegistrationRequest) {
  return registration.contractVersion === BRIDGE_CONTRACT_VERSION
    ? null
    : `Unsupported bridge contract version '${registration.contractVersion}'. Expected '${BRIDGE_CONTRACT_VERSION}'.`;
}

// Multi-session registry with a current-session fallback for old callers.
export class RevitBridge extends Context.Service<
  RevitBridge,
  {
    readonly invoke: (
      operationKey: string,
      payload: unknown,
      bridgeSessionId?: string,
    ) => Effect.Effect<unknown, BridgeError | NoRevitSession>;
    readonly snapshot: (bridgeSessionId?: string) => Effect.Effect<BridgeSessionView>;
    readonly list: Effect.Effect<readonly BridgeSessionView[]>;
    readonly handleConnection: (
      req: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
    readonly events: PubSub.PubSub<HostBridgeEvent>;
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
    catch: (error) => new BridgeError(String(error), 400),
  });
});

export const reserveBridgePending = Effect.fnUntraced(function* (
  pendingRef: Ref.Ref<BridgePendingRequest | null>,
  operationKey: string,
  requestId: string,
  reply: Deferred.Deferred<BridgeResponse, BridgeError>,
) {
  const activeOperationKey = yield* Ref.modify(pendingRef, (pending) =>
    pending ? [pending.operationKey, pending] : [null, { operationKey, reply, requestId }],
  );
  if (activeOperationKey)
    return yield* Effect.fail(
      new BridgeError(
        `Revit is busy executing '${activeOperationKey}'. Retry '${operationKey}' after the current request completes.`,
        423,
      ),
    );
});

export const completeBridgePending = Effect.fnUntraced(function* (
  pendingRef: Ref.Ref<BridgePendingRequest | null>,
  response: BridgeResponse,
) {
  const pending = yield* Ref.get(pendingRef);
  if (!pending) return false;
  if (pending.requestId !== response.requestId) {
    yield* Effect.logWarning(
      `bridge response requestId mismatch: pending=${pending.requestId}, received=${response.requestId}`,
    );
    return false;
  }
  yield* Deferred.succeed(pending.reply, response);
  return true;
});

export const RevitBridgeLive = Layer.effect(
  RevitBridge,
  Effect.gen(function* () {
    const sessions = yield* Ref.make(new Map<string, Session>());
    const currentSessionId = yield* Ref.make<string | null>(null);
    const events = yield* PubSub.unbounded<HostBridgeEvent>();

    const viewSession = Effect.fnUntraced(function* (session: Session) {
      return {
        connected: true,
        sessionId: session.sessionId,
        processId: session.processId,
        state: yield* Ref.get(session.state),
      } satisfies BridgeSessionView;
    });

    const getSession = Effect.fnUntraced(function* (bridgeSessionId?: string) {
      const map = yield* Ref.get(sessions);
      const sessionId = bridgeSessionId ?? (yield* Ref.get(currentSessionId));
      return sessionId ? (map.get(sessionId) ?? null) : null;
    });

    const cleanupSession = Effect.fnUntraced(function* (closedSession: Session) {
      const pending = yield* Ref.get(closedSession.pending);
      if (pending) {
        yield* Deferred.fail(
          pending.reply,
          new BridgeError("Revit bridge disconnected before responding.", 503),
        );
        yield* Ref.set(closedSession.pending, null);
      }
      yield* Ref.update(sessions, (map) => {
        const next = new Map(map);
        next.delete(closedSession.sessionId);
        return next;
      });
      const current = yield* Ref.get(currentSessionId);
      if (current === closedSession.sessionId) {
        const remaining = yield* Ref.get(sessions);
        yield* Ref.set(currentSessionId, remaining.keys().next().value ?? null);
      }
      yield* PubSub.publish(events, {
        sessionId: closedSession.sessionId,
        kind: "disconnected",
      });
    });

    const handleConnectionScoped = Effect.fnUntraced(function* (
      req: HttpServerRequest.HttpServerRequest,
    ) {
      const socket = yield* Effect.orDie(req.upgrade);
      const write = yield* socket.writer;
      const send = (frame: BridgeFrame) =>
        Effect.flatMap(Effect.orDie(encodeFrame(frame)), (encoded) => Effect.orDie(write(encoded)));
      let session: Session | null = null;

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
              yield* send({
                kind: "RegistrationAck",
                registrationAck: {
                  accepted: false,
                  errorMessage: rejection,
                },
              });
              return;
            }
            const initialGate = yield* Deferred.make<void>();
            yield* Deferred.succeed(initialGate, void 0);
            const registeredSession = {
              send,
              pending: yield* Ref.make<BridgePendingRequest | null>(null),
              sessionId: `bridge-${randomUUID()}`,
              processId: frame.registration.processId,
              state: yield* Ref.make(frame.registration.state),
              queueTail: yield* Ref.make(initialGate),
              queueDepth: yield* Ref.make(0),
            };
            session = registeredSession;
            yield* Ref.update(sessions, (map) =>
              new Map(map).set(registeredSession.sessionId, registeredSession),
            );
            yield* Ref.set(currentSessionId, registeredSession.sessionId);
            yield* send({
              kind: "RegistrationAck",
              registrationAck: { accepted: true },
            });
            yield* PubSub.publish(events, {
              sessionId: registeredSession.sessionId,
              kind: "connected",
            });
            return;
          }
          case "StateSync":
            if (!frame.stateSync) {
              yield* Effect.logWarning("bridge StateSync frame missing stateSync");
              return;
            }
            if (session) {
              yield* Ref.set(session.state, frame.stateSync.state);
              yield* PubSub.publish(events, {
                sessionId: session.sessionId,
                kind: "state-sync",
              });
            }
            return;
          case "Response": {
            if (!frame.response) {
              yield* Effect.logWarning("bridge Response frame missing response");
              return;
            }
            if (session) yield* completeBridgePending(session.pending, frame.response);
            return;
          }
          case "Event": {
            if (!frame.event) {
              yield* Effect.logWarning("bridge Event frame missing event");
              return;
            }
            yield* Effect.log(`bridge event: ${frame.event.eventName}`);
            if (session)
              yield* PubSub.publish(events, {
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

      yield* socket.runString(onFrame).pipe(
        Effect.ensuring(Effect.suspend(() => (session ? cleanupSession(session) : Effect.void))),
        Effect.ignore({ log: true }), // log socket closes
      );
      return Response.empty();
    });

    const handleConnection = Effect.fnUntraced(function* (
      req: HttpServerRequest.HttpServerRequest,
    ) {
      return yield* Effect.scoped(handleConnectionScoped(req));
    });

    const invokeSession = Effect.fnUntraced(function* (
      session: Session,
      operationKey: string,
      payload: unknown,
    ) {
      const reply = yield* Deferred.make<BridgeResponse, BridgeError>();
      const requestId = randomUUID();
      yield* reserveBridgePending(session.pending, operationKey, requestId, reply);
      return yield* Effect.gen(function* () {
        const payloadJson = yield* encodePayloadJson(payload);
        yield* session.send({
          kind: "Request",
          request: {
            requestId,
            operationKey,
            payloadJson,
          },
        });
        const res = yield* Deferred.await(reply);
        if (!res.ok)
          return yield* Effect.fail(
            new BridgeError(res.errorMessage ?? `${operationKey} failed`, res.statusCode ?? 500),
          );
        return yield* decodePayloadJson(res.payloadJson);
      }).pipe(
        Effect.ensuring(
          Ref.update(session.pending, (pending) => (pending?.reply === reply ? null : pending)),
        ),
      );
    });

    const invoke = Effect.fnUntraced(function* (
      operationKey: string,
      payload: unknown,
      bridgeSessionId?: string,
    ) {
      const session = yield* getSession(bridgeSessionId);
      if (!session) return yield* Effect.fail(new NoRevitSession());

      const depth = yield* Ref.updateAndGet(session.queueDepth, (n) => n + 1);
      if (depth > MAX_QUEUED_OPS) {
        yield* Ref.update(session.queueDepth, (n) => n - 1);
        return yield* Effect.fail(
          new BridgeError(
            `Revit queue is full (${MAX_QUEUED_OPS} waiting). Retry '${operationKey}' shortly.`,
            423,
          ),
        );
      }

      const myGate = yield* Deferred.make<void>();
      const previousGate = yield* Ref.getAndSet(session.queueTail, myGate);
      return yield* Effect.gen(function* () {
        yield* Deferred.await(previousGate);
        // The session may have died while we queued; its socket is gone.
        const live = yield* getSession(session.sessionId);
        if (live !== session) return yield* Effect.fail(new NoRevitSession());
        return yield* invokeSession(session, operationKey, payload);
      }).pipe(
        Effect.ensuring(
          Effect.andThen(
            Ref.update(session.queueDepth, (n) => n - 1),
            Deferred.succeed(myGate, void 0),
          ),
        ),
      );
    });

    const snapshot = Effect.fnUntraced(function* (bridgeSessionId?: string) {
      const session = yield* getSession(bridgeSessionId);
      if (!session) return { connected: false } satisfies BridgeSessionView;
      return yield* viewSession(session);
    });

    const list = Effect.gen(function* () {
      const map = yield* Ref.get(sessions);
      return yield* Effect.all([...map.values()].map((session) => viewSession(session)));
    });

    return { invoke, snapshot, list, handleConnection, events };
  }),
);
