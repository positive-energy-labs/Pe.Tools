import { Context, Deferred, Effect, Layer, PubSub, Ref, Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpServerResponse as Response } from "effect/unstable/http";
import { createHash, randomUUID } from "node:crypto";
import {
  BRIDGE_CONTRACT_VERSION,
  bridgeFrameSchema,
  type BridgeFrame,
  type BridgeRegistrationRequest,
  type BridgeResponse,
  type BridgeStateSnapshot,
} from "@pe/host-contracts/contracts";

// Vocabulary: a SESSION is one Revit process incarnation; a CONNECTION is one WS attachment to
// it. With stable ids (hash(pid + processStartUtc)) a reconnect re-registers the SAME session id,
// so registration performs an explicit takeover and cleanup must be guarded (see cleanupSession).
type Session = {
  readonly send: (frame: BridgeFrame) => Effect.Effect<void>;
  readonly pending: Ref.Ref<BridgePendingRequest | null>; // single in-flight mailbox
  readonly sessionId: string;
  readonly processId: number;
  // Observed selector metadata, never identity. lane is normalized ("dev" → "rrd"); buildStamp is
  // the LOADED payload's stamp as reported at registration — the host never computes staleness.
  readonly lane: string | null;
  readonly sandboxId: string | null;
  readonly buildStamp: string | null;
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
  readonly lane?: string | null;
  readonly sandboxId?: string | null;
  readonly buildStamp?: string | null;
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

/**
 * The universal session id: hash(pid + processStartUtc), for every lane, no exceptions.
 * The broker (this host) assigns it and returns it in the registration ack. Returns null when
 * the client did not report process identity — the caller keeps the bridge-${uuid} fallback
 * (deleting that fallback is later hardening).
 */
export function computeBridgeSessionId(registration: {
  readonly processId: number;
  readonly processStartUtcUnixMs?: number | null;
}): string | null {
  const startUtc = registration.processStartUtcUnixMs;
  if (typeof startUtc !== "number" || !Number.isFinite(startUtc) || startUtc <= 0) return null;
  const digest = createHash("sha256").update(`${registration.processId}:${startUtc}`).digest("hex");
  return `session-${digest.slice(0, 16)}`;
}

/**
 * Registered lane vocabulary: rrd | sandbox | installed. Descriptor-launched dev sessions report
 * the SDK lane string "dev"; in the broker's vocabulary that is the rrd session (Rider/Hot Reload
 * — it holds the user's live docs). The wire field stays verbatim; only the broker maps it.
 */
export function normalizeSessionLane(lane: string | null | undefined): string | null {
  const normalized = lane?.trim().toLowerCase();
  if (!normalized) return null;
  return normalized === "dev" ? "rrd" : normalized;
}

export type SessionTargetCandidate = {
  readonly sessionId: string;
  readonly processId: number;
  readonly lane: string | null;
  readonly sandboxId: string | null;
};

export type SessionTargetResolution<S extends SessionTargetCandidate> =
  | { readonly _tag: "found"; readonly session: S }
  | { readonly _tag: "none" }
  | { readonly _tag: "error"; readonly message: string; readonly statusCode: number };

function describeSessions(sessions: readonly SessionTargetCandidate[]): string {
  if (sessions.length === 0) return "(no sessions connected)";
  return sessions
    .map(
      (s) =>
        `${s.sessionId} (pid ${s.processId}, lane ${s.lane ?? "unknown"}${
          s.sandboxId ? `, sandbox ${s.sandboxId}` : ""
        })`,
    )
    .join("; ");
}

const TARGET_SYNTAX =
  "Target one with target=<selector>: 'user' (the user's own session — it holds their live docs), 'rrd' (the Rider dev session — rrd holds the user's live docs), 'sandbox:<id>', a pid, or a session id.";

/**
 * The sole target-resolution choke point. Selector grammar: `sandbox:<id>` → the current process
 * session for that logical sandbox; `rrd` → succeeds only when exactly one rrd session exists;
 * all digits → pid; anything else → raw session id (one process incarnation). Untargeted with one
 * session is implicit (ergonomic and safe); untargeted with several HARD-FAILS immediately with
 * the listing — read-only status/list surfaces aggregate via `list` instead, never through here.
 */
export function resolveSessionTarget<S extends SessionTargetCandidate>(
  sessions: readonly S[],
  target: string | undefined,
): SessionTargetResolution<S> {
  const selector = target?.trim();
  const listing = describeSessions(sessions);

  if (!selector) {
    if (sessions.length === 0) return { _tag: "none" };
    if (sessions.length === 1) return { _tag: "found", session: sessions[0] };
    return {
      _tag: "error",
      statusCode: 409,
      message: `Multiple Revit sessions are connected; untargeted Revit operations are ambiguous and refused. ${TARGET_SYNTAX} Connected sessions: ${listing}`,
    };
  }

  if (selector.toLowerCase().startsWith("sandbox:")) {
    const sandboxId = selector.slice("sandbox:".length).trim();
    const matches = sessions.filter((s) => s.sandboxId === sandboxId);
    if (matches.length === 1) return { _tag: "found", session: matches[0] };
    if (matches.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No connected session for sandbox '${sandboxId}'. Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `Sandbox '${sandboxId}' has ${matches.length} connected sessions — this should not happen (takeover keeps one per sandbox). Target a pid or session id instead. Connected sessions: ${listing}`,
    };
  }

  // Pea's world is "the user's session + sandboxes" — `user` selects the one non-sandbox
  // session without the caller ever speaking lane vocabulary (dev pea may target a user
  // session that is rrd underneath; that stays invisible to it).
  if (selector.toLowerCase() === "user") {
    const matches = sessions.filter((s) => s.lane !== "sandbox");
    if (matches.length === 1) return { _tag: "found", session: matches[0] };
    if (matches.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No user session is connected (only sandboxes). Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `'user' is ambiguous: ${matches.length} non-sandbox sessions are connected. Target a pid or session id. Connected sessions: ${listing}`,
    };
  }

  if (selector.toLowerCase() === "rrd") {
    const matches = sessions.filter((s) => s.lane === "rrd");
    if (matches.length === 1) return { _tag: "found", session: matches[0] };
    if (matches.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No rrd session is connected. Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `'rrd' is ambiguous: ${matches.length} rrd sessions are connected. Target a pid or session id. Connected sessions: ${listing}`,
    };
  }

  if (/^\d+$/.test(selector)) {
    const pid = Number.parseInt(selector, 10);
    const matches = sessions.filter((s) => s.processId === pid);
    if (matches.length === 1) return { _tag: "found", session: matches[0] };
    if (matches.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No connected session has pid ${pid}. Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `Pid ${pid} matches ${matches.length} sessions. Target a session id. Connected sessions: ${listing}`,
    };
  }

  const byId = sessions.find((s) => s.sessionId === selector);
  if (byId) return { _tag: "found", session: byId };
  return {
    _tag: "error",
    statusCode: 404,
    message: `No connected session matches target '${selector}'. ${TARGET_SYNTAX} Connected sessions: ${listing}`,
  };
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
        lane: session.lane,
        sandboxId: session.sandboxId,
        buildStamp: session.buildStamp,
        state: yield* Ref.get(session.state),
      } satisfies BridgeSessionView;
    });

    // The sole target-resolution choke point for operations that reach into one Revit process.
    const resolveTarget = Effect.fnUntraced(function* (target?: string) {
      const map = yield* Ref.get(sessions);
      return resolveSessionTarget([...map.values()], target);
    });

    const failPendingRequest = Effect.fnUntraced(function* (session: Session, reason: string) {
      const pending = yield* Ref.get(session.pending);
      if (!pending) return;
      yield* Deferred.fail(pending.reply, new BridgeError(reason, 503));
      yield* Ref.set(session.pending, null);
    });

    // Socket-close cleanup. With stable session ids this races reconnect takeover: the OLD
    // connection's close must never tear down the NEW connection that re-registered the same id.
    // Guard: only the session object still present in the map cleans up its id.
    const cleanupSession = Effect.fnUntraced(function* (closedSession: Session) {
      yield* failPendingRequest(closedSession, "Revit bridge disconnected before responding.");
      const map = yield* Ref.get(sessions);
      if (map.get(closedSession.sessionId) !== closedSession) return; // superseded by takeover — harmless
      yield* Ref.update(sessions, (current) => {
        const next = new Map(current);
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
            // Broker-assigned identity: hash(pid + processStartUtc) when the client reported
            // process identity; bridge-${uuid} fallback otherwise (deleting it is later hardening).
            const sessionId =
              computeBridgeSessionId(frame.registration) ?? `bridge-${randomUUID()}`;
            const registeredSession = {
              send,
              pending: yield* Ref.make<BridgePendingRequest | null>(null),
              sessionId,
              processId: frame.registration.processId,
              lane: normalizeSessionLane(frame.registration.lane),
              sandboxId: frame.registration.sandboxId ?? null,
              buildStamp: frame.registration.buildStamp ?? null,
              state: yield* Ref.make(frame.registration.state),
              queueTail: yield* Ref.make(initialGate),
              queueDepth: yield* Ref.make(0),
            };
            // Reconnect takeover: a stable id re-registering means the same Revit process came
            // back on a new socket. Replace the old connection, fail its pending request, and
            // leave its eventual socket-close cleanup harmless (guarded in cleanupSession).
            const previous = (yield* Ref.get(sessions)).get(sessionId);
            if (previous) {
              yield* Effect.logInfo(
                `bridge session ${sessionId} re-registered (pid ${registeredSession.processId}); taking over the previous connection`,
              );
              yield* failPendingRequest(
                previous,
                "Revit bridge connection was superseded by a reconnect for the same session.",
              );
            }
            session = registeredSession;
            yield* Ref.update(sessions, (map) =>
              new Map(map).set(registeredSession.sessionId, registeredSession),
            );
            yield* Ref.set(currentSessionId, registeredSession.sessionId);
            yield* send({
              kind: "RegistrationAck",
              registrationAck: { accepted: true, sessionId: registeredSession.sessionId },
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
      // Every bridge invoke reaches into exactly one Revit process, so ambiguity hard-fails here
      // (no warning-only release). Read-only aggregation across sessions goes through `list`.
      const resolution = yield* resolveTarget(bridgeSessionId);
      if (resolution._tag === "none") return yield* Effect.fail(new NoRevitSession());
      if (resolution._tag === "error")
        return yield* Effect.fail(new BridgeError(resolution.message, resolution.statusCode));
      const session = resolution.session;

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
        // The session may have died — or been taken over by a reconnect — while we queued.
        const live = (yield* Ref.get(sessions)).get(session.sessionId);
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

    // Read-only view: never hard-fails. An untargeted snapshot with several sessions falls back
    // to the most recently registered one (status displays); targeted misses read as disconnected.
    const snapshot = Effect.fnUntraced(function* (bridgeSessionId?: string) {
      const resolution = yield* resolveTarget(bridgeSessionId);
      if (resolution._tag === "found") return yield* viewSession(resolution.session);
      if (!bridgeSessionId) {
        const map = yield* Ref.get(sessions);
        const currentId = yield* Ref.get(currentSessionId);
        const current = currentId ? map.get(currentId) : undefined;
        if (current) return yield* viewSession(current);
      }
      return { connected: false } satisfies BridgeSessionView;
    });

    const list = Effect.gen(function* () {
      const map = yield* Ref.get(sessions);
      return yield* Effect.all([...map.values()].map((session) => viewSession(session)));
    });

    return { invoke, snapshot, list, handleConnection, events };
  }),
);
