import { Context, Deferred, Effect, Layer, PubSub, Ref, Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpServerResponse as Response } from "effect/unstable/http";
import { capture } from "@pe/runtime";
import { createHash, randomUUID } from "node:crypto";
import {
  BRIDGE_CONTRACT_VERSION,
  bridgeFrameSchema,
  type BridgeFrame,
  type BridgeRegistrationRequest,
  type BridgeResponse,
  type BridgeStateSnapshot,
  type Custody,
  type Lane,
} from "@pe/host-contracts/contracts";

// Vocabulary: a SESSION is one Revit process incarnation; a CONNECTION is one WS attachment to
// it. With stable ids (hash(pid + processStartUtc)) a reconnect re-registers the SAME session id,
// so registration performs an explicit takeover and cleanup must be guarded (see cleanupSession).
type Session = {
  readonly send: (frame: BridgeFrame) => Effect.Effect<void>;
  readonly pending: Ref.Ref<BridgePendingRequest | null>; // single in-flight mailbox
  readonly sessionId: string;
  readonly processId: number;
  readonly processStartUtcUnixMs: number | null;
  // Observed selector metadata, never process identity or custody authority.
  readonly lane: Lane | null;
  readonly sdkSessionId: string | null;
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
  /** The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id. */
  readonly sessionId?: string;
  readonly processId?: number;
  readonly processStartUtcUnixMs?: number | null;
  readonly lane?: Lane | null;
  /** The id `pe-revit session list` prints for this session, when the payload reported one. */
  readonly sdkSessionId?: string | null;
  /** Disclosed, never enforced — the SDK resolver is what actually refuses mutation on observed. */
  readonly custody?: Custody;
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
};

/** Backpressure cap for transient world notifications; current state remains query-owned. */
const EVENT_STREAM_CAPACITY = 500;

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

/** Accepts only Host/UI lanes; lane-less sessions remain targetable by process identity. */
const LANES: readonly Lane[] = ["dev", "installed"];

export function normalizeSessionLane(lane: string | null | undefined): Lane | null {
  const normalized = lane?.trim().toLowerCase();
  return LANES.find((known) => known === normalized) ?? null;
}

/**
 * Custody as the SDK defines it: `controlled` = pe-revit holds this session's registry receipt
 * (full lifecycle + doc ops); `observed` = no receipt (status and doc reads only). The broker
 * cannot read the registry, so it discloses the only thing it CAN see — a session that reported
 * the sdkSessionId from its launch receipt was launched by pe-revit, and is therefore controlled.
 * The SDK resolver is the enforcement point; this is disclosure, never a second gate.
 */
export function inferCustody(session: Pick<SessionTargetCandidate, "sdkSessionId">): Custody {
  return session.sdkSessionId ? "controlled" : "observed";
}

export type SessionTargetCandidate = {
  readonly sessionId: string;
  readonly processId: number;
  readonly lane: Lane | null;
  readonly sdkSessionId: string | null;
  /** Document Addresses this session holds, as the bridge last reported them. */
  readonly documents: readonly string[];
};

/** The document Addresses a bridge snapshot discloses. */
// ponytail: the wire reports only the ACTIVE document per session (openDocumentCount is a bare
// number), so "holds" means "is active in". Widen the state-sync payload with the open-document
// list when a background document must be addressable.
export function heldDocuments(
  state: Pick<BridgeStateSnapshot, "activeDocumentCloudModelGuid" | "activeDocumentPath">,
): string[] {
  const id = state.activeDocumentCloudModelGuid ?? state.activeDocumentPath;
  return id ? [id] : [];
}

export type SessionTargetResolution<S extends SessionTargetCandidate> =
  | { readonly _tag: "found"; readonly session: S }
  | { readonly _tag: "none" }
  | { readonly _tag: "error"; readonly message: string; readonly statusCode: number };

function describeSessions(sessions: readonly SessionTargetCandidate[]): string {
  if (sessions.length === 0) return "(no sessions connected)";
  return sessions
    .map(
      (s) =>
        `${s.sessionId} (pid ${s.processId}, lane ${s.lane ?? "unreported"}, ${inferCustody(s)}${
          s.sdkSessionId ? `, session ${s.sdkSessionId}` : ""
        }, holds ${s.documents.length ? s.documents.join(" + ") : "no document"})`,
    )
    .join("; ");
}

