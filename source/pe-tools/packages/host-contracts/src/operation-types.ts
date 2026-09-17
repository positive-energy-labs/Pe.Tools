import {
  bridgeDocumentSnapshotSchema,
  hostRuntimeAssemblyDataSchema,
  type HostOperationDefinition,
} from "./contracts/index.js";
import { hostOpKeys, type HostOps } from "./generated/host-ops.generated.js";
import { Schema } from "effect";

/** Bridge op keys, sourced from the checked-in live-session typegen output. */
export type HostOperationKey = keyof HostOps;
const hostOperationKeySet: ReadonlySet<string> = new Set(hostOpKeys);

type NoRequest = Record<string, never> | undefined;
type SchemaType<T extends Schema.Schema<any>> = Schema.Schema.Type<T>;

// --- APS auth (TS-owned ops) ---------------------------------------------------

export const ApsAuthFlowKind = {
  TwoLegged: "TwoLegged",
  ThreeLeggedConfidential: "ThreeLeggedConfidential",
} as const;
export const apsAuthFlowKindSchema = Schema.Literals(["TwoLegged", "ThreeLeggedConfidential"]);
export type ApsAuthFlowKind = Schema.Schema.Type<typeof apsAuthFlowKindSchema>;

export const ApsScopeProfile = {
  ParameterService: "ParameterService",
  AutomationManagement: "AutomationManagement",
  AutomationUserContext: "AutomationUserContext",
  AutomationArtifactStorage: "AutomationArtifactStorage",
} as const;
export const apsScopeProfileSchema = Schema.Literals([
  "ParameterService",
  "AutomationManagement",
  "AutomationUserContext",
  "AutomationArtifactStorage",
]);
export type ApsScopeProfile = Schema.Schema.Type<typeof apsScopeProfileSchema>;

export const apsTokenRequestSchema = Schema.Struct({
  explicitScopes: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  flowKind: Schema.optional(apsAuthFlowKindSchema),
  scopeProfile: Schema.optional(apsScopeProfileSchema),
});
export type ApsTokenRequest = Schema.Schema.Type<typeof apsTokenRequestSchema>;

export const apsPersistedTokenStatusSchema = Schema.Struct({
  exists: Schema.Boolean,
  expiresAtUtc: Schema.optional(Schema.NullOr(Schema.String)),
  flowKind: apsAuthFlowKindSchema,
  hasRefreshToken: Schema.Boolean,
  scopeProfile: apsScopeProfileSchema,
});
export type ApsPersistedTokenStatus = Schema.Schema.Type<typeof apsPersistedTokenStatusSchema>;

export const apsTokenResultSchema = Schema.Struct({
  accessToken: Schema.String,
  expiresAtUtc: Schema.String,
  flowKind: apsAuthFlowKindSchema,
  refreshToken: Schema.optional(Schema.NullOr(Schema.String)),
  scopeProfile: apsScopeProfileSchema,
});
export type ApsTokenResult = Schema.Schema.Type<typeof apsTokenResultSchema>;

export const apsLogoutResultSchema = Schema.Struct({
  loggedOut: Schema.Boolean,
});
export type ApsLogoutResult = Schema.Schema.Type<typeof apsLogoutResultSchema>;

// Preserve the long-standing operation-types import surface while the transport constant itself
// lives below the generated-contract boundary (host-typegen must not import its own output).
export {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
} from "./contracts/bridge-protocol.js";

export const hostSessionScopeSchema = Schema.Struct({
  bridgeSessionId: Schema.optional(Schema.String),
  openDocumentId: Schema.optional(Schema.String),
});

export type HostSessionScope = Schema.Schema.Type<typeof hostSessionScopeSchema>;

export const HostLogTarget = {
  Host: "Host",
  Revit: "Revit",
  All: "All",
} as const;

export type HostLogTarget = (typeof HostLogTarget)[keyof typeof HostLogTarget];

export const hostLogTargetSchema = Schema.Literals(["Host", "Revit", "All"]);

export type HostLogFileData = Schema.Schema.Type<typeof hostLogFileDataSchema>;

export type HostLogsData = Schema.Schema.Type<typeof hostLogsDataSchema>;

export type HostLogsRequest = Schema.Schema.Type<typeof hostLogsRequestSchema>;

export const hostLogFileDataSchema = Schema.Struct({
  label: Schema.String,
  filePath: Schema.String,
  lines: Schema.Array(Schema.String),
});

export const hostLogsDataSchema = Schema.Struct({
  files: Schema.Array(hostLogFileDataSchema),
});

export const hostLogsRequestSchema = Schema.Struct({
  target: hostLogTargetSchema,
  tailLineCount: Schema.Number,
});

export const hostShellOpenRequestSchema = Schema.Struct({
  path: Schema.String,
});
export type HostShellOpenRequest = Schema.Schema.Type<typeof hostShellOpenRequestSchema>;

export const hostShellOpenDataSchema = Schema.Struct({
  opened: Schema.Boolean,
  path: Schema.String,
});
export type HostShellOpenData = Schema.Schema.Type<typeof hostShellOpenDataSchema>;

// --- Pod members (host-local: the host owns member I/O so the web works offline) -------------

/** A pod member, everywhere: manifest `id` plus the member's pod-relative path. */
export const podMemberSchema = Schema.Struct({ pod: Schema.String, path: Schema.String });
export type PodMember = Schema.Schema.Type<typeof podMemberSchema>;

