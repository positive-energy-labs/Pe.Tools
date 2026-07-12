// Hand-authored wire contract. Keep aligned with Pe.Shared.HostContracts.Bridge (C#) — the codegen that
// once produced this file is deleted; changes here are ordinary code review, not regeneration.

import { Schema } from "effect";

export const HOST_CONTRACT_VERSION = 36 as const;
export const BRIDGE_CONTRACT_VERSION = 19 as const;
export const BRIDGE_PATH = "/api/bridge" as const;

const nullableString = Schema.optional(Schema.NullOr(Schema.String));

export const hostModuleDescriptorSchema = Schema.Struct({
  activeDocumentKind: Schema.Literals(["Any", "ProjectOnly", "FamilyOnly"]),
  defaultRootKey: Schema.String,
  moduleKey: Schema.String,
  scope: Schema.Literals(["Host", "Session", "ActiveDocument"]),
});
export type HostModuleDescriptor = Schema.Schema.Type<typeof hostModuleDescriptorSchema>;

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
  availableModules: Schema.Array(hostModuleDescriptorSchema),
  hasActiveDocument: Schema.Boolean,
  openDocumentCount: Schema.Number,
  revitVersion: Schema.String,
  runtimeAssemblies: Schema.Array(hostRuntimeAssemblyDataSchema),
  runtimeFramework: Schema.String,
  sharedParametersFilename: nullableString,
});
export type BridgeStateSnapshot = Schema.Schema.Type<typeof bridgeStateSnapshotSchema>;

// Session = one Revit process incarnation; connection = one WS attachment to it. The identity
// tuple is pid + processStartUtcUnixMs (the broker hashes it into the session id); lane/
// sandboxId/buildStamp/sessionDescriptorPath are selectors and observed metadata, never identity.
// All optional — absent fields decode fine, so BRIDGE_CONTRACT_VERSION stays 19 on purpose.
export const bridgeRegistrationRequestSchema = Schema.Struct({
  buildStamp: nullableString,
  contractVersion: Schema.Number,
  lane: nullableString,
  processId: Schema.Number,
  processStartUtcUnixMs: Schema.optional(Schema.NullOr(Schema.Number)),
  sandboxId: nullableString,
  sessionDescriptorPath: nullableString,
  state: bridgeStateSnapshotSchema,
});
export type BridgeRegistrationRequest = Schema.Schema.Type<typeof bridgeRegistrationRequestSchema>;

export const bridgeRequestSchema = Schema.Struct({
  operationKey: Schema.String,
  payloadJson: Schema.String,
  requestId: Schema.String,
});
export type BridgeRequest = Schema.Schema.Type<typeof bridgeRequestSchema>;

export const bridgeResponseSchema = Schema.Struct({
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
