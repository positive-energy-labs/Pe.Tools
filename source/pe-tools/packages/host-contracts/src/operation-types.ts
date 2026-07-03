import {
  hostErrorKindSchema,
  hostModuleDescriptorSchema,
  hostOperations,
  hostRuntimeAssemblyDataSchema,
  type HostErrorKind,
  type HostOperationKey,
} from "./contracts/index.js";
import { hostEffectOperationSchemas } from "./effect/host-op-schemas.generated.js";
import {
  apsLogoutResultSchema,
  apsPersistedTokenStatusSchema,
  apsTokenRequestSchema,
  apsTokenResultSchema,
} from "./effect/host-effect.generated.js";
import { Schema } from "effect";

type NoRequest = Record<string, never> | undefined;
type SchemaType<T extends Schema.Schema<any>> = Schema.Schema.Type<T>;

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

export const settingsModuleWorkspaceDescriptorSchema = Schema.Struct({
  defaultRootKey: Schema.String,
  moduleKey: Schema.String,
  roots: Schema.Array(settingsRootDescriptorSchema),
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
      connected: Schema.Boolean,
      openDocumentCount: Schema.Number,
      processId: Schema.optional(Schema.NullOr(Schema.Number)),
      revitVersion: Schema.optional(Schema.NullOr(Schema.String)),
      runtimeFramework: Schema.optional(Schema.NullOr(Schema.String)),
      sessionId: Schema.String,
    }),
  ),
});

export type BridgeSessionsListData = Schema.Schema.Type<typeof bridgeSessionsListSchema>;
export type BridgeSessionListEntry = BridgeSessionsListData["sessions"][number];

export type HostProbeData = Schema.Schema.Type<typeof hostProbeDataSchema>;

export const hostProbeDataSchema = Schema.Struct({
  bridgeContractVersion: Schema.Number,
  bridgeIsConnected: Schema.Boolean,
  bridgePath: Schema.String,
  disconnectReason: Schema.optional(Schema.NullOr(Schema.String)),
  executablePath: Schema.optional(Schema.String),
  hostContractVersion: Schema.Number,
  lane: Schema.optional(Schema.Literals(["dev", "installed"])),
  processId: Schema.optional(Schema.Number),
  runtimeIdentity: Schema.String,
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
  openDocumentCount: Schema.Number,
  processId: Schema.optional(Schema.NullOr(Schema.Number)),
  revitVersion: Schema.optional(Schema.NullOr(Schema.String)),
  runtimeAssemblies: Schema.Array(hostRuntimeAssemblyDataSchema),
  runtimeFramework: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  workbenchResources: hostWorkbenchResourcesDataSchema,
});

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
  "settings.document.open": {
    request: openSettingsDocumentRequestSchema,
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
type GeneratedOperationSchemas = typeof hostEffectOperationSchemas;
type TsOnlyOperationSchemas = typeof tsOnlyOperationSchemas;
type GeneratedRequest<K extends HostOperationKey> =
  "request" extends keyof GeneratedOperationSchemas[K]
    ? GeneratedOperationSchemas[K]["request"] extends Schema.Schema<any>
      ? SchemaType<GeneratedOperationSchemas[K]["request"]>
      : NoRequest
    : NoRequest;
type GeneratedResponse<K extends HostOperationKey> = SchemaType<
  GeneratedOperationSchemas[K]["response"]
>;
type TsOnlyRequest<K extends TsOnlyOperationKey> = TsOnlyOperationSchemas[K] extends {
  readonly request: infer RequestSchema extends Schema.Schema<any>;
}
  ? SchemaType<RequestSchema>
  : NoRequest;
type TsOnlyResponse<K extends TsOnlyOperationKey> = SchemaType<
  TsOnlyOperationSchemas[K]["response"]
>;

export const anyOperationKeySchema = Schema.Literals([
  ...Object.keys(hostOperations),
  ...Object.keys(tsOnlyOperationSchemas),
] as [AnyOperationKey, ...AnyOperationKey[]]);

export function isAnyOperationKey(key: string): key is AnyOperationKey {
  return Object.hasOwn(hostOperations, key) || Object.hasOwn(tsOnlyOperationSchemas, key);
}

export function isHostOperationKey(key: string): key is HostOperationKey {
  return Object.hasOwn(hostOperations, key);
}

export type HostOpResponse<K extends AnyOperationKey> = K extends HostOperationKey
  ? GeneratedResponse<K>
  : K extends TsOnlyOperationKey
    ? TsOnlyResponse<K>
    : unknown;

export type HostOpRequest<K extends AnyOperationKey> = K extends HostOperationKey
  ? GeneratedRequest<K>
  : K extends TsOnlyOperationKey
    ? TsOnlyRequest<K>
    : unknown;

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

export function toHostCallError(key: string, error: unknown): HostCallError | undefined {
  if (!isHostRpcProblem(error)) return undefined;
  return new HostCallError(`${error.key}: ${error.message}`, error.status, {
    kind: error.kind,
    operationKey: error.key,
    title: error.message,
    status: error.status,
  });
}

function isHostRpcProblem(
  value: unknown,
): value is { key: string; kind: HostErrorKind; message: string; status: number } {
  return (
    isRecord(value) &&
    value._tag === "HostRpcError" &&
    typeof value.key === "string" &&
    isHostErrorKind(value.kind) &&
    typeof value.message === "string" &&
    typeof value.status === "number"
  );
}

function isHostErrorKind(value: unknown): value is HostErrorKind {
  return Schema.is(hostErrorKindSchema)(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