export const memberIssueSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  path: Schema.String,
  severity: Schema.Literals(["error", "warning", "info"]),
  suggestion: Schema.optional(Schema.NullOr(Schema.String)),
});
export type MemberIssue = Schema.Schema.Type<typeof memberIssueSchema>;

export const podListResponseSchema = Schema.Struct({
  pods: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      version: Schema.String,
      folder: Schema.String,
      entrypoints: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          sourcePath: Schema.String,
          name: Schema.optional(Schema.NullOr(Schema.String)),
          description: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
      members: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          sha256: Schema.String,
          schema: Schema.NullOr(Schema.String),
        }),
      ),
      diagnostics: Schema.Array(memberIssueSchema),
    }),
  ),
  /** Folders whose `pod.json` could not name a pod; they list nothing else. */
  unreadable: Schema.Array(Schema.Struct({ folder: Schema.String, message: Schema.String })),
});
export type PodList = Schema.Schema.Type<typeof podListResponseSchema>;

/** Runs of one pod, optionally narrowed to the member a route has open. */
export const podRunsRequestSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PodRunsRequest = Schema.Schema.Type<typeof podRunsRequestSchema>;

/** What `PodRuns.WriteReceipt` writes into `output/<runId>/receipt.json`. */
export const podReceiptSchema = Schema.Struct({
  podId: Schema.String,
  memberPath: Schema.String,
  memberSha256: Schema.String,
  operation: Schema.String,
  planHash: Schema.NullOr(Schema.String),
  outcome: Schema.String,
  outputs: Schema.Array(Schema.String),
  reason: Schema.NullOr(Schema.String),
});
export type PodReceipt = Schema.Schema.Type<typeof podReceiptSchema>;

export const podRunsResponseSchema = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({
      runId: Schema.String,
      receiptPath: Schema.String,
      /** Null exactly when the run folder holds no readable receipt; `error` says why. */
      receipt: Schema.NullOr(podReceiptSchema),
      error: Schema.NullOr(Schema.String),
    }),
  ),
});
export type PodRuns = Schema.Schema.Type<typeof podRunsResponseSchema>;

export const podMemberReadResponseSchema = Schema.Struct({
  content: Schema.String,
  sha256: Schema.String,
});
export type PodMemberRead = Schema.Schema.Type<typeof podMemberReadResponseSchema>;

/** Create only: refuses an existing path. */
export const podMemberWriteRequestSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  content: Schema.String,
});
export type PodMemberWriteRequest = Schema.Schema.Type<typeof podMemberWriteRequestSchema>;

/** Overwrite only the exact bytes the editor read. */
export const podMemberSaveRequestSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  content: Schema.String,
  expectedSha256: Schema.String,
});
export type PodMemberSaveRequest = Schema.Schema.Type<typeof podMemberSaveRequestSchema>;

export const podMemberWrittenSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  sha256: Schema.String,
});
export type PodMemberWritten = Schema.Schema.Type<typeof podMemberWrittenSchema>;

export const podMemberComposeRequestSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  /** The unsaved draft; absent composes the saved bytes. */
  content: Schema.optional(Schema.NullOr(Schema.String)),
  /** A schema the editor already holds; lets structural validation run with no session. */
  schemaJson: Schema.optional(Schema.String),
});
export type PodMemberComposeRequest = Schema.Schema.Type<typeof podMemberComposeRequestSchema>;

export const podMemberComposeResponseSchema = Schema.Struct({
  sha256: Schema.String,
  schemaUrl: Schema.NullOr(Schema.String),
  /** The schema the host validated against, so the editor can render its form. */
  schemaJson: Schema.NullOr(Schema.String),
  composed: Schema.NullOr(Schema.String),
  diagnostics: Schema.Array(memberIssueSchema),
  dependencies: Schema.Array(
    Schema.Struct({ id: Schema.String, path: Schema.String, sha256: Schema.String }),
  ),
  schemaValidation: Schema.Literals(["passed", "failed", "not-run", "no-schema", "unavailable"]),
  semanticValidation: Schema.Literals(["passed", "failed", "not-run", "unavailable"]),
});
export type PodMemberComposeResponse = Schema.Schema.Type<typeof podMemberComposeResponseSchema>;

export const bridgeSessionsListSchema = Schema.Struct({
  sessions: Schema.Array(
    Schema.Struct({
      activeDocumentCloudModelGuid: Schema.optional(Schema.NullOr(Schema.String)),
      activeDocumentPath: Schema.optional(Schema.NullOr(Schema.String)),
      activeDocumentTitle: Schema.optional(Schema.NullOr(Schema.String)),
      activeDocumentIsFamilyDocument: Schema.optional(Schema.NullOr(Schema.Boolean)),
      // Observation time of the active-document facts — an observation, never computed staleness.
      activeDocumentObservedAtUnixMs: Schema.optional(Schema.NullOr(Schema.Number)),
      // Observed facts reported at registration: the SDK's lane (dev | installed — payload SOURCE
      // only), the pe-revit session id when this payload was launched by pe-revit, and the LOADED
      // payload's build stamp. The host never computes staleness from these — the SDK owns
      // desired-state/freshness. `custody` is the broker's disclosure of the SDK's own word:
      // `controlled` (pe-revit holds a receipt) or `observed` (it does not). Disclosure, not a gate.
      buildStamp: Schema.optional(Schema.NullOr(Schema.String)),
      connected: Schema.Boolean,
      custody: Schema.optional(Schema.NullOr(Schema.String)),
      lane: Schema.optional(Schema.NullOr(Schema.String)),
      openDocumentCount: Schema.Number,
      openDocuments: Schema.NullOr(Schema.Array(bridgeDocumentSnapshotSchema)),
      processId: Schema.optional(Schema.NullOr(Schema.Number)),
      processStartUtcUnixMs: Schema.optional(Schema.NullOr(Schema.Number)),
      revitVersion: Schema.optional(Schema.NullOr(Schema.String)),
      runtimeFramework: Schema.optional(Schema.NullOr(Schema.String)),
      sdkSessionId: Schema.optional(Schema.NullOr(Schema.String)),
      // The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id.
      sessionId: Schema.String,
    }),
  ),
});

