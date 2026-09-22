// Hand-authored wire contract. Keep aligned with Pe.Shared.HostContracts.Bridge (C#) — the codegen that
// once produced this file is deleted; changes here are ordinary code review, not regeneration.

import { Schema } from "effect";
import type { SessionObservation } from "../vendor/generated/pe-revit-contract.ts";
import type { HostLane } from "../service-identity.ts";

export const HOST_CONTRACT_VERSION = 54 as const;
export const BRIDGE_CONTRACT_VERSION = 23 as const;
export const BRIDGE_PATH = "/api/bridge" as const;
export const HOST_RPC_BRIDGE_SESSION_HEADER = "x-pe-bridge-session-id" as const;
export const HOST_RPC_DOCUMENT_HEADER = "x-pe-open-document-id" as const;

/** Same process incarnation across bridge reconnects and SDK census observations. */
export async function computeBridgeSessionId(registration: {
  readonly processId: number;
  readonly processStartUtcUnixMs?: number | null;
}): Promise<string | null> {
  const start = registration.processStartUtcUnixMs;
  if (typeof start !== "number" || !Number.isFinite(start) || start <= 0) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${registration.processId}:${start}`),
  );
  return `session-${Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
// Caller attribution (queue-provenance §1): `<lane>:<name>[#<id>]`, e.g. `web:/schedule-grid`,
// `pea:chat#<threadId>`, `script:<runSlug>`. Lenient by design — missing reads as "unknown".
export const HOST_RPC_ORIGIN_HEADER = "x-pe-origin" as const;

const nullableString = Schema.optional(Schema.NullOr(Schema.String));

// `controlled` = pe-revit holds a receipt (full lifecycle); `observed` = reads only.
export type Custody = SessionObservation extends infer Observation
  ? Observation extends { readonly case: "observed-active" }
    ? "observed"
    : "controlled"
  : never;
// Host/UI lane. The SDK calls the source payload `checkout`; only presentation calls it `dev`.
export type Lane = HostLane;

export const hostRuntimeAssemblyDataSchema = Schema.Struct({
  informationalVersion: nullableString,
  location: nullableString,
  moduleVersionId: Schema.String,
  name: Schema.String,
  version: nullableString,
});
export type HostRuntimeAssemblyData = Schema.Schema.Type<typeof hostRuntimeAssemblyDataSchema>;

export const performanceMetricsSchema = Schema.Struct({
  requestBytes: Schema.Number,
  responseBytes: Schema.Number,
  revitExecutionMs: Schema.Number,
  roundTripMs: Schema.Number,
  serializationMs: Schema.Number,
});
export type PerformanceMetrics = Schema.Schema.Type<typeof performanceMetricsSchema>;

export const validationIssueSchema = Schema.Struct({
  code: Schema.String,
  instancePath: Schema.String,
  message: Schema.String,
  schemaPath: nullableString,
  severity: Schema.String,
  suggestion: nullableString,
});
export type ValidationIssue = Schema.Schema.Type<typeof validationIssueSchema>;

export const bridgeEventSchema = Schema.Struct({
  eventName: Schema.String,
  payloadJson: Schema.String,
});
export type BridgeEvent = Schema.Schema.Type<typeof bridgeEventSchema>;

export const bridgeRegistrationAckSchema = Schema.Struct({
  accepted: Schema.Boolean,
  errorMessage: nullableString,
  // Broker-assigned session id (hash(pid + processStartUtc) when identity was reported,
  // bridge-${uuid} fallback otherwise). The client learns its own name from the ack.
  sessionId: nullableString,
});
export type BridgeRegistrationAck = Schema.Schema.Type<typeof bridgeRegistrationAckSchema>;

/** `openId` is the bridge's id, the one `?target=` accepts (not `pe-revit doc open`'s).
 * `address` is null until the document is saved (detached, new, or an EditFamily family). */
export const bridgeDocumentSnapshotSchema = Schema.Struct({
  openId: Schema.String,
  title: Schema.String,
  address: nullableString,
  isFamilyDocument: Schema.Boolean,
  isActive: Schema.Boolean,
});

export const bridgeStateSnapshotSchema = Schema.Struct({
  activeDocumentCloudModelGuid: nullableString,
  activeDocumentCloudModelUrn: nullableString,
  activeDocumentCloudProjectGuid: nullableString,
  activeDocumentIsFamilyDocument: Schema.Boolean,
  activeDocumentIsModelInCloud: Schema.Boolean,
  activeDocumentIsWorkshared: Schema.Boolean,
  activeDocumentKey: nullableString,
  activeDocumentObservedAtUnixMs: Schema.Number,
  activeDocumentPath: nullableString,
  activeDocumentTitle: nullableString,
  hasActiveDocument: Schema.Boolean,
  openDocuments: Schema.Array(bridgeDocumentSnapshotSchema),
  revitVersion: Schema.String,
  runtimeAssemblies: Schema.Array(hostRuntimeAssemblyDataSchema),
  runtimeFramework: Schema.String,
  sharedParametersFilename: nullableString,
});
export type BridgeStateSnapshot = Schema.Schema.Type<typeof bridgeStateSnapshotSchema>;

// Session = one Revit process incarnation; connection = one WS attachment to it. The identity
// tuple is pid + processStartUtcUnixMs (the broker hashes it into the session id); lane/
// sdkSessionId/buildStamp/sessionDescriptorPath are selectors and observed metadata, never identity.
//
// `sdkSessionId` is the id `pe-revit session status` prints for this session (SessionRow.id). The
// name is QUALIFIED because `sessionId` on this wire already means the BROKER's hash. It replaced
// `sandboxId` at SDK beta.121 — a wire rename, not an additive optional, and the version gate is
// exact-match, so BRIDGE_CONTRACT_VERSION went 19 -> 20 with it.
// `lane` is the SDK's: `dev` | `installed`, payload SOURCE only.
export const bridgeRegistrationRequestSchema = Schema.Struct({
  buildStamp: nullableString,
  contractVersion: Schema.Number,
  lane: nullableString,
  processId: Schema.Number,
  processStartUtcUnixMs: Schema.optional(Schema.NullOr(Schema.Number)),
  sdkSessionId: nullableString,
  sessionDescriptorPath: nullableString,
  state: bridgeStateSnapshotSchema,
});
export type BridgeRegistrationRequest = Schema.Schema.Type<typeof bridgeRegistrationRequestSchema>;

export const bridgeRequestSchema = Schema.Struct({
  openDocumentId: nullableString,
  operationKey: Schema.String,
  payloadJson: Schema.String,
  requestId: Schema.String,
});
export type BridgeRequest = Schema.Schema.Type<typeof bridgeRequestSchema>;

export const bridgeResponseSchema = Schema.Struct({
  openDocumentId: nullableString,
  errorMessage: nullableString,
  issues: Schema.optional(Schema.NullOr(Schema.Array(validationIssueSchema))),
  metrics: performanceMetricsSchema,
  ok: Schema.Boolean,
  payloadJson: nullableString,
  requestId: Schema.String,
  statusCode: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type BridgeResponse = Schema.Schema.Type<typeof bridgeResponseSchema>;

export const bridgeStateSyncSchema = Schema.Struct({
  state: bridgeStateSnapshotSchema,
});
export type BridgeStateSync = Schema.Schema.Type<typeof bridgeStateSyncSchema>;

export const bridgeFrameSchema = Schema.Struct({
  disconnectReason: nullableString,
  event: Schema.optional(Schema.NullOr(bridgeEventSchema)),
  kind: Schema.Literals([
    "Registration",
    "RegistrationAck",
    "StateSync",
    "Request",
    "Response",
    "Event",
    "Disconnect",
  ]),
  registration: Schema.optional(Schema.NullOr(bridgeRegistrationRequestSchema)),
  registrationAck: Schema.optional(Schema.NullOr(bridgeRegistrationAckSchema)),
  request: Schema.optional(Schema.NullOr(bridgeRequestSchema)),
  response: Schema.optional(Schema.NullOr(bridgeResponseSchema)),
  stateSync: Schema.optional(Schema.NullOr(bridgeStateSyncSchema)),
});
export type BridgeFrame = Schema.Schema.Type<typeof bridgeFrameSchema>;
