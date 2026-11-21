import {
  bridgeDocumentSnapshotSchema,
  hostRuntimeAssemblyDataSchema,
  type HostOperationDefinition,
} from "./contracts/index.ts";
import { hostOpKeys, type HostOps } from "./generated/host-ops.generated.ts";
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
  HOST_RPC_SDK_SESSION_HEADER,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
} from "./contracts/bridge-protocol.ts";

export const hostSessionScopeSchema = Schema.Struct({
  session: Schema.optional(
    Schema.Union([
      Schema.Struct({ id: Schema.String }),
      Schema.Struct({ pid: Schema.Number }),
      Schema.Struct({
        session: Schema.String,
        processIncarnation: Schema.Struct({ pid: Schema.Number, startedAt: Schema.Number }),
      }),
    ]),
  ),
  // Private exact attachment and product document lifetime, never selector text.
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

// --- Pointers (ADR 0030 rule 10; agent-contracts pointers.ts): per-thread, kept until dismissed ---
/** A SubjectRef code, or a route place in its attention codec text. */
const pointerTargetSchema = Schema.Union([
  Schema.String,
  Schema.Record(Schema.String, Schema.String),
]);
const pointerSchema = Schema.Struct({
  id: Schema.String,
  route: Schema.String,
  target: pointerTargetSchema,
  label: Schema.String,
  at: Schema.String,
});
export const pointersPointRequestSchema = Schema.Struct({
  route: Schema.String,
  target: pointerTargetSchema,
  label: Schema.String,
});
/** A person names the thread; Pea's own thread comes from its caller context, never its input. */
export const pointersThreadRequestSchema = Schema.Struct({
  thread: Schema.optional(Schema.String),
});
export const pointersDismissRequestSchema = Schema.Struct({
  thread: Schema.optional(Schema.String),
  id: Schema.String,
});
export const pointersDataSchema = Schema.Struct({
  threadId: Schema.String,
  pointers: Schema.Array(pointerSchema),
});
export type PointersPointRequest = Schema.Schema.Type<typeof pointersPointRequestSchema>;
export type PointersThreadRequest = Schema.Schema.Type<typeof pointersThreadRequestSchema>;
export type PointersDismissRequest = Schema.Schema.Type<typeof pointersDismissRequestSchema>;
export type PointersData = Schema.Schema.Type<typeof pointersDataSchema>;

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

/** `sourcePath` is the entrypoint identity; canonical keys live on `contributions`. */
const podEntrypointSchema = Schema.Struct({
  sourcePath: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  /** Declared, it is every door's default, and `ReadOnly` refuses a write mode (pods map, contract C1). */
  mode: Schema.optional(
    Schema.NullOr(Schema.Literals(["ReadOnly", "WriteTransaction", "NoTransaction"])),
  ),
});

/** One admitted contribution (`packages.ts`): kind follows the path; `key` is the canonical host key. */
export const podContributionSchema = Schema.Struct({
  kind: Schema.Literals(["script", "page", "skill", "member", "route"]),
  path: Schema.String,
  memberPath: Schema.String,
  key: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
});
export type PodContribution = Schema.Schema.Type<typeof podContributionSchema>;

/** The content home a pod sits in (ADR 0037): its tier and the home's folder. Absent outside the homes (the demo lane). */
export const podHomeSchema = Schema.Struct({
  tier: Schema.Literals(["user", "project", "firm"]),
  path: Schema.String,
});

export const podListResponseSchema = Schema.Struct({
  pods: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      version: Schema.String,
      folder: Schema.String,
      home: Schema.optional(podHomeSchema),
      entrypoints: Schema.Array(podEntrypointSchema),
      contributions: Schema.Array(podContributionSchema),
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
  /** Why no project home's Pods are listed, in words; absent when the target document's are. */
  projectPods: Schema.optional(Schema.String),
  /** Folders whose `pod.json` could not name a pod; they list nothing else. */
  unreadable: Schema.Array(Schema.Struct({ folder: Schema.String, message: Schema.String })),
});
export type PodList = Schema.Schema.Type<typeof podListResponseSchema>;
export const podListRequestSchema = Schema.Union([
  Schema.Struct({ projection: Schema.optional(Schema.Literals(["full"])) }),
  Schema.Struct({ projection: Schema.Literals(["identity"]), folder: Schema.String }),
]);
const podListIdentityResponseSchema = Schema.Struct({
  projection: Schema.Literals(["identity"]),
  identity: Schema.Struct({ id: Schema.String, folder: Schema.String }),
});

/**
 * One pod's frozen execution input, read once from its admitted package. The native palette reads
 * this before it dispatches into Revit; the host never calls back into Revit to answer it.
 */
export const podCaptureRequestSchema = Schema.Struct({ pod: Schema.String });
export type PodCaptureRequest = Schema.Schema.Type<typeof podCaptureRequestSchema>;
export const podCaptureResponseSchema = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  directory: Schema.String,
  entrypoints: Schema.Array(podEntrypointSchema),
  contributions: Schema.Array(podContributionSchema),
  sourceBundle: Schema.Struct({
    files: Schema.Array(Schema.Struct({ path: Schema.String, bytesBase64: Schema.String })),
  }),
  memberBundle: Schema.Struct({
    files: Schema.Array(Schema.Struct({ path: Schema.String, bytesBase64: Schema.String })),
  }),
});
export type PodCapture = Schema.Schema.Type<typeof podCaptureResponseSchema>;