export type BridgeSessionsListData = Schema.Schema.Type<typeof bridgeSessionsListSchema>;
export type BridgeSessionListEntry = BridgeSessionsListData["sessions"][number];

export type HostProbeData = Schema.Schema.Type<typeof hostProbeDataSchema>;

export const hostProbeDataSchema = Schema.Struct({
  // Mastra tenant health (D4): a failed agent-runtime init degrades /pe/* to 503 instead of
  // taking the host down; this is where that state becomes observable (spawned hosts run
  // stdio-ignored). `error` is the persisted init failure, null when available or not yet settled.
  agentRuntime: Schema.optional(
    Schema.Struct({
      available: Schema.Boolean,
      error: Schema.NullOr(Schema.String),
    }),
  ),
  bridgeContractVersion: Schema.Number,
  bridgeIsConnected: Schema.Boolean,
  bridgePath: Schema.String,
  capabilities: Schema.Struct({ revit: Schema.Boolean }),
  controllerId: Schema.String,
  disconnectReason: Schema.optional(Schema.NullOr(Schema.String)),
  executablePath: Schema.optional(Schema.String),
  hostContractVersion: Schema.Number,
  lane: Schema.optional(Schema.Literals(["dev", "installed"])),
  processId: Schema.optional(Schema.Number),
  resourceId: Schema.String,
  runtimeIdentity: Schema.String,
  serviceName: Schema.String,
  sourceRoot: Schema.optional(Schema.NullOr(Schema.String)),
  world: Schema.Struct({
    id: Schema.String,
    root: Schema.String,
    storage: Schema.Struct({ kind: Schema.Literals(["local-unversioned"]) }),
    isolation: Schema.Literals(["none"]),
  }),
});

// The operator's map (ADR 0003 glance tier, host-side): host identity + every
// connected session in one snapshot, replacing the host.status + bridge.sessions.list
// client-side join. observedAtUtc is host clock — topology is a transport fact.
export const hostTopologyDataSchema = Schema.Struct({
  observedAtUtc: Schema.String,
  host: hostProbeDataSchema,
  sessions: bridgeSessionsListSchema.fields.sessions,
});

export type HostTopologyData = Schema.Schema.Type<typeof hostTopologyDataSchema>;

export type HostResourceFileStateData = Schema.Schema.Type<typeof hostResourceFileStateDataSchema>;

