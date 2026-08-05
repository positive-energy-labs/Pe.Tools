import {
  hostModuleDescriptorSchema,
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
export { HOST_RPC_BRIDGE_SESSION_HEADER } from "./contracts/bridge-protocol.js";

export const hostSessionScopeSchema = Schema.Struct({
  bridgeSessionId: Schema.optional(Schema.String),
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

export const RevitRecentDocumentSource = {
  RevitIni: "RevitIni",
  RegistryProfileMru: "RegistryProfileMru",
} as const;

export type RevitRecentDocumentSource =
  (typeof RevitRecentDocumentSource)[keyof typeof RevitRecentDocumentSource];

export const revitRecentDocumentSourceSchema = Schema.Literals(["RevitIni", "RegistryProfileMru"]);

export const RevitRecentDocumentPathKind = {
  LocalPath: "LocalPath",
  CloudPath: "CloudPath",
  Unknown: "Unknown",
} as const;

export type RevitRecentDocumentPathKind =
  (typeof RevitRecentDocumentPathKind)[keyof typeof RevitRecentDocumentPathKind];

export const revitRecentDocumentPathKindSchema = Schema.Literals([
  "LocalPath",
  "CloudPath",
  "Unknown",
]);

export type RevitRecentDocumentsRequest = Schema.Schema.Type<
  typeof revitRecentDocumentsRequestSchema
>;

export const revitRecentDocumentsRequestSchema = Schema.Struct({
  includeRegistryMru: Schema.optional(Schema.Boolean),
  localFilesOnly: Schema.optional(Schema.Boolean),
  revitYear: Schema.optional(Schema.NullOr(Schema.String)),
});

export type RevitRecentDocumentEntry = Schema.Schema.Type<typeof revitRecentDocumentEntrySchema>;

export const revitRecentDocumentEntrySchema = Schema.Struct({
  exists: Schema.optional(Schema.NullOr(Schema.Boolean)),
  path: Schema.String,
  pathKind: revitRecentDocumentPathKindSchema,
  profile: Schema.optional(Schema.NullOr(Schema.String)),
  rank: Schema.optional(Schema.NullOr(Schema.Number)),
  revitYear: Schema.String,
  source: revitRecentDocumentSourceSchema,
  title: Schema.String,
});

export type RevitRecentDocumentsData = Schema.Schema.Type<typeof revitRecentDocumentsDataSchema>;

export const revitRecentDocumentsDataSchema = Schema.Struct({
  documents: Schema.Array(revitRecentDocumentEntrySchema),
});

export const SettingsFileKind = {
  Profile: "Profile",
  Fragment: "Fragment",
  Schema: "Schema",
  Other: "Other",
} as const;

export type SettingsFileKind = (typeof SettingsFileKind)[keyof typeof SettingsFileKind];

export const settingsFileKindSchema = Schema.Literals(["Profile", "Fragment", "Schema", "Other"]);

export const SettingsDirectiveScope = {
  Local: "Local",
  Global: "Global",
} as const;

export type SettingsDirectiveScope =
  (typeof SettingsDirectiveScope)[keyof typeof SettingsDirectiveScope];

export const settingsDirectiveScopeSchema = Schema.Literals(["Local", "Global"]);

export const SettingsDocumentDependencyKind = {
  Include: "Include",
  Preset: "Preset",
} as const;

export type SettingsDocumentDependencyKind =
  (typeof SettingsDocumentDependencyKind)[keyof typeof SettingsDocumentDependencyKind];

export const settingsDocumentDependencyKindSchema = Schema.Literals(["Include", "Preset"]);

export type SettingsDocumentId = Schema.Schema.Type<typeof settingsDocumentIdSchema>;

export const settingsDocumentIdSchema = Schema.Struct({
  moduleKey: Schema.String,
  relativePath: Schema.String,
  rootKey: Schema.String,
  stableId: Schema.optional(Schema.String),
});

export type SettingsVersionToken = Schema.Schema.Type<typeof settingsVersionTokenSchema>;

export const settingsVersionTokenSchema = Schema.Struct({
  value: Schema.String,
});

export type SettingsDocumentMetadata = Schema.Schema.Type<typeof settingsDocumentMetadataSchema>;

export const settingsDocumentMetadataSchema = Schema.Struct({
  documentId: settingsDocumentIdSchema,
  kind: settingsFileKindSchema,
  modifiedUtc: Schema.optional(Schema.NullOr(Schema.String)),
  versionToken: Schema.optional(Schema.NullOr(settingsVersionTokenSchema)),
});

export type SettingsDocumentDependency = Schema.Schema.Type<
  typeof settingsDocumentDependencySchema
>;

export const settingsDocumentDependencySchema = Schema.Struct({
  directivePath: Schema.String,
  documentId: settingsDocumentIdSchema,
  kind: settingsDocumentDependencyKindSchema,
  scope: settingsDirectiveScopeSchema,
});

export type SettingsValidationIssue = Schema.Schema.Type<typeof settingsValidationIssueSchema>;

export const settingsValidationIssueSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  path: Schema.String,
  severity: Schema.String,
  suggestion: Schema.optional(Schema.NullOr(Schema.String)),
});

export type SettingsValidationResult = Schema.Schema.Type<typeof settingsValidationResultSchema>;

export const settingsValidationResultSchema = Schema.Struct({
  isValid: Schema.Boolean,
  issues: Schema.Array(settingsValidationIssueSchema),
});

export type SettingsDocumentSnapshot = Schema.Schema.Type<typeof settingsDocumentSnapshotSchema>;

export const settingsDocumentSnapshotSchema = Schema.Struct({
  capabilityHints: Schema.Record(Schema.String, Schema.String),
  composedContent: Schema.optional(Schema.NullOr(Schema.String)),
  dependencies: Schema.Array(settingsDocumentDependencySchema),
  metadata: settingsDocumentMetadataSchema,
  rawContent: Schema.String,
  validation: settingsValidationResultSchema,
});

export type OpenSettingsDocumentRequest = Schema.Schema.Type<
  typeof openSettingsDocumentRequestSchema
>;

export const openSettingsDocumentRequestSchema = Schema.Struct({
  documentId: settingsDocumentIdSchema,
  includeComposedContent: Schema.optional(Schema.Boolean),
});

export type SaveSettingsDocumentRequest = Schema.Schema.Type<
  typeof saveSettingsDocumentRequestSchema
>;

export const saveSettingsDocumentRequestSchema = Schema.Struct({
  createOnly: Schema.optional(Schema.Boolean),
  documentId: settingsDocumentIdSchema,
  expectedVersionToken: Schema.optional(Schema.NullOr(settingsVersionTokenSchema)),
  rawContent: Schema.String,
});

export type ValidateSettingsDocumentRequest = Schema.Schema.Type<
  typeof validateSettingsDocumentRequestSchema
>;

export const validateSettingsDocumentRequestSchema = Schema.Struct({
  documentId: settingsDocumentIdSchema,
  rawContent: Schema.String,
});

export type SaveSettingsDocumentResult = Schema.Schema.Type<
  typeof saveSettingsDocumentResultSchema
>;

export const saveSettingsDocumentResultSchema = Schema.Struct({
  conflictDetected: Schema.Boolean,
  conflictMessage: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: settingsDocumentMetadataSchema,
  validation: settingsValidationResultSchema,
  writeApplied: Schema.Boolean,
});

export type SettingsRootDescriptor = Schema.Schema.Type<typeof settingsRootDescriptorSchema>;

export const settingsRootDescriptorSchema = Schema.Struct({
  displayName: Schema.String,
  rootKey: Schema.String,
});

export type SettingsModuleWorkspaceDescriptor = Schema.Schema.Type<
  typeof settingsModuleWorkspaceDescriptorSchema
>;

export const settingsStorageOptionsSchema = Schema.Struct({
  includeRoots: Schema.optional(Schema.Array(Schema.String)),
  presetRoots: Schema.optional(Schema.Array(Schema.String)),
});

export const settingsModuleWorkspaceDescriptorSchema = Schema.Struct({
  defaultRootKey: Schema.String,
  moduleKey: Schema.String,
  roots: Schema.Array(settingsRootDescriptorSchema),
  storageOptions: Schema.optional(settingsStorageOptionsSchema),
});

export type OpenSettingsDocumentWithModuleRequest = Schema.Schema.Type<
  typeof openSettingsDocumentWithModuleRequestSchema
>;

export const openSettingsDocumentWithModuleRequestSchema = Schema.Struct({
  module: settingsModuleWorkspaceDescriptorSchema,
  request: openSettingsDocumentRequestSchema,
  schemaJson: Schema.optional(Schema.String),
});

export type SettingsWorkspaceDescriptor = Schema.Schema.Type<
  typeof settingsWorkspaceDescriptorSchema
>;

export const settingsWorkspaceDescriptorSchema = Schema.Struct({
  basePath: Schema.String,
  displayName: Schema.String,
  modules: Schema.Array(settingsModuleWorkspaceDescriptorSchema),
  workspaceKey: Schema.String,
});

export type SettingsWorkspacesData = Schema.Schema.Type<typeof settingsWorkspacesDataSchema>;

export const settingsWorkspacesDataSchema = Schema.Struct({
  workspaces: Schema.Array(settingsWorkspaceDescriptorSchema),
});

export type SettingsFileEntry = Schema.Schema.Type<typeof settingsFileEntrySchema>;

export const settingsFileEntrySchema = Schema.Struct({
  baseName: Schema.String,
  directory: Schema.optional(Schema.NullOr(Schema.String)),
  isFragment: Schema.Boolean,
  isSchema: Schema.Boolean,
  kind: settingsFileKindSchema,
  modifiedUtc: Schema.String,
  name: Schema.String,
  path: Schema.String,
  relativePath: Schema.String,
  relativePathWithoutExtension: Schema.String,
});

export type SettingsFileNode = Schema.Schema.Type<typeof settingsFileNodeSchema>;

export const settingsFileNodeSchema = Schema.Struct({
  id: Schema.String,
  isFragment: Schema.Boolean,
  isSchema: Schema.Boolean,
  kind: settingsFileKindSchema,
  modifiedUtc: Schema.String,
  name: Schema.String,
  relativePath: Schema.String,
  relativePathWithoutExtension: Schema.String,
});

export type SettingsDirectoryNode = {
  readonly directories: readonly SettingsDirectoryNode[];
  readonly files: readonly SettingsFileNode[];
  readonly name: string;
  readonly relativePath: string;
};

export const settingsDirectoryNodeSchema: Schema.Codec<SettingsDirectoryNode> = Schema.suspend(() =>
  Schema.Struct({
    directories: Schema.Array(settingsDirectoryNodeSchema),
    files: Schema.Array(settingsFileNodeSchema),
    name: Schema.String,
    relativePath: Schema.String,
  }),
);

export type SettingsDiscoveryResult = Schema.Schema.Type<typeof settingsDiscoveryResultSchema>;

export const settingsDiscoveryResultSchema = Schema.Struct({
  files: Schema.Array(settingsFileEntrySchema),
  root: settingsDirectoryNodeSchema,
});

export type SettingsTreeRequest = Schema.Schema.Type<typeof settingsTreeRequestSchema>;

export const settingsTreeRequestSchema = Schema.Struct({
  includeFragments: Schema.optional(Schema.Boolean),
  includeSchemas: Schema.optional(Schema.Boolean),
  moduleKey: Schema.optional(Schema.String),
  recursive: Schema.optional(Schema.Boolean),
  rootKey: Schema.optional(Schema.String),
  subDirectory: Schema.optional(Schema.NullOr(Schema.String)),
});

export const bridgeSessionsListSchema = Schema.Struct({
  sessions: Schema.Array(
    Schema.Struct({
      activeDocumentTitle: Schema.optional(Schema.NullOr(Schema.String)),
      // Observed facts reported at registration: normalized lane (rrd | sandbox | installed),
      // logical sandbox id, and the LOADED payload's build stamp. The host never computes
      // staleness from these — the SDK owns desired-state/freshness.
      buildStamp: Schema.optional(Schema.NullOr(Schema.String)),
      connected: Schema.Boolean,
      lane: Schema.optional(Schema.NullOr(Schema.String)),
      openDocumentCount: Schema.Number,
      processId: Schema.optional(Schema.NullOr(Schema.Number)),
      revitVersion: Schema.optional(Schema.NullOr(Schema.String)),
      runtimeFramework: Schema.optional(Schema.NullOr(Schema.String)),
      sandboxId: Schema.optional(Schema.NullOr(Schema.String)),
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
  disconnectReason: Schema.optional(Schema.NullOr(Schema.String)),
  executablePath: Schema.optional(Schema.String),
  hostContractVersion: Schema.Number,
  lane: Schema.optional(Schema.Literals(["dev", "installed"])),
  processId: Schema.optional(Schema.Number),
  runtimeIdentity: Schema.String,
  serviceName: Schema.String,
  sourceRoot: Schema.optional(Schema.NullOr(Schema.String)),
});

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
  availableModules: Schema.Array(hostModuleDescriptorSchema),
  bridgeIsConnected: Schema.Boolean,
  // Observed session metadata (lane/sandboxId/buildStamp) — facts as reported, never staleness.
  buildStamp: Schema.optional(Schema.NullOr(Schema.String)),
  lane: Schema.optional(Schema.NullOr(Schema.String)),
  openDocumentCount: Schema.Number,
  processId: Schema.optional(Schema.NullOr(Schema.Number)),
  revitVersion: Schema.optional(Schema.NullOr(Schema.String)),
  runtimeAssemblies: Schema.Array(hostRuntimeAssemblyDataSchema),
  runtimeFramework: Schema.optional(Schema.NullOr(Schema.String)),
  sandboxId: Schema.optional(Schema.NullOr(Schema.String)),
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

export const rhvacRoomSchema = Schema.Struct({
  /** Room autonumber PK — the edit lane's row target; distinct from `number`. */
  identifier: Schema.Number,
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
});
export type RhvacRoomData = Schema.Schema.Type<typeof rhvacRoomSchema>;

export const rhvacExtractSchema = Schema.Struct({
  sourceFile: Schema.String,
  building: Schema.Record(Schema.String, Schema.Number),
  // Systems carry `number` plus ~35 Calculated* fields; typed loosely on purpose.
  systems: Schema.Array(Schema.Record(Schema.String, Schema.Number)),
  rooms: Schema.Array(rhvacRoomSchema),
});
export type RhvacExtractData = Schema.Schema.Type<typeof rhvacExtractSchema>;

export const rhvacSaveRequestSchema = Schema.Struct({
  sourcePath: Schema.String,
  /** Must differ from sourcePath — the original .r10 is never written in place. */
  outputPath: Schema.String,
  edits: Schema.Struct({
    /** Full extract-shaped rooms (including identifier) — written back whole. */
    updates: Schema.Array(rhvacRoomSchema),
    /** Room identifiers (autonumber PK) to delete. */
    deletes: Schema.Array(Schema.Number),
  }),
});
export type RhvacSaveRequest = Schema.Schema.Type<typeof rhvacSaveRequestSchema>;

export const rhvacSaveResultSchema = Schema.Struct({
  outputPath: Schema.String,
  updated: Schema.Number,
  deleted: Schema.Number,
});
export type RhvacSaveResult = Schema.Schema.Type<typeof rhvacSaveResultSchema>;

export const rhvacRoomMapSchema = Schema.Struct({
  matches: Schema.Array(Schema.Struct({ oracleNumber: Schema.Number, candidate: Schema.String })),
  skip: Schema.Array(Schema.Struct({ oracleNumber: Schema.Number, reason: Schema.String })),
});

/** Raw takeoff snapshots next to the .r10 — the client parses the TSV texts itself. */
export const rhvacTakeoffDataSchema = Schema.Struct({
  tsvs: Schema.Array(Schema.Struct({ name: Schema.String, text: Schema.String })),
  roomMap: Schema.NullOr(rhvacRoomMapSchema),
});
export type RhvacTakeoffData = Schema.Schema.Type<typeof rhvacTakeoffDataSchema>;

export const rhvacPointSchema = Schema.Tuple([Schema.Number, Schema.Number]);

export const rhvacTakeoffResolutionSchema = Schema.Struct({
  candidateKey: Schema.String,
  flag: Schema.String,
  action: Schema.Literals(["accept", "split"]),
  params: Schema.optional(Schema.Struct({ a: rhvacPointSchema, b: rhvacPointSchema })),
});
export type RhvacTakeoffResolution = Schema.Schema.Type<typeof rhvacTakeoffResolutionSchema>;

export const rhvacResolutionsFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  resolutions: Schema.Array(rhvacTakeoffResolutionSchema),
});
export type RhvacResolutionsFile = Schema.Schema.Type<typeof rhvacResolutionsFileSchema>;

function compareOrdinal(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export const sortRhvacResolutions = (
  resolutions: readonly RhvacTakeoffResolution[],
): RhvacTakeoffResolution[] =>
  [...resolutions].sort(
    (a, b) => compareOrdinal(a.candidateKey, b.candidateKey) || compareOrdinal(a.flag, b.flag),
  );

export const rhvacTakeoffResolutionsRequestSchema = Schema.Struct({
  /** The .r10 FILE path; the sidecar is written beside its takeoff directory. */
  path: Schema.String,
  /** Omit to read the existing sidecar; provide to atomically replace it. */
  resolutions: Schema.optional(rhvacResolutionsFileSchema),
});
export type RhvacTakeoffResolutionsRequest = Schema.Schema.Type<
  typeof rhvacTakeoffResolutionsRequestSchema
>;

export const rhvacTakeoffResolutionsResultSchema = Schema.Struct({
  savedPath: Schema.String,
  /** Null when no sidecar exists yet. */
  resolutions: Schema.NullOr(rhvacResolutionsFileSchema),
});
export type RhvacTakeoffResolutionsResult = Schema.Schema.Type<
  typeof rhvacTakeoffResolutionsResultSchema
>;

export const tsOnlyOperationSchemas = {
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
  "logs.tail": {
    request: hostLogsRequestSchema,
    response: hostLogsDataSchema,
  },
  "revit.catalog.recent-documents": {
    request: revitRecentDocumentsRequestSchema,
    response: revitRecentDocumentsDataSchema,
  },
  "rhvac.open": {
    request: rhvacPathRequestSchema,
    response: rhvacExtractSchema,
  },
  "rhvac.assemblies": {
    request: rhvacPathRequestSchema,
    response: rhvacAssemblyCatalogSchema,
  },
  "rhvac.save": {
    request: rhvacSaveRequestSchema,
    response: rhvacSaveResultSchema,
  },
  "rhvac.takeoff": {
    request: rhvacPathRequestSchema,
    response: rhvacTakeoffDataSchema,
  },
  "rhvac.takeoff-resolutions": {
    request: rhvacTakeoffResolutionsRequestSchema,
    response: rhvacTakeoffResolutionsResultSchema,
  },
  "settings.document.open": {
    request: openSettingsDocumentRequestSchema,
    response: settingsDocumentSnapshotSchema,
  },
  "settings.document.open-with-module": {
    request: openSettingsDocumentWithModuleRequestSchema,
    response: settingsDocumentSnapshotSchema,
  },
  "settings.document.save": {
    request: saveSettingsDocumentRequestSchema,
    response: saveSettingsDocumentResultSchema,
  },
  "settings.document.validate": {
    request: validateSettingsDocumentRequestSchema,
    response: settingsValidationResultSchema,
  },
  "settings.tree": {
    request: settingsTreeRequestSchema,
    response: settingsDiscoveryResultSchema,
  },
  "settings.workspaces": {
    response: settingsWorkspacesDataSchema,
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
 * bridge ops — host_operation_search, the pea `operations` command, and the web ops page all read
 * that one catalog. These ops dispatch locally (call-route.ts) and don't need a Revit session.
 *
 * `origin:"host-local"` marks them so host-typegen SKIPS them: their request/response types are the
 * hand-authored schemas above (tsOnlyOperationSchemas), not generated from the live catalog, and the
 * entries carry no request/response schema JSON. Keep exactly one entry per tsOnlyOperationSchemas
 * key — the index test asserts full coverage.
 */
export const tsOnlyOperationCatalog: readonly HostLocalCatalogEntry[] = [
  {
    key: "revit.catalog.recent-documents",
    origin: "host-local",
    displayName: "Recent Documents",
    description:
      "Recently opened Revit documents, read from Revit.ini and the per-profile registry MRU on this machine. Works without a connected Revit session.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    requiresActiveDocument: false,
    requestTypeName: "RevitRecentDocumentsRequest",
    responseTypeName: "RevitRecentDocumentsData",
    searchTerms: [
      "recent",
      "documents",
      "recent files",
      "mru",
      "revit.ini",
      "open recent",
      "projects",
    ],
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
    requiresActiveDocument: false,
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
    requiresActiveDocument: false,
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacAssemblyCatalogData",
    searchTerms: ["rhvac", "r10", "assemblies", "constructions", "u-value", "materials"],
  },
  {
    key: "rhvac.save",
    origin: "host-local",
    displayName: "Save RHVAC Edits",
    description:
      "Apply room updates/deletes (by identifier) to a COPY of an .r10 file — the source is never written in place. Stored loads go stale until RHVAC recalculates.",
    intent: "Mutate",
    visibility: "DefaultVisible",
    costTier: "Mutation",
    requiresActiveDocument: false,
    requestTypeName: "RhvacSaveRequest",
    responseTypeName: "RhvacSaveResult",
    searchTerms: ["rhvac", "r10", "save", "edit", "update", "delete", "write"],
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
    requiresActiveDocument: false,
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacTakeoffData",
    searchTerms: ["rhvac", "takeoff", "tsv", "room map", "plan", "polygons"],
  },
  {
    key: "rhvac.takeoff-resolutions",
    origin: "host-local",
    displayName: "RHVAC Takeoff Resolutions",
    description:
      "Read or atomically replace deterministic ambiguity-flag resolutions in takeoff-resolutions.json beside an .r10 project's takeoff directory.",
    intent: "Mutate",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    requiresActiveDocument: false,
    requestTypeName: "RhvacTakeoffResolutionsRequest",
    responseTypeName: "RhvacTakeoffResolutionsResult",
    searchTerms: ["rhvac", "takeoff", "resolutions", "flags", "split", "accept", "sidecar"],
  },
  {
    key: "settings.workspaces",
    origin: "host-local",
    displayName: "Settings Workspaces",
    description: "Settings workspaces available to author, with their modules and roots.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    requestTypeName: "NoRequest",
    responseTypeName: "SettingsWorkspacesData",
    searchTerms: ["settings", "workspaces", "modules", "roots"],
  },
  {
    key: "settings.tree",
    origin: "host-local",
    displayName: "Settings Tree",
    description:
      "Browse the settings document tree (profiles, fragments, schemas) for a module and root.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
    requestTypeName: "SettingsTreeRequest",
    responseTypeName: "SettingsDiscoveryResult",
    searchTerms: ["settings", "tree", "browse", "documents", "fragments", "schemas"],
  },
  {
    key: "settings.document.open",
    origin: "host-local",
    displayName: "Open Settings Document",
    description:
      "Open a settings document: raw + composed content, metadata, dependencies, and validation.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Bounded",
    requestTypeName: "OpenSettingsDocumentRequest",
    responseTypeName: "SettingsDocumentSnapshot",
    searchTerms: ["settings", "open", "document", "profile", "composed"],
  },
  {
    key: "settings.document.open-with-module",
    origin: "host-local",
    displayName: "Open Settings Document (module)",
    description: "Open a settings document against an explicit module descriptor and schema.",
    intent: "Read",
    visibility: "EscalationVisible",
    costTier: "Bounded",
    requestTypeName: "OpenSettingsDocumentWithModuleRequest",
    responseTypeName: "SettingsDocumentSnapshot",
    searchTerms: ["settings", "open", "module", "schema"],
  },
  {
    key: "settings.document.validate",
    origin: "host-local",
    displayName: "Validate Settings Document",
    description: "Validate settings document content against its schema without saving.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Bounded",
    requestTypeName: "ValidateSettingsDocumentRequest",
    responseTypeName: "SettingsValidationResult",
    searchTerms: ["settings", "validate", "lint", "check"],
  },
  {
    key: "settings.document.save",
    origin: "host-local",
    displayName: "Save Settings Document",
    description:
      "Save a settings document with optimistic concurrency (version token); reports conflicts and validation.",
    intent: "Mutate",
    visibility: "DefaultVisible",
    costTier: "Mutation",
    requestTypeName: "SaveSettingsDocumentRequest",
    responseTypeName: "SaveSettingsDocumentResult",
    searchTerms: ["settings", "save", "write", "document", "profile"],
  },
  {
    key: "aps.auth.status",
    origin: "host-local",
    displayName: "APS Auth Status",
    description:
      "Autodesk Platform Services persisted-token status for the requested scope profile.",
    intent: "Read",
    visibility: "DefaultVisible",
    costTier: "Cheap",
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
    visibility: "DefaultVisible",
    costTier: "Bounded",
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
    visibility: "DefaultVisible",
    costTier: "Cheap",
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
    requestTypeName: "ApsTokenRequest",
    responseTypeName: "ApsTokenResult",
    searchTerms: ["aps", "autodesk", "token", "access token", "scope"],
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

export type HostOpResponse<K extends AnyOperationKey> = K extends HostOperationKey
  ? HostOps[K]["response"]
  : K extends TsOnlyOperationKey
    ? TsOnlyResponse<K>
    : never;

export type HostOpRequest<K extends AnyOperationKey> = K extends HostOperationKey
  ? HostOps[K]["request"]
  : K extends TsOnlyOperationKey
    ? TsOnlyRequest<K>
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