// --- Pod transport (host-only: no Revit session; pod-transfer.ts) ------------------------------

const podMemberDigestSchema = Schema.Struct({ path: Schema.String, sha256: Schema.String });

export const podExportRequestSchema = Schema.Struct({
  pod: Schema.String,
  archivePath: Schema.String,
});
export type PodExportRequest = Schema.Schema.Type<typeof podExportRequestSchema>;
export const podExportResponseSchema = Schema.Struct({
  id: Schema.String,
  archivePath: Schema.String,
  archiveSha256: Schema.String,
  members: Schema.Array(podMemberDigestSchema),
  /** Foreign fragments carried under settings/_vendor/<id>/, with the sha of their original bytes. */
  vendored: Schema.Array(
    Schema.Struct({ id: Schema.String, path: Schema.String, sha256: Schema.String }),
  ),
  /** Every member the crossing rewrote, with hashes before and after. */
  transforms: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      transform: Schema.Literals(["vendor-references", "portable-project"]),
      beforeSha256: Schema.String,
      afterSha256: Schema.String,
    }),
  ),
  /** Capture shas carried as captures/<sha>.png. */
  captures: Schema.Array(Schema.String),
});
export type PodExport = Schema.Schema.Type<typeof podExportResponseSchema>;

export const podImportRequestSchema = Schema.Struct({
  archivePath: Schema.String,
  /** Local folder under Pods/; the pod.json id when omitted. The folder is only an address. */
  folder: Schema.optional(Schema.String),
});
export type PodImportRequest = Schema.Schema.Type<typeof podImportRequestSchema>;
export const podImportResponseSchema = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  directory: Schema.String,
  archiveSha256: Schema.String,
  members: Schema.Array(podMemberDigestSchema),
  diagnostics: Schema.Array(memberIssueSchema),
});
export type PodImport = Schema.Schema.Type<typeof podImportResponseSchema>;

export const podPromoteRequestSchema = Schema.Struct({
  /** The scratch Page folder under Pages/. */
  page: Schema.String,
  /** The new pod's manifest id. */
  id: Schema.String,
  name: Schema.optional(Schema.String),
});
export type PodPromoteRequest = Schema.Schema.Type<typeof podPromoteRequestSchema>;
export const podPromoteResponseSchema = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  directory: Schema.String,
  /** The promoted Page's canonical key, `page:@<id>/pages/<page>`. */
  key: Schema.String,
});
export type PodPromote = Schema.Schema.Type<typeof podPromoteResponseSchema>;

/** Runs of one pod, optionally narrowed to the member a route has open. */
export const podRunsRequestSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PodRunsRequest = Schema.Schema.Type<typeof podRunsRequestSchema>;

/** The C# `PodRunOrigin`: a saved member's bytes, a supplied draft, or operation input with no member. */
export const podRunOriginSchema = Schema.Literals(["SavedMember", "SuppliedDraft", "Operation"]);
/** The C# `PodRunOutcome`; Cancelled is its own answer, never a rollback claim. */
export const podRunOutcomeSchema = Schema.Literals(["Succeeded", "Failed", "Cancelled"]);

/**
 * What `PodRuns.WriteReceipt` writes into `output/<runId>/receipt.json`. `memberSha256` names saved
 * bytes, so only a SavedMember run carries it. `podId` is null when a supplied draft was not filed
 * in a pod. `origin` is null when the writer recorded none. The member fields name what the run
 * consumed, so an Operation run (it consumed no member) has none.
 */