export const hostResourceFileStateDataSchema = Schema.Struct({
  exists: Schema.Boolean,
  label: Schema.String,
  lastWriteTimeUnixMs: Schema.optional(Schema.NullOr(Schema.Number)),
  note: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  provenance: Schema.String,
  sizeBytes: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type HostParameterResourceData = Schema.Schema.Type<typeof hostParameterResourceDataSchema>;

export const hostParameterResourceDataSchema = Schema.Struct({
  globalStateDirectoryPath: Schema.String,
  parameterServiceCacheFiles: Schema.Array(hostResourceFileStateDataSchema),
  sharedParametersFile: hostResourceFileStateDataSchema,
});

export type HostWorkbenchResourcesData = Schema.Schema.Type<
  typeof hostWorkbenchResourcesDataSchema
>;

export const hostWorkbenchResourcesDataSchema = Schema.Struct({
  parameters: hostParameterResourceDataSchema,
});

export type HostActiveDocumentSummary = Schema.Schema.Type<typeof hostActiveDocumentSummarySchema>;

export const hostActiveDocumentSummarySchema = Schema.Struct({
  cloudModelGuid: Schema.optional(Schema.NullOr(Schema.String)),
  cloudModelUrn: Schema.optional(Schema.NullOr(Schema.String)),
  cloudProjectGuid: Schema.optional(Schema.NullOr(Schema.String)),
  isFamilyDocument: Schema.Boolean,
  isModelInCloud: Schema.Boolean,
  isWorkshared: Schema.Boolean,
  key: Schema.optional(Schema.NullOr(Schema.String)),
  observedAtUnixMs: Schema.Number,
  path: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.optional(Schema.NullOr(Schema.String)),
});

export type HostSessionSummaryData = Schema.Schema.Type<typeof hostSessionSummaryDataSchema>;

export const hostSessionSummaryDataSchema = Schema.Struct({
  activeDocument: Schema.optional(Schema.NullOr(hostActiveDocumentSummarySchema)),
  bridgeIsConnected: Schema.Boolean,
  // Observed session metadata (custody/lane/sdkSessionId/buildStamp) — facts as reported, never
  // staleness.
  buildStamp: Schema.optional(Schema.NullOr(Schema.String)),
  custody: Schema.optional(Schema.NullOr(Schema.String)),
  lane: Schema.optional(Schema.NullOr(Schema.String)),
  openDocumentCount: Schema.Number,
  processId: Schema.optional(Schema.NullOr(Schema.Number)),
  revitVersion: Schema.optional(Schema.NullOr(Schema.String)),
  runtimeAssemblies: Schema.Array(hostRuntimeAssemblyDataSchema),
  runtimeFramework: Schema.optional(Schema.NullOr(Schema.String)),
  sdkSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  // The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id.
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  workbenchResources: hostWorkbenchResourcesDataSchema,
});

// --- RHVAC .r10 ops (TS-owned; spawn the repo's 32-bit Jet scripts) ------------
// The extract projection is the camelCase JSON emitted by
// source/Pe.Revit.Takeoff/Rhvac/extract-rhvac.ps1 — these schemas mirror it, not
// the C# RhvacRoom write shape (the host converts on save).

export const rhvacPathRequestSchema = Schema.Struct({
  /** Absolute host-visible path to the .r10 project file. */
  path: Schema.String,
});
export type RhvacPathRequest = Schema.Schema.Type<typeof rhvacPathRequestSchema>;

export const rhvacAssemblyOptionSchema = Schema.Struct({
  name: Schema.String,
  uValue: Schema.Number,
  shgc: Schema.optional(Schema.Number),
});

export const rhvacAssemblyCatalogSchema = Schema.Struct({
  sourceFile: Schema.optional(Schema.String),
  floors: Schema.Array(rhvacAssemblyOptionSchema),
  roofs: Schema.Array(rhvacAssemblyOptionSchema),
  walls: Schema.Array(rhvacAssemblyOptionSchema),
  glass: Schema.Array(rhvacAssemblyOptionSchema),
  doors: Schema.Array(rhvacAssemblyOptionSchema),
});
export type RhvacAssemblyCatalogData = Schema.Schema.Type<typeof rhvacAssemblyCatalogSchema>;

/**
 * Everything about a room except its autonumber PK. A room being INSERTED has no PK yet — Jet
 * assigns it — so the insert lane takes these fields alone and reports the assigned identifier back.
 */
const rhvacRoomFields = {
  number: Schema.Number,
  name: Schema.String,
  systemNumber: Schema.Number,
  zoneNumber: Schema.Number,
  areaSquareFeet: Schema.Number,
  ceilingHeightFeet: Schema.Number,
  people: Schema.Number,
  lightingWatts: Schema.Number,
  equipmentSensibleBtuh: Schema.Number,
  equipmentLatentBtuh: Schema.Number,
  ventilationCfm: Schema.Number,
  /** Stored RHVAC calc outputs — read-only, ignored on save. */
  loads: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  floors: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      areaSquareFeet: Schema.Number,
      exposedPerimeterFeet: Schema.Number,
    }),
  ),
  roofs: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      areaSquareFeet: Schema.Number,
      areaMultiplier: Schema.Number,
    }),
  ),
  walls: Schema.Array(
    Schema.Struct({
      /** 1-based wall ordinal — glass/doors point at this via wallReference. */
      index1: Schema.Number,
      assembly: Schema.String,
      uValue: Schema.Number,
      lengthFeet: Schema.Number,
      heightFeet: Schema.Number,
      direction: Schema.Number,
    }),
  ),
  glass: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      widthFeet: Schema.Number,
      heightFeet: Schema.Number,
      wallReference: Schema.Number,
      shgc: Schema.Number,
      occurrences: Schema.Number,
    }),
  ),
  doors: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      widthFeet: Schema.Number,
      heightFeet: Schema.Number,
      wallReference: Schema.Number,
    }),
  ),
} as const;

/** A room being inserted: no `identifier` yet — Jet's COUNTER assigns it. */
export const rhvacInsertRoomSchema = Schema.Struct(rhvacRoomFields);
export type RhvacInsertRoomData = Schema.Schema.Type<typeof rhvacInsertRoomSchema>;

export const rhvacRoomSchema = Schema.Struct({
  /** Room autonumber PK — the edit lane's row target; distinct from `number`. */
  identifier: Schema.Number,
  ...rhvacRoomFields,
});
export type RhvacRoomData = Schema.Schema.Type<typeof rhvacRoomSchema>;

/** Weak .r10 identity: file name plus a stamp over project/client titles. */
export const rhvacFileIdentitySchema = Schema.Struct({
  fileName: Schema.String,
  projectTitle: Schema.String,
  clientName: Schema.String,
  stamp: Schema.String,
});
export type RhvacFileIdentity = Schema.Schema.Type<typeof rhvacFileIdentitySchema>;

export const rhvacExtractSchema = Schema.Struct({
  sourceFile: Schema.String,
  fileIdentity: rhvacFileIdentitySchema,
  building: Schema.Record(Schema.String, Schema.Number),
  systems: Schema.Array(Schema.Struct({ number: Schema.Number, name: Schema.String })),
  rooms: Schema.Array(rhvacRoomSchema),
});
export type RhvacExtractData = Schema.Schema.Type<typeof rhvacExtractSchema>;

export const rhvacSyncRequestSchema = Schema.Struct({
  /** The .r10 to sync IN PLACE — behind a lock check, a working copy, and a timestamped backup. */
  targetPath: Schema.String,
  /** New rooms. Their assigned `identifier`s come back in the result. */
  inserts: Schema.Array(rhvacInsertRoomSchema),
  /** Existing rooms, targeted by `identifier`; written back whole. */
  updates: Schema.Array(rhvacRoomSchema),
  /**
   * Systems the rooms reference. An existing `number` is left exactly as the engineer has it
   * (never renamed); a missing one is seeded by cloning the lowest-numbered System row and
   * overriding number + name only. See eval/rhvac/template/SYSTEM-INSERT-PROBE.md.
   */
  systems: Schema.optional(
    Schema.Array(Schema.Struct({ number: Schema.Number, name: Schema.String })),
  ),
  /** Delete the template's blank Room (Identifier 1) — only if it is still untouched. */
  deleteUntouchedSeedRoom: Schema.optional(Schema.Boolean),
  /** Validate and keep the working copy without swapping the target. */
  whatIf: Schema.optional(Schema.Boolean),
});
export type RhvacSyncRequest = Schema.Schema.Type<typeof rhvacSyncRequestSchema>;

