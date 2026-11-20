import { Context, type Effect, type PubSub, Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/http";
import type { BridgeStateSnapshot, Lane, ValidationIssue } from "@pe/host-contracts/contracts";
import type { DocumentRef } from "@pe/agent-contracts";
import type { QueueHolder } from "@pe/agent-contracts/value";
import type { NativeDispatchHandle } from "./dispatch.ts";
import type { ReadingDemand } from "./native-read.ts";
import type { DoorFailure } from "./request-contracts.d.ts";

export type BridgeEvidence = {
  readonly uncertainty?: "lost-response" | "process-exit";
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
      demand?: ReadingDemand,
      label?: string,
    ) => Effect.Effect<NativeDispatchHandle, DoorFailure>;
    readonly observeHolder: (session: string, notify: (holder: QueueHolder) => void) => () => void;
    readonly documentAddress: (ref: DocumentRef) => string | null | undefined;
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