const podReceiptFields = {
  podId: Schema.NullOr(Schema.String),
  operation: Schema.String,
  planHash: Schema.NullOr(Schema.String),
  outcome: podRunOutcomeSchema,
  outputs: Schema.Array(Schema.String),
  reason: Schema.NullOr(Schema.String),
};
export const podReceiptSchema = Schema.Union([
  Schema.Struct({
    ...podReceiptFields,
    origin: Schema.Literal("Operation"),
    memberPath: Schema.Null,
    memberSha256: Schema.Null,
  }),
  Schema.Struct({
    ...podReceiptFields,
    origin: Schema.NullOr(Schema.Literals(["SavedMember", "SuppliedDraft"])),
    memberPath: Schema.NullOr(Schema.String),
    memberSha256: Schema.NullOr(Schema.String),
  }),
]);
export type PodReceipt = Schema.Schema.Type<typeof podReceiptSchema>;

/**
 * What a run consumed, from its `input.json`: a pod composition (saved member or supplied draft), a pod
 * script bundle, or operation input with no member. The consumed bytes stay in the run folder.
 */
export const podRunSourceSchema = Schema.Struct({
  kind: Schema.String,
  origin: Schema.optional(Schema.String),
  pod: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  sha256: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PodRunSource = Schema.Schema.Type<typeof podRunSourceSchema>;

export const podRunsResponseSchema = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({
      runId: Schema.String,
      receiptPath: Schema.String,
      /** Null exactly when the run folder holds no readable receipt; `error` says why. */
      receipt: Schema.NullOr(podReceiptSchema),
      /** Absent when the run holds no readable `input.json`. */
      source: Schema.optional(podRunSourceSchema),
      error: Schema.NullOr(Schema.String),
    }),
  ),
});
export type PodRuns = Schema.Schema.Type<typeof podRunsResponseSchema>;

export const podMemberReadResponseSchema = Schema.Struct({
  content: Schema.String,
  sha256: Schema.String,
  bytesBase64: Schema.String,
  home: Schema.optional(podHomeSchema),
  /** When the file was last written, from the file itself (ISO instant). It names no writer. */
  modifiedAt: Schema.optional(Schema.String),
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
  /** Real pod context for a saved member or @local composition; drafts may omit it. */
  pod: Schema.optional(Schema.String),
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
  source: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    path: Schema.String,
    sha256: Schema.String,
    bytesBase64: Schema.String,
    origin: Schema.Literals(["SavedMember", "SuppliedDraft"]),
  }),
  diagnostics: Schema.Array(memberIssueSchema),
  dependencies: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      path: Schema.String,
      sha256: Schema.String,
      bytesBase64: Schema.String,
    }),
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
  runtimeMatch: Schema.optional(
    Schema.Literals(["verified", "disconnected", "unknown", "refused"]),
  ),
  runtimeRefusal: Schema.optional(Schema.NullOr(Schema.String)),
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
  runtimeIdentity: Schema.String,
  serviceName: Schema.String,
  // The host's release version ('dev' on a checkout; 'unknown' when the installed manifest is unreadable). Lets a browser or a person see which host answered.
  version: Schema.String,
  sourceRoot: Schema.optional(Schema.NullOr(Schema.String)),
  installedRoot: Schema.optional(Schema.NullOr(Schema.String)),
  world: Schema.Struct({
    id: Schema.String,
    root: Schema.String,
    storage: Schema.Struct({ kind: Schema.Literals(["local-unversioned"]) }),
    isolation: Schema.Literals(["none"]),
  }),
  // The content homes this host reads, in list order, with how each was found (ADR 0037 rule 2).
  homes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        tier: Schema.Literals(["user", "project", "firm"]),
        path: Schema.String,
        found: Schema.Literals(["documents", "override", "config", "pointer", "default"]),
      }),
    ),
  ),
  // Null with a firm home. Otherwise where the host looked, or the folders refused for holding two firm markers.
  firmHomeNotice: Schema.optional(Schema.NullOr(Schema.String)),
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