/**
 * Weak by necessity: an .r10 carries NO GUID or stable id anywhere (probed — Project is 9 free-text
 * columns, Client 9, Version 6 build numbers). `stamp` hashes the engineer-facing project + client
 * titles, so it survives copying or renaming the FILE and changes when the project is retitled.
 * All four parts are reported so a caller pairing {fileIdentity, roomIdentifier} into Revit
 * provenance can detect drift rather than silently trust a match.
 */
export const rhvacSyncResultSchema = Schema.Struct({
  targetPath: Schema.String,
  /** Null when nothing was swapped (whatIf). */
  backupPath: Schema.NullOr(Schema.String),
  swapped: Schema.Boolean,
  fileIdentity: rhvacFileIdentitySchema,
  /** Every requested system, with `seeded` false for ones that already existed. */
  systems: Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      name: Schema.String,
      identifier: Schema.Number,
      seeded: Schema.Boolean,
    }),
  ),
  /** Room number -> the Jet-assigned autonumber PK, read back after the insert. */
  insertedRooms: Schema.Array(
    Schema.Struct({ number: Schema.Number, name: Schema.String, identifier: Schema.Number }),
  ),
  updated: Schema.Number,
  seedRoom: Schema.Struct({
    identifier: Schema.Number,
    action: Schema.Literals(["deleted", "kept", "not-requested"]),
    reason: Schema.String,
  }),
  /**
   * Rooms whose assembly was in neither the target file nor the preset catalog: that category was
   * written as one explicit zero row (no load), never a guessed material. Surface these.
   */
  assemblyFallbacks: Schema.Array(
    Schema.Struct({
      roomNumber: Schema.Number,
      roomName: Schema.String,
      category: Schema.String,
      assemblies: Schema.Array(Schema.String),
    }),
  ),
  roomsBefore: Schema.Number,
  roomsAfter: Schema.Number,
  /** The safety envelope's own transcript (lock check, census, validation, swap). */
  log: Schema.String,
});
export type RhvacSyncResult = Schema.Schema.Type<typeof rhvacSyncResultSchema>;

export const rhvacLaunchResultSchema = Schema.Struct({
  path: Schema.String,
  /** True once the shell accepted the open; RHVAC's own startup is not awaited. */
  launched: Schema.Boolean,
});
export type RhvacLaunchResult = Schema.Schema.Type<typeof rhvacLaunchResultSchema>;

/** The legal-options source for the takeoffs `.r10` binding: every .r10 in one folder. */
export const rhvacListRequestSchema = Schema.Struct({
  /** Absolute host-visible folder. */
  dir: Schema.String,
});
export type RhvacListRequest = Schema.Schema.Type<typeof rhvacListRequestSchema>;
export const rhvacListDataSchema = Schema.Struct({
  dir: Schema.String,
  /** False when the folder does not exist or is unreadable — an empty list then means "no folder", not "no files". */
  exists: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({ name: Schema.String, path: Schema.String, modifiedUnixMs: Schema.Number }),
  ),
});
export type RhvacListData = Schema.Schema.Type<typeof rhvacListDataSchema>;

export const rhvacRoomMapSchema = Schema.Struct({
  matches: Schema.Array(Schema.Struct({ oracleNumber: Schema.Number, candidate: Schema.String })),
  skip: Schema.Array(Schema.Struct({ oracleNumber: Schema.Number, reason: Schema.String })),
});

/** Raw takeoff snapshots next to the .r10 — the client parses the TSV texts itself. */
export const rhvacTakeoffDataSchema = Schema.Struct({
  tsvs: Schema.Array(
    Schema.Struct({ name: Schema.String, text: Schema.String, sha256: Schema.String }),
  ),
  roomMap: Schema.NullOr(rhvacRoomMapSchema),
});
export type RhvacTakeoffData = Schema.Schema.Type<typeof rhvacTakeoffDataSchema>;

