import { Context, Deferred, Effect, Layer, PubSub, Ref, Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpServerResponse as Response } from "effect/unstable/http";
import { capture } from "@pe/runtime";
import { randomUUID } from "node:crypto";
import {
  BRIDGE_CONTRACT_VERSION,
  computeBridgeSessionId,
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
  // Every request this session owns, keyed by the id the wire carries. Responses route by that
  // id, so several requests may be live at once: the FIFO gate below is what keeps ordinary ops
  // serial, and `op.cancel` is the one op that walks past it.
  readonly requests: Ref.Ref<ReadonlyMap<string, BridgeRequest>>;
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

/**
 * One live request. `queued` = the host holds it behind the gate and Revit has never seen it;
 * `dispatched` = Revit owns it; `cancelled` = a cancel reached it before dispatch, so the gate
 * drops it instead of sending it.
 */
export type BridgeRequest = {
  readonly operationKey: string;
  readonly reply: Deferred.Deferred<BridgeResponse, BridgeError>;
  readonly requestId: string;
  readonly phase: "queued" | "dispatched" | "cancelled";
};

/** The op that must never wait behind the op it names. */
export const CANCEL_OPERATION_KEY = "op.cancel";

/** A bridge operation failed on the Revit side (statusCode mirrors the C# BridgeOperationException). */
export class BridgeError {
  readonly _tag = "BridgeError";
  constructor(
    readonly message: string,
    readonly statusCode: number,
    readonly evidence: {
      readonly issues?: BridgeResponse["issues"];
      readonly nativeOutcome?: string;
      /** Revit never saw the request. */
      readonly notDispatched?: true;
      /** Revit answered the request with a settled verdict, so its outcome is known. */
      readonly dispatched?: true;
      readonly result?: unknown;
      readonly resolvedTarget?: { readonly session: string; readonly document: string | null };
    } = {},
  ) {}
  get nativeOutcome(): string | undefined {
    return this.evidence.nativeOutcome ?? rootOutcome(this.evidence.issues);
  }
}

/** BridgeAgent emits one root issue for a RevitTaskOutcome or a typed refusal; preserve unknown future codes. */
const rootOutcome = (issues: BridgeResponse["issues"]) =>
  issues?.length === 1 && issues[0]?.instancePath === "$" ? issues[0].code : undefined;

/**
 * Answers in which Revit has no outcome yet for the request: the delegate is still on the API
 * thread, or it timed out, which `pe-revit op result` also leaves unsettled. Every other answer is
 * settled.
 */
const UNSETTLED_OUTCOMES = new Set(["AbandonedStillRunning", "TimedOut"]);

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

function getBridgeRegistrationRejection(registration: BridgeRegistrationRequest) {
  return registration.contractVersion === BRIDGE_CONTRACT_VERSION
    ? null
    : `Unsupported bridge contract version '${registration.contractVersion}'. Expected '${BRIDGE_CONTRACT_VERSION}'.`;
}

/** Accepts only Host/UI lanes; lane-less sessions remain targetable by process identity. */
const LANES: readonly Lane[] = ["dev", "installed"];

function normalizeSessionLane(lane: string | null | undefined): Lane | null {
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
function inferCustody(session: Pick<SessionTargetCandidate, "sdkSessionId">): Custody {
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
function heldDocuments(
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
 * only while it holds the document; a pin miss refuses; `controlled`/`observed` â†’ custody; `dev`/`installed` â†’ lane; all digits â†’ pid; anything else
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
  // A pin is a required selected session, never a fallback preference.
  const pinned = /^pin:([^|]+)\|doc:(.*)$/is.exec(selector);
  if (pinned || selector.toLowerCase().startsWith("doc:")) {
    const address = (pinned ? pinned[2]! : selector.slice("doc:".length)).trim();
    const pin = pinned?.[1]!.trim();
    const holders = sessions.filter((s) => s.documents.includes(address));
    // An observed Revit (no pe-revit receipt) has no SDK id; its bridge id is its name on the head.
    const held = pin ? holders.find((s) => (s.sdkSessionId ?? s.sessionId) === pin) : undefined;
    if (held) return { _tag: "found", session: held };
    if (pin)
      return {
        _tag: "error",
        statusCode: 409,
        message: `Pinned session '${pin}' does not hold document '${address}'. Connected sessions: ${listing}`,
      };
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
      openDocumentId?: string | null,
      requestId?: string,
    ) => Effect.Effect<
      { value: unknown; target: { session: string; document: string | null } },
      BridgeError | NoRevitSession
    >;
    readonly snapshot: (bridgeSessionId?: string) => Effect.Effect<BridgeSessionView>;
    readonly list: Effect.Effect<readonly BridgeSessionView[]>;
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
) {
  const request = (yield* Ref.get(requests)).get(response.requestId);
  if (!request) {
    yield* Effect.logWarning(
      `bridge response for an unknown requestId: received=${response.requestId}`,
    );
    return false;
  }
  yield* Deferred.succeed(request.reply, response);
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
    const listeners = new Set<(event: HostBridgeEvent) => void>();
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
      const live = yield* Ref.getAndSet(session.requests, new Map());
      for (const request of live.values())
        yield* Deferred.fail(request.reply, new BridgeError(reason, 503));
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
            const registration = frame.registration;
            const sessionId =
              (yield* Effect.promise(() => computeBridgeSessionId(registration))) ??
              `bridge-${randomUUID()}`;
            const registeredSession = {
              send,
              requests: yield* Ref.make<ReadonlyMap<string, BridgeRequest>>(new Map()),
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
            if (session) yield* completeBridgeRequest(session.requests, frame.response);
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
      openDocumentId: string | undefined,
      requestId = randomUUID(),
      // The gate reserves the reply before it queues, so a cancel can fail it before dispatch.
      reserved?: Deferred.Deferred<BridgeResponse, BridgeError>,
    ) {
      const reply = reserved ?? (yield* Deferred.make<BridgeResponse, BridgeError>());
      yield* trackBridgeRequest(session.requests, {
        operationKey,
        requestId,
        reply,
        phase: "dispatched",
      });
      return yield* Effect.gen(function* () {
        const payloadJson = yield* encodePayloadJson(payload);
        yield* session.send({
          kind: "Request",
          request: {
            requestId,
            operationKey,
            payloadJson,
            openDocumentId,
          },
        });
        const res = yield* Deferred.await(reply);
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
                session: session.sdkSessionId ?? session.sessionId,
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
      }).pipe(Effect.ensuring(forgetBridgeRequest(session.requests, requestId)));
    });

    /**
     * The whole point of cancel: it walks past the per-session FIFO gate, so it reaches Revit
     * while the op it names is still running there. Returns null when no connected session owns
     * the id, so the caller falls through to ordinary targeting and Revit answers the refusal.
     */
    const cancelRequest = Effect.fnUntraced(function* (requestId: string) {
      for (const session of (yield* Ref.get(sessions)).values()) {
        const request = (yield* Ref.get(session.requests)).get(requestId);
        if (!request) continue;
        const target = {
          session: session.sdkSessionId ?? session.sessionId,
          document: null,
        };
        if (request.phase === "dispatched") {
          const result = yield* invokeSession(
            session,
            CANCEL_OPERATION_KEY,
            { requestId },
            undefined,
          );
          return { value: result.value, target };
        }
        // Still behind the gate: mark it and let the gate drop it. Revit never sees it at all.
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
      // Every bridge invoke reaches into exactly one Revit process, so ambiguity hard-fails here
      // (no warning-only release). Read-only aggregation across sessions goes through `list`.
      // `op.cancel` is the exception in two ways: the request it names picks the session (an
      // untargeted cancel must work while several sessions are connected), and it NEVER queues —
      // waiting behind the op it is meant to stop is the whole bug it exists to fix.
      if (operationKey === CANCEL_OPERATION_KEY) {
        const named = (payload as { requestId?: unknown } | null)?.requestId;
        const known = typeof named === "string" ? yield* cancelRequest(named) : null;
        if (known) return known;
      }
      const resolution = yield* resolveTarget(bridgeSessionId);
      if (resolution._tag === "none") return yield* Effect.fail(new NoRevitSession());
      if (resolution._tag === "error")
        return yield* Effect.fail(
          new BridgeError(resolution.message, resolution.statusCode, { notDispatched: true }),
        );
      // The candidate is a spread copy carrying `documents`; the liveness check below compares by
      // identity, so take the map's own Session object. FOOTGUN: every invoke failed NoRevitSession
      // on a live Revit (2026-09-06) while `list` showed the session, because of this copy.
      const session = (yield* Ref.get(sessions)).get(resolution.session.sessionId);
      if (!session) return yield* Effect.fail(new NoRevitSession());

      // An id this host never queued: let Revit answer for it, but still outside the gate.
      if (operationKey === CANCEL_OPERATION_KEY) {
        const result = yield* invokeSession(session, operationKey, payload, undefined);
        return {
          value: result.value,
          target: { session: session.sdkSessionId ?? session.sessionId, document: null },
        };
      }

      const state = yield* Ref.get(session.state);
      const selectedDocument =
        openDocumentId === null
          ? undefined
          : (openDocumentId ?? state.openDocuments.find((document) => document.isActive)?.openId);

      const depth = yield* Ref.updateAndGet(session.queueDepth, (n) => n + 1);
      if (depth > MAX_QUEUED_OPS) {
        yield* Ref.update(session.queueDepth, (n) => n - 1);
        return yield* Effect.fail(
          new BridgeError(
            `Revit queue is full (${MAX_QUEUED_OPS} waiting). Retry '${operationKey}' shortly.`,
            423,
            { notDispatched: true },
          ),
        );
      }

      // Reserve the request under its wire id BEFORE queueing, so a cancel that arrives while it
      // waits has something to name (and something to fail) instead of a 404.
      const wireId = requestId ?? randomUUID();
      const reply = yield* Deferred.make<BridgeResponse, BridgeError>();
      yield* trackBridgeRequest(session.requests, {
        operationKey,
        requestId: wireId,
        reply,
        phase: "queued",
      });

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
        // Cancelled while it waited: Revit never sees it, so this is the CancelledBeforeDispatch
        // the native queue reports for the same situation on its own side.
        if ((yield* Ref.get(session.requests)).get(wireId)?.phase === "cancelled")
          return yield* Effect.fail(
            new BridgeError(`'${operationKey}' was cancelled before dispatch.`, 499, {
              notDispatched: true,
              nativeOutcome: "CancelledBeforeDispatch",
            }),
          );
        const currentState = yield* Ref.get(session.state);
        if (
          selectedDocument &&
          !currentState.openDocuments.some((doc) => doc.openId === selectedDocument)
        )
          return yield* Effect.fail(
            new BridgeError("The selected document lifetime closed before dispatch", 409, {
              notDispatched: true,
            }),
          );
        const result = yield* invokeSession(
          session,
          operationKey,
          payload,
          selectedDocument,
          wireId,
          reply,
        );
        yield* Effect.logInfo(
          `Revit queue completed op=${operationKey} session=${session.sessionId} duration_ms=${Date.now() - startedAt}`,
        );
        return {
          value: result.value,
          target: {
            session: session.sdkSessionId ?? session.sessionId,
            document:
              state.openDocuments.find((document) => document.openId === result.openDocumentId)
                ?.address ?? null,
          },
        };
      }).pipe(
        Effect.ensuring(
          Effect.andThen(
            forgetBridgeRequest(session.requests, wireId),
            Effect.andThen(
              Ref.update(session.queueDepth, (n) => n - 1),
              Deferred.succeed(myGate, void 0),
            ),
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

    return { invoke, snapshot, list, handleConnection, events, subscribe };
  }),
);