// The selector words ARE the SDK's custody and lane values, not a parallel product grammar:
// `controlled`/`observed` come from `Custody`, `dev`/`installed` from `Lane`. `session:<id>`
// addresses a pe-revit session by the id `session list` prints. Pid and bridge session id stay
// broker-local addressing, for a connection the SDK's registry may not know about at all.
const CUSTODIES: readonly Custody[] = ["controlled", "observed"];

const TARGET_SYNTAX = `Target one with target=<selector>: ${[...CUSTODIES, ...LANES]
  .map((word) => `'${word}'`)
  .join(", ")}, 'session:<id>', 'doc:<Address>', a pid, or a bridge session id.`;

/**
 * The sole target-resolution choke point, over BRIDGE-CONNECTED sessions — the broker's own
 * concern (DECISIONS Bridge row). It speaks the SDK's words but resolves over a different set than
 * pe-revit's resolver does: pe-revit resolves over the session registry, this resolves over live
 * WebSocket attachments, and a session can be in either without being in the other.
 *
 * Selector grammar: `session:<id>` → the connection reporting that pe-revit session id;
 * `doc:<Address>` → the one connection holding that document (zero or several holders refuse,
 * naming every session and what it holds); `pin:<id>|doc:<Address>` → the pinned pe-revit session
 * while it holds the document, else the plain `doc:` rules; `controlled`/`observed` → custody; `dev`/`installed` → lane; all digits → pid; anything else
 * → bridge session id (one process incarnation). Untargeted with one session is implicit
 * (ergonomic and safe); untargeted with several HARD-FAILS immediately with the listing —
 * read-only status/list surfaces aggregate via `list` instead, never through here.
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

  if (selector.toLowerCase().startsWith("session:")) {
    const sdkSessionId = selector.slice("session:".length).trim();
    const matches = sessions.filter((s) => s.sdkSessionId === sdkSessionId);
    if (matches.length === 1) return { _tag: "found", session: matches[0] };
    if (matches.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No connected session reports pe-revit session '${sdkSessionId}'. Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `pe-revit session '${sdkSessionId}' has ${matches.length} connected sessions — this should not happen (takeover keeps one per process incarnation). Target a pid or bridge session id instead. Connected sessions: ${listing}`,
    };
  }

  // A Scope that names a document and no session resolves here: the document is the primary key
  // and the session is derived from its one holder. Two holders is the one case the user must
  // name a session, and the refusal lists them so the head can offer exactly those.
  // The pin is a tiebreak, never a claim: it wins only while that session is a holder.
  const pinned = /^pin:([^|]+)\|doc:(.*)$/is.exec(selector);
  if (pinned || selector.toLowerCase().startsWith("doc:")) {
    const address = (pinned ? pinned[2]! : selector.slice("doc:".length)).trim();
    const pin = pinned?.[1]!.trim();
    const holders = sessions.filter((s) => s.documents.includes(address));
    const held = pin ? holders.find((s) => s.sdkSessionId === pin) : undefined;
    if (held) return { _tag: "found", session: held };
    if (holders.length === 1) return { _tag: "found", session: holders[0] };
    if (holders.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No connected session holds document '${address}'. Open it in Revit, or from /instances. Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `Document '${address}' is open in ${holders.length} sessions: ${describeSessions(holders)}. Name one with 'session:<id>'.`,
    };
  }

  // Custody, the SDK's word: `observed` is a session pe-revit holds no receipt for — the one the
  // retired grammar called `user`, and the one the SDK resolver refuses every mutation on.
  // `controlled` is a session pe-revit launched. The broker discloses which; it never enforces.
  const custody = CUSTODIES.find((word) => word === selector.toLowerCase());
  if (custody) {
    const matches = sessions.filter((s) => inferCustody(s) === custody);
    if (matches.length === 1) return { _tag: "found", session: matches[0] };
    if (matches.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No ${custody} session is connected. Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `'${custody}' is ambiguous: ${matches.length} ${custody} sessions are connected. Target a pid or bridge session id. Connected sessions: ${listing}`,
    };
  }

  const lane = LANES.find((known) => known === selector.toLowerCase());
  if (lane) {
    const matches = sessions.filter((s) => s.lane === lane);
    if (matches.length === 1) return { _tag: "found", session: matches[0] };
    if (matches.length === 0)
      return {
        _tag: "error",
        statusCode: 404,
        message: `No ${lane}-lane session is connected. Connected sessions: ${listing}`,
      };
    return {
      _tag: "error",
      statusCode: 409,
      message: `'${lane}' is ambiguous: ${matches.length} ${lane}-lane sessions are connected. Target a pid or bridge session id. Connected sessions: ${listing}`,
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
      message: `Pid ${pid} matches ${matches.length} sessions. Target a bridge session id. Connected sessions: ${listing}`,
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
    const events = yield* Effect.acquireRelease(
      PubSub.sliding<HostBridgeEvent>(EVENT_STREAM_CAPACITY),
      PubSub.shutdown,
    );
    const emit = (event: HostBridgeEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);

    const viewSession = Effect.fnUntraced(function* (session: Session) {
      return {
        connected: true,
        sessionId: session.sessionId,
        processId: session.processId,
        processStartUtcUnixMs: session.processStartUtcUnixMs,
        lane: session.lane,
        sdkSessionId: session.sdkSessionId,
        custody: inferCustody(session),
        buildStamp: session.buildStamp,
        state: yield* Ref.get(session.state),
      } satisfies BridgeSessionView;
    });

    // The sole target-resolution choke point for operations that reach into one Revit process.
    const resolveTarget = Effect.fnUntraced(function* (target?: string) {
      const map = yield* Ref.get(sessions);
      const candidates = yield* Effect.all(
        [...map.values()].map((session) =>
          Effect.map(Ref.get(session.state), (state) => ({
            ...session,
            documents: heldDocuments(state),
          })),
        ),
      );
      return resolveSessionTarget(candidates, target);
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
      yield* emit({
        sessionId: closedSession.sessionId,
        kind: "disconnected",
        docTitle: (yield* Ref.get(closedSession.state)).activeDocumentTitle ?? null,
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
              processStartUtcUnixMs: frame.registration.processStartUtcUnixMs ?? null,
              lane: normalizeSessionLane(frame.registration.lane),
              sdkSessionId: frame.registration.sdkSessionId ?? null,
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
            yield* emit({
              sessionId: registeredSession.sessionId,
              kind: "connected",
              docTitle: frame.registration.state.activeDocumentTitle ?? null,
            });
            return;
          }
          case "StateSync":
            if (!frame.stateSync) {
              yield* Effect.logWarning("bridge StateSync frame missing stateSync");
              return;
            }
            if (session) {
              const prevState = yield* Ref.get(session.state);
              const nextState = frame.stateSync.state;
              yield* Ref.set(session.state, nextState);
              yield* emit({
                sessionId: session.sessionId,
                kind: "state-sync",
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
      const queuedAt = Date.now();
      capture("bridge_queue", {
        op: operationKey,
        session_id: session.sessionId,
        queue_depth: depth,
        phase: "queued",
      });
      yield* Effect.logInfo(
        `Revit queue queued op=${operationKey} session=${session.sessionId} depth=${depth}`,
      );
      return yield* Effect.gen(function* () {
        yield* Deferred.await(previousGate);
        const startedAt = Date.now();
        capture("bridge_queue", {
          op: operationKey,
          session_id: session.sessionId,
          queue_depth: depth,
          phase: "started",
          wait_ms: Date.now() - queuedAt,
        });
        yield* Effect.logInfo(
          `Revit queue started op=${operationKey} session=${session.sessionId} depth=${depth} wait_ms=${startedAt - queuedAt}`,
        );
        // The session may have died — or been taken over by a reconnect — while we queued.
        const live = (yield* Ref.get(sessions)).get(session.sessionId);
        if (live !== session) return yield* Effect.fail(new NoRevitSession());
        const result = yield* invokeSession(session, operationKey, payload);
        yield* Effect.logInfo(
          `Revit queue completed op=${operationKey} session=${session.sessionId} duration_ms=${Date.now() - startedAt}`,
        );
        return result;
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