export const tsOnlyOperationSchemas = {
  "takeoffs.saved": {
    request: Schema.Struct({
      captureId: Schema.optional(Schema.String),
      document: Schema.optional(Schema.String),
      /** With a captureId: return that file's exact stored text and path instead of its data. */
      text: Schema.optional(Schema.Boolean),
    }),
    // Portable capture validation belongs to agent-contracts, beside TakeoffSnapshot.
    response: Schema.Unknown,
  },
  "aps.auth.login": {
    request: apsTokenRequestSchema,
    response: apsPersistedTokenStatusSchema,
  },
  "aps.auth.logout": {
    response: apsLogoutResultSchema,
  },
  "aps.auth.status": {
    request: apsTokenRequestSchema,
    response: apsPersistedTokenStatusSchema,
  },
  "aps.auth.token": {
    request: apsTokenRequestSchema,
    response: apsTokenResultSchema,
  },
  "bridge.sessions.list": {
    response: bridgeSessionsListSchema,
  },
  "bridge.sessions.summary": {
    response: hostSessionSummaryDataSchema,
  },
  "host.status": {
    response: hostProbeDataSchema,
  },
  "host.shell.open": {
    request: hostShellOpenRequestSchema,
    response: hostShellOpenDataSchema,
  },
  "host.topology": {
    response: hostTopologyDataSchema,
  },
  "logs.tail": {
    request: hostLogsRequestSchema,
    response: hostLogsDataSchema,
  },
  "rhvac.open": {
    request: rhvacPathRequestSchema,
    response: rhvacExtractSchema,
  },
  "rhvac.assemblies": {
    request: rhvacPathRequestSchema,
    response: rhvacAssemblyCatalogSchema,
  },
  "rhvac.sync": {
    request: rhvacSyncRequestSchema,
    response: rhvacSyncResultSchema,
  },
  "rhvac.launch": {
    request: rhvacPathRequestSchema,
    response: rhvacLaunchResultSchema,
  },
  "rhvac.takeoff": {
    request: rhvacPathRequestSchema,
    response: rhvacTakeoffDataSchema,
  },
  "rhvac.list": {
    request: rhvacListRequestSchema,
    response: rhvacListDataSchema,
  },
  "pod.list": {
    response: podListResponseSchema,
  },
  "pod.runs": {
    request: podRunsRequestSchema,
    response: podRunsResponseSchema,
  },
  "pod.member.read": {
    request: podMemberSchema,
    response: podMemberReadResponseSchema,
  },
  "pod.member.write": {
    request: podMemberWriteRequestSchema,
    response: podMemberWrittenSchema,
  },
  "pod.member.save": {
    request: podMemberSaveRequestSchema,
    response: podMemberWrittenSchema,
  },
  "pod.member.compose": {
    request: podMemberComposeRequestSchema,
    response: podMemberComposeResponseSchema,
  },
} as const;

export type TsOnlyOperationKey = keyof typeof tsOnlyOperationSchemas;
export type AnyOperationKey = HostOperationKey | TsOnlyOperationKey;
type TsOnlyOperationSchemas = typeof tsOnlyOperationSchemas;
type TsOnlyRequest<K extends TsOnlyOperationKey> = TsOnlyOperationSchemas[K] extends {
  readonly request: infer RequestSchema extends Schema.Schema<any>;
}
  ? SchemaType<RequestSchema>
  : NoRequest;
type TsOnlyResponse<K extends TsOnlyOperationKey> = SchemaType<
  TsOnlyOperationSchemas[K]["response"]
>;

export function isAnyOperationKey(key: string): key is AnyOperationKey {
  return hostOperationKeySet.has(key) || Object.hasOwn(tsOnlyOperationSchemas, key);
}

export function isHostOperationKey(key: string): key is HostOperationKey {
  return hostOperationKeySet.has(key);
}

export function isTsOnlyOperationKey(key: string): key is TsOnlyOperationKey {
  return Object.hasOwn(tsOnlyOperationSchemas, key);
}

export type HostLocalCatalogEntry = HostOperationDefinition & {
  readonly key: TsOnlyOperationKey;
  readonly origin: "host-local";
};

/**
 * Discovery metadata for the TS-only (host-local) ops so `GET /ops` lists them next to the Revit
 * bridge ops — pe_find, the pea `operations` command, and the web ops page all read
 * that one catalog. These ops dispatch locally (call-route.ts) and don't need a Revit session.
 *
 * `origin:"host-local"` marks them so host-typegen SKIPS them: their request/response types are the
 * hand-authored schemas above (tsOnlyOperationSchemas), not generated from the live catalog, and the
 * entries carry no request/response schema JSON. Keep exactly one entry per tsOnlyOperationSchemas
 * key — the index test asserts full coverage.
 */