/** Homes MAP slice 6b: one tier's `Settings/<owner>.json` as read. agent-contracts' `settingTierSchema` is the same shape for the read graph. */
const settingTier = Schema.Literals(["user", "project", "firm"]);
export const settingsTiersReadRequestSchema = Schema.Struct({ owner: Schema.String });
export const settingsTiersDataSchema = Schema.Struct({
  tiers: Schema.Array(
    Schema.Struct({
      tier: settingTier,
      home: Schema.NullOr(Schema.String),
      name: Schema.NullOr(Schema.String),
      notFound: Schema.optional(Schema.String),
      path: Schema.NullOr(Schema.String),
      sha256: Schema.NullOr(Schema.String),
      json: Schema.optional(Schema.Unknown),
      error: Schema.optional(Schema.String),
    }),
  ),
});
export const settingsTiersWriteRequestSchema = Schema.Struct({
  owner: Schema.String,
  tier: settingTier,
  path: Schema.NonEmptyArray(Schema.String),
  /** Null removes the value from this tier, so the next tier serves it. */
  value: Schema.Unknown,
  /** The tier's `sha256` as read; null when the home holds no file yet. */
  expectedSha256: Schema.NullOr(Schema.String),
});
export const settingsTiersWrittenSchema = Schema.Struct({
  tier: settingTier,
  path: Schema.String,
  sha256: Schema.String,
  /** The receipt: the hash of the bytes this write replaced, kept in this machine's blob store. */
  priorSha256: Schema.NullOr(Schema.String),
  by: Schema.String,
  at: Schema.String,
});

export const builtinLocalSchemas = {
  "settings.tiers.read": {
    request: settingsTiersReadRequestSchema,
    response: settingsTiersDataSchema,
  },
  "settings.tiers.write": {
    request: settingsTiersWriteRequestSchema,
    response: settingsTiersWrittenSchema,
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
  "pointers.point": { request: pointersPointRequestSchema, response: pointersDataSchema },
  "pointers.list": { request: pointersThreadRequestSchema, response: pointersDataSchema },
  "pointers.dismiss": { request: pointersDismissRequestSchema, response: pointersDataSchema },
  "host.topology": {
    response: hostTopologyDataSchema,
  },
  "logs.tail": {
    request: hostLogsRequestSchema,
    response: hostLogsDataSchema,
  },
  "pod.list": {
    request: podListRequestSchema,
    response: Schema.Union([podListResponseSchema, podListIdentityResponseSchema]),
  },
  "pod.capture": {
    request: podCaptureRequestSchema,
    response: podCaptureResponseSchema,
  },
  "pod.export": {
    request: podExportRequestSchema,
    response: podExportResponseSchema,
  },
  "pod.import": {
    request: podImportRequestSchema,
    response: podImportResponseSchema,
  },
  "pod.promote": {
    request: podPromoteRequestSchema,
    response: podPromoteResponseSchema,
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

/**
 * The platform's own local operations. A product's keys are declared by the generated operations
 * table, which spreads each product's schemas beside these; this package names no product.
 */
export type TsOnlyOperationSchemas = typeof builtinLocalSchemas;
export type TsOnlyOperationKey = keyof TsOnlyOperationSchemas;
export type AnyOperationKey = HostOperationKey | TsOnlyOperationKey;
export type TsOnlyRequest<K extends TsOnlyOperationKey> = TsOnlyOperationSchemas[K] extends {
  readonly request: infer RequestSchema extends Schema.Schema<any>;
}
  ? SchemaType<RequestSchema>
  : NoRequest;
type TsOnlyResponse<K extends TsOnlyOperationKey> = SchemaType<
  TsOnlyOperationSchemas[K]["response"]
>;

export function isHostOperationKey(key: string): key is HostOperationKey {
  return hostOperationKeySet.has(key);
}

export type HostLocalCatalogEntry<K extends string = TsOnlyOperationKey> = Omit<
  HostOperationDefinition,
  "intent"
> & {
  readonly key: K;
  readonly origin: "host-local";
  readonly principal?: readonly ("human" | "pea")[];
};

/**
 * Discovery metadata for the TS-only (host-local) ops so `GET /ops` lists them next to the Revit
 * bridge ops — pe_find, the pea `operations` command, and the web ops page all read
 * that one catalog. These ops dispatch locally (call-route.ts) and don't need a Revit session.
 *
 * `origin:"host-local"` marks them so host-typegen SKIPS them: their request/response types are the
 * hand-authored schemas above (builtinLocalSchemas), not generated from the live catalog, and the
 * entries carry no request/response schema JSON. Keep exactly one entry per builtinLocalSchemas
 * key — the index test asserts full coverage.
 */
export { builtinLocalCatalog } from "./pe-api.ts";

/**
 * Strict key space for the typed client surface: only keys the checked-in
 * typegen output (or the hand-authored TS-only map) knows about. Regenerate
 * before calling a newly registered operation; there is no untyped bypass.
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
  readonly status: number;
  readonly problem?: HostProblemDetails;

  constructor(message: string, status: number, problem?: HostProblemDetails) {
    super(message);
    this.status = status;
    this.problem = problem;
    this.name = "HostCallError";
  }
}