export const tsOnlyOperationCatalog: readonly HostLocalCatalogEntry[] = [
  {
    key: "takeoffs.saved",
    origin: "host-local",
    displayName: "Saved Takeoffs captures",
    description:
      "Read durable geometry without Revit. With captureId, return that immutable dated capture. Otherwise list capture identities, times and documents; optional document filters the list. Migrated captures explicitly have unknown original target provenance and are never live evidence.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "SavedTakeoffsRequest",
    responseTypeName: "TakeoffCapture",
    searchTerms: ["takeoffs", "saved", "capture", "offline", "geometry", "review"],
  },
  {
    key: "host.shell.open",
    origin: "host-local",
    displayName: "Open Path",
    description:
      "Open an existing absolute file or directory path with the operating system default handler. No Revit session is needed.",
    intent: "Mutate",
    visibility: "EscalationVisible",
    costTier: "Mutation",
    needs: "nothing",
    requestTypeName: "HostShellOpenRequest",
    responseTypeName: "HostShellOpenData",
    searchTerms: ["host", "shell", "open", "file", "directory", "default app", "artifact"],
  },
  {
    key: "rhvac.open",
    origin: "host-local",
    displayName: "Open RHVAC Project",
    description:
      "Extract an Elite RHVAC .r10 Manual J project to JSON: building totals, systems, and rooms with identifiers. Runs the repo's 32-bit Jet lane; no Revit session needed.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Bounded",
    needs: "nothing",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacExtractData",
    searchTerms: ["rhvac", "r10", "manual j", "open", "extract", "rooms", "loads"],
  },
  {
    key: "rhvac.assemblies",
    origin: "host-local",
    displayName: "RHVAC Assemblies",
    description:
      "Distinct construction assemblies per category (floors/roofs/walls/glass/doors) used in an .r10 file, with U-values (glass: + SHGC). The editor's assembly picker source.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Bounded",
    needs: "nothing",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacAssemblyCatalogData",
    searchTerms: ["rhvac", "r10", "assemblies", "constructions", "u-value", "materials"],
  },
  {
    key: "rhvac.sync",
    origin: "host-local",
    displayName: "Sync RHVAC Project",
    description:
      "One atomic sync of an .r10 IN PLACE: seed systems, insert new rooms, update existing ones, optionally drop the template's blank seed room. Refuses while RHVAC holds the file, works on a copy, validates, then swaps with a timestamped backup. Returns each inserted room's assigned identifier plus the file identity to pair with Revit provenance.",
    intent: "Mutate",
    visibility: "DefaultVisible",
    costTier: "Mutation",
    needs: "nothing",
    requestTypeName: "RhvacSyncRequest",
    responseTypeName: "RhvacSyncResult",
    searchTerms: [
      "rhvac",
      "r10",
      "sync",
      "export",
      "insert",
      "rooms",
      "systems",
      "takeoff",
      "backup",
    ],
  },
  {
    key: "rhvac.launch",
    origin: "host-local",
    displayName: "Open .r10 in RHVAC",
    description:
      "Open an .r10 file with its Windows file association (Elite RHVAC). Fire-and-forget: the shell owns the app, and load recalculation is a manual step in RHVAC.",
    intent: "Mutate",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacLaunchResult",
    searchTerms: ["rhvac", "r10", "launch", "open", "start", "elite", "shell"],
  },
  {
    key: "rhvac.list",
    origin: "host-local",
    displayName: "List .r10 files",
    description:
      "List the .r10 Manual J project files in one host-visible folder. The legal-options source for a route's .r10 binding; a missing folder is an empty list with exists=false.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "RhvacListRequest",
    responseTypeName: "RhvacListData",
    searchTerms: ["rhvac", "r10", "list", "folder", "files", "manual j"],
  },
  {
    key: "rhvac.takeoff",
    origin: "host-local",
    displayName: "RHVAC Takeoff Snapshots",
    description:
      "Raw takeoff TSV snapshots (<dir>/takeoff/*.tsv) and room-map.json found next to an .r10 file. Empty result when none exist.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacTakeoffData",
    searchTerms: ["rhvac", "takeoff", "tsv", "room map", "plan", "polygons"],
  },
  {
    key: "pod.list",
    origin: "host-local",
    displayName: "Pods",
    description:
      "Every installed pod under Documents/Pe.Tools/Pods: manifest id, name, version, folder, entrypoints, and members with sha256 and $schema. Members only — runs under output/ answer to pod.runs. Diagnostics cover the manifest only; a bad member never hides its siblings.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "NoRequest",
    responseTypeName: "PodList",
    searchTerms: ["pods", "members", "settings", "specs", "list", "browse"],
  },
  {
    key: "pod.runs",
    origin: "host-local",
    displayName: "Pod Runs",
    description:
      "Run receipts under one pod's output/<runId>/, newest first, optionally narrowed to one member path. A run folder with no readable receipt still lists, with the reason.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "PodRunsRequest",
    responseTypeName: "PodRuns",
    searchTerms: ["pod", "runs", "receipts", "output", "apply", "history"],
  },
  {
    key: "pod.member.read",
    origin: "host-local",
    displayName: "Read Pod Member",
    description: "Read one pod member's exact text and sha256, addressed as { pod, path }.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "PodMember",
    responseTypeName: "PodMemberRead",
    searchTerms: ["pod", "member", "read", "open", "spec", "settings"],
  },
  {
    key: "pod.member.write",
    origin: "host-local",
    displayName: "Write Pod Member",
    description:
      "Create a new pod member; refuses an existing path. Returns the written sha256. Capture and save-as-new use this.",
    intent: "Mutate",
    visibility: "EscalationVisible",
    costTier: "Mutation",
    needs: "nothing",
    requestTypeName: "PodMemberWriteRequest",
    responseTypeName: "PodMemberWritten",
    searchTerms: ["pod", "member", "write", "create", "capture", "spec"],
  },
  {
    key: "pod.member.save",
    origin: "host-local",
    displayName: "Save Pod Member",
    description:
      "Overwrite an existing pod member only when expectedSha256 names its current bytes. Returns the new sha256.",
    intent: "Mutate",
    visibility: "EscalationVisible",
    costTier: "Mutation",
    needs: "nothing",
    requestTypeName: "PodMemberSaveRequest",
    responseTypeName: "PodMemberWritten",
    searchTerms: ["pod", "member", "save", "overwrite", "edit", "spec"],
  },
  {
    key: "pod.member.compose",
    origin: "host-local",
    displayName: "Compose Pod Member",
    description:
      "Validate a member or unsaved draft: JSON schema structure in the host (offline), composition and semantic checks through the Revit session when one is attached. Without a session, $include/$preset members report that composition needs Revit.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Bounded",
    needs: "nothing",
    requestTypeName: "PodMemberComposeRequest",
    responseTypeName: "PodMemberComposeResponse",
    searchTerms: ["pod", "member", "compose", "validate", "schema", "include", "preset"],
  },
  {
    key: "aps.auth.status",
    origin: "host-local",
    displayName: "APS Auth Status",
    description:
      "Autodesk Platform Services persisted-token status for the requested scope profile.",
    intent: "Read",
    visibility: "EscalationVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "ApsTokenRequest",
    responseTypeName: "ApsPersistedTokenStatus",
    searchTerms: ["aps", "autodesk", "auth", "token", "status", "credentials"],
  },
  {
    key: "aps.auth.login",
    origin: "host-local",
    displayName: "APS Auth Login",
    description: "Begin an Autodesk Platform Services auth flow and persist the resulting token.",
    intent: "Mutate",
    visibility: "EscalationVisible",
    costTier: "Bounded",
    needs: "nothing",
    requestTypeName: "ApsTokenRequest",
    responseTypeName: "ApsPersistedTokenStatus",
    searchTerms: ["aps", "autodesk", "auth", "login", "sign in", "oauth"],
  },
  {
    key: "aps.auth.logout",
    origin: "host-local",
    displayName: "APS Auth Logout",
    description: "Clear the persisted Autodesk Platform Services token.",
    intent: "Mutate",
    visibility: "EscalationVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "NoRequest",
    responseTypeName: "ApsLogoutResult",
    searchTerms: ["aps", "autodesk", "auth", "logout", "sign out"],
  },
  {
    key: "aps.auth.token",
    origin: "host-local",
    displayName: "APS Access Token",
    description:
      "Fetch a valid Autodesk Platform Services access token for the requested scope profile.",
    intent: "Read",
    visibility: "EscalationVisible",
    costTier: "Bounded",
    needs: "nothing",
    requestTypeName: "ApsTokenRequest",
    responseTypeName: "ApsTokenResult",
    searchTerms: ["aps", "autodesk", "token", "access token", "scope"],
  },
  {
    key: "host.topology",
    origin: "host-local",
    displayName: "Session Topology",
    description:
      "The operator's map in one snapshot: host identity/health plus every connected Revit session (custody, lane, pe-revit session id, pid, open documents). Replaces the host.status + bridge.sessions.list join; observedAtUtc stamps freshness (host clock).",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "NoRequest",
    responseTypeName: "HostTopologyData",
    searchTerms: ["topology", "sessions", "glance", "operator", "map", "connected", "lanes"],
  },
  {
    key: "host.status",
    origin: "host-local",
    displayName: "Host Status",
    description:
      "Host process health: contract versions, bridge connectivity, lane, and agent-runtime availability.",
    intent: "Read",
    visibility: "ExpertOnly",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "NoRequest",
    responseTypeName: "HostProbeData",
    searchTerms: ["host", "status", "health", "diagnostics", "contract", "runtime", "lane"],
  },
  {
    key: "bridge.sessions.summary",
    origin: "host-local",
    displayName: "Bridge Session Summary",
    description:
      "Active Revit session summary: open document, available modules, and runtime assemblies.",
    intent: "Read",
    visibility: "EscalationVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "NoRequest",
    responseTypeName: "HostSessionSummaryData",
    searchTerms: ["bridge", "session", "summary", "active document", "modules"],
  },
  {
    key: "bridge.sessions.list",
    origin: "host-local",
    displayName: "Bridge Sessions",
    description: "All connected Revit bridge sessions (process id, version, open documents).",
    intent: "Read",
    visibility: "ExpertOnly",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "NoRequest",
    responseTypeName: "BridgeSessionsListData",
    searchTerms: ["bridge", "sessions", "list", "connected", "revit"],
  },
  {
    key: "logs.tail",
    origin: "host-local",
    displayName: "Tail Logs",
    description: "Tail the host and Revit add-in log files for diagnostics.",
    intent: "Read",
    visibility: "EscalationVisible",
    costTier: "Cheap",
    needs: "nothing",
    requestTypeName: "HostLogsRequest",
    responseTypeName: "HostLogsData",
    searchTerms: ["logs", "tail", "host log", "revit log", "diagnostics"],
  },
];

/**
 * Strict key space for the typed client surface: only keys the checked-in
 * typegen output (or the hand-authored TS-only map) knows about. Runtime-
 * registered ops the types haven't caught up with go through the explicit
 * dynamic escape hatch (`callHostDynamic`) instead of weakening every call.
 */
export type OpKey = AnyOperationKey;

export type OpRequestOf<K extends AnyOperationKey> = HostOpRequest<K>;
export type OpResponseOf<K extends AnyOperationKey> = HostOpResponse<K>;

/**
 * Trailing args for a typed op call: the request stays optional only when the
 * op's request type has no required members ({} satisfies it) — an op with
 * required inputs cannot be called without a request object.
 */
export type OpCallArgs<K extends AnyOperationKey, Options> =
  {} extends OpRequestOf<K>
    ? [request?: OpRequestOf<K>, options?: Options]
    : [request: OpRequestOf<K>, options?: Options];

// A host-local op is dispatched by the host even when a bridge op shares its key.
export type HostOpResponse<K extends AnyOperationKey> = K extends TsOnlyOperationKey
  ? TsOnlyResponse<K>
  : K extends HostOperationKey
    ? HostOps[K]["response"]
    : never;

export type HostOpRequest<K extends AnyOperationKey> = K extends TsOnlyOperationKey
  ? TsOnlyRequest<K>
  : K extends HostOperationKey
    ? HostOps[K]["request"]
    : never;

export const hostProblemDetailsSchema = Schema.Record(Schema.String, Schema.Unknown);

export type HostProblemDetails = Schema.Schema.Type<typeof hostProblemDetailsSchema>;

export class HostCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problem?: HostProblemDetails,
  ) {
    super(message);
    this.name = "HostCallError";
  }
}
