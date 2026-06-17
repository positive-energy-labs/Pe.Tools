import type {
  AgentCapabilities,
  PermissionOptionKind,
  StopReason,
  ToolCallStatus,
  ToolKind,
} from "@agentclientprotocol/sdk";

export type WorkbenchJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkbenchJsonValue[]
  | { [key: string]: WorkbenchJsonValue };

export type WorkbenchJsonObject = { [key: string]: WorkbenchJsonValue };

export const peWorkbenchExtensionKey = "pe.tools/workbench";
export const peWorkbenchExtensionVersion = 1;
export const peWorkbenchUpdateMetadataKey = "pe.tools/workbench.update";
export const peWorkbenchSessionMetadataKey = "pe.tools/workbench.session";
export const peWorkbenchLoadThreadMethod = "pe.tools/workbench.loadThread";
export const peWorkbenchQueueMessageMethod = "pe.tools/workbench.queueMessage";
export const peWorkbenchSetModelMethod = "pe.tools/workbench.setModel";
export const peWorkbenchSetAccessLevelMethod = "pe.tools/workbench.setAccessLevel";

export interface WorkbenchAgentCapabilities {
  threads?: boolean;
  history?: boolean;
  historySnapshots?: boolean;
  toolCalls?: boolean;
  approvals?: boolean;
  approveAlways?: boolean;
  plans?: boolean;
  rawToolIO?: boolean;
  modelSwitching?: boolean;
  sessionModes?: boolean;
  accessLevels?: boolean;
  config?: boolean;
  observationalMemory?: boolean;
  systemPromptInspection?: boolean;
}

export interface WorkbenchRuntimeInfo {
  id: string;
  name: string;
  title?: string;
  description?: string;
}

export interface PeWorkbenchExtension {
  version: typeof peWorkbenchExtensionVersion;
  runtime?: WorkbenchRuntimeInfo;
  capabilities: WorkbenchAgentCapabilities;
}

export interface PeWorkbenchSessionMetadata {
  status?: "draft" | "materialized";
  threadId?: string;
  resourceId?: string;
  lock?: WorkbenchThreadLockInfo;
}

export interface WorkbenchAgentInfo {
  name: string;
  title?: string;
  version?: string;
  runtime?: WorkbenchRuntimeInfo;
  capabilities: WorkbenchAgentCapabilities;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchSessionInfo {
  sessionId: string;
  cwd: string;
  additionalDirectories: string[];
  title?: string;
  updatedAt?: string;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchThreadInfo {
  threadId: string;
  sessionId?: string;
  resourceId?: string;
  title?: string;
  cwd?: string;
  updatedAt?: string;
  lock?: WorkbenchThreadLockInfo;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchThreadLockInfo {
  status: "unlocked" | "owned" | "locked" | "unknown";
  ownerPid?: number;
}

export type WorkbenchLoadStatus = "idle" | "loading" | "loaded" | "error";
export type WorkbenchCommandStatus = "idle" | "running" | "succeeded" | "failed";
export type WorkbenchRole = "user" | "assistant" | "thought" | "system" | "tool";
export type WorkbenchMessageStatus = "streaming" | "complete" | "error";
export type WorkbenchRunStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "canceling"
  | "error";
export type WorkbenchDebugSource = "acp" | "runtime" | "workbench" | "transport" | "ui";

export interface WorkbenchProvenance {
  source?: WorkbenchDebugSource;
  protocol?: "acp" | "workbench" | "local";
  sessionId?: string;
  threadId?: string;
  messageId?: string;
  toolCallId?: string;
  updateType?: string;
  metadata?: WorkbenchJsonObject;
}

export type WorkbenchMessagePart =
  | {
      kind: "text";
      text: string;
      provenance?: WorkbenchProvenance;
    }
  | {
      kind: "reasoning" | "thought";
      text: string;
      provenance?: WorkbenchProvenance;
    }
  | {
      kind: "tool_call_ref";
      toolCallId: string;
      label?: string;
      status?: ToolCallStatus;
      provenance?: WorkbenchProvenance;
    }
  | {
      kind: "tool_result_ref";
      toolCallId: string;
      label?: string;
      status?: ToolCallStatus;
      provenance?: WorkbenchProvenance;
    }
  | {
      kind: "approval_ref";
      approvalId: string;
      toolCallId?: string;
      label?: string;
      provenance?: WorkbenchProvenance;
    }
  | {
      kind: "status";
      text: string;
      status?: WorkbenchRunStatus | WorkbenchCommandStatus | WorkbenchMessageStatus;
      provenance?: WorkbenchProvenance;
    }
  | {
      kind: "error";
      message: string;
      code?: string;
      provenance?: WorkbenchProvenance;
    }
  | {
      kind: "raw";
      value: unknown;
      label?: string;
      provenance?: WorkbenchProvenance;
    };

export interface WorkbenchMessage {
  id: string;
  role: WorkbenchRole;
  parts: WorkbenchMessagePart[];
  status: WorkbenchMessageStatus;
  createdAt?: string;
  updatedAt?: string;
  provenance?: WorkbenchProvenance;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchToolLocation {
  path?: string;
  line?: number;
  column?: number;
  uri?: string;
}

export interface WorkbenchToolTimelineEntry {
  id: string;
  status?: ToolCallStatus | "created" | "updated" | "completed" | "failed";
  label?: string;
  timestamp?: string;
  summary?: string;
  payload?: unknown;
}

export interface WorkbenchToolCall {
  id: string;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: string;
  error?: string;
  locations?: WorkbenchToolLocation[];
  timeline?: WorkbenchToolTimelineEntry[];
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  parentMessageId?: string;
  provenance?: WorkbenchProvenance;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchPlanEntry {
  id: string;
  content: string;
  priority?: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface WorkbenchApprovalOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export type WorkbenchApprovalStatus = "pending" | "resolved" | "canceled";

export interface WorkbenchApprovalResolution {
  optionId?: string;
  kind?: PermissionOptionKind;
  resolvedAt?: string;
}

export interface WorkbenchApprovalRequest {
  requestId: string;
  sessionId: string;
  toolCall: WorkbenchToolCall;
  options: WorkbenchApprovalOption[];
  status: WorkbenchApprovalStatus;
  defaultOptionId?: string;
  selectedOptionId?: string;
  createdAt?: string;
  resolvedAt?: string;
  resolution?: WorkbenchApprovalResolution;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchRunState {
  status: WorkbenchRunStatus;
  startedAt?: string;
  completedAt?: string;
  stopReason?: StopReason;
  activeToolCallId?: string;
}

export interface WorkbenchCommandState {
  status: WorkbenchCommandStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export type WorkbenchWorkbenchPanel = "threads" | "transcript" | "tools" | "inspector" | "memory";

export interface WorkbenchUiPreferencesState {
  activePanel: WorkbenchWorkbenchPanel;
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  timestampsVisible: boolean;
  reasoningVisible: boolean;
  toolDetailsVisible: boolean;
  rawIoVisible: boolean;
  compactToolOutput: boolean;
  diffWrap: "word" | "none";
}

export interface WorkbenchUiStatusState {
  overall: WorkbenchRunState;
  start: WorkbenchCommandState;
  send: WorkbenchCommandState;
  threads: WorkbenchCommandState;
  loadThread: WorkbenchCommandState;
  cancel: WorkbenchCommandState;
  model: WorkbenchCommandState;
  mode: WorkbenchCommandState;
  errors: string[];
}

export interface WorkbenchDebugEvent {
  id: string;
  source: WorkbenchDebugSource;
  type: string;
  label?: string;
  timestamp?: string;
  payload?: unknown;
}

export type WorkbenchObservationMemoryKind = "observation" | "reflection";
export type WorkbenchObservationMemoryStatus =
  | "loading"
  | "complete"
  | "failed"
  | "disconnected"
  | "buffering"
  | "buffering-complete"
  | "buffering-failed"
  | "activated";

export interface WorkbenchObservationMemoryEntry {
  id: string;
  kind: WorkbenchObservationMemoryKind;
  status: WorkbenchObservationMemoryStatus;
  title?: string;
  summary?: string;
  observedTokens?: number;
  compressionRatio?: number;
  durationMs?: number;
  error?: string;
  metadata?: WorkbenchJsonObject;
  raw?: unknown;
}

export interface WorkbenchSystemPromptSnapshot {
  content: string;
  source?: string;
  updatedAt?: string;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchInspectorEntry {
  id: string;
  title: string;
  content: unknown;
  updatedAt?: string;
}

export interface WorkbenchInspectorState {
  systemPrompt?: WorkbenchSystemPromptSnapshot;
  contextEntries: WorkbenchInspectorEntry[];
  rawMessages: WorkbenchInspectorEntry[];
  selectedEntryId?: string;
}

export interface WorkbenchModelInfo {
  id: string;
  provider?: string;
  displayName?: string;
  variant?: string;
  disabled?: boolean;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchModelState {
  currentModelId?: string;
  availableModels: WorkbenchModelInfo[];
  recentModelIds: string[];
}

export interface WorkbenchSessionModeInfo {
  id: string;
  name: string;
  description?: string;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchSessionModeState {
  currentModeId?: string;
  availableModes: WorkbenchSessionModeInfo[];
}

export type WorkbenchAccessLevel = "read-only" | "ask" | "trusted";

export interface WorkbenchAccessLevelInfo {
  id: WorkbenchAccessLevel;
  name: string;
  description?: string;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchAccessLevelState {
  currentAccessLevel?: WorkbenchAccessLevel;
  availableAccessLevels: WorkbenchAccessLevelInfo[];
}

export interface WorkbenchAgentState {
  info?: WorkbenchAgentInfo;
  session?: WorkbenchSessionInfo;
}

export interface WorkbenchThreadState {
  items: WorkbenchThreadInfo[];
  activeThreadId?: string;
  selectedThreadId?: string;
  status: WorkbenchLoadStatus;
  error?: string;
}

export interface WorkbenchTranscriptState {
  messages: WorkbenchMessage[];
  status: WorkbenchLoadStatus;
  error?: string;
}

export interface WorkbenchToolState {
  calls: WorkbenchToolCall[];
  activeToolCallIds: string[];
  recentToolCallIds: string[];
  rawIoAvailable: boolean;
}

export interface WorkbenchApprovalState {
  requests: WorkbenchApprovalRequest[];
}

export interface WorkbenchPlanState {
  entries: WorkbenchPlanEntry[];
}

export interface WorkbenchMemoryState {
  entries: WorkbenchObservationMemoryEntry[];
}

export interface WorkbenchDebugState {
  events: WorkbenchDebugEvent[];
  selectedEventId?: string;
}

export interface WorkbenchState {
  agent: WorkbenchAgentState;
  threads: WorkbenchThreadState;
  transcript: WorkbenchTranscriptState;
  tools: WorkbenchToolState;
  approvals: WorkbenchApprovalState;
  plans: WorkbenchPlanState;
  models: WorkbenchModelState;
  modes: WorkbenchSessionModeState;
  access: WorkbenchAccessLevelState;
  memory: WorkbenchMemoryState;
  inspector: WorkbenchInspectorState;
  debug: WorkbenchDebugState;
  uiPreferences: WorkbenchUiPreferencesState;
  uiStatus: WorkbenchUiStatusState;
}

export interface PeWorkbenchUpdateMetadata {
  debug?: WorkbenchDebugEvent | WorkbenchDebugEvent[];
  observationalMemory?: WorkbenchObservationMemoryEntry | WorkbenchObservationMemoryEntry[];
  systemPrompt?: WorkbenchSystemPromptSnapshot;
  contextEntries?: WorkbenchInspectorEntry[];
  rawMessages?: WorkbenchInspectorEntry[];
  model?: Partial<WorkbenchModelState>;
  mode?: Partial<WorkbenchSessionModeState>;
  access?: Partial<WorkbenchAccessLevelState>;
  threads?: WorkbenchThreadInfo[];
  activeThreadId?: string;
}

export type WorkbenchEvent =
  | { type: "agent_initialized"; agent: WorkbenchAgentInfo }
  | { type: "session_started"; session: WorkbenchSessionInfo; thread?: WorkbenchThreadInfo }
  | { type: "session_updated"; session: Partial<WorkbenchSessionInfo> }
  | {
      type: "ui_status_changed";
      command?: keyof Omit<WorkbenchUiStatusState, "overall" | "errors">;
      status: WorkbenchCommandStatus;
      error?: string;
      timestamp?: string;
    }
  | {
      type: "run_status_changed";
      status: WorkbenchRunStatus;
      timestamp?: string;
      stopReason?: StopReason;
      activeToolCallId?: string;
    }
  | { type: "transcript_replaced"; messages: WorkbenchMessage[] }
  | {
      type: "message_part_delta";
      messageId: string;
      role: WorkbenchRole;
      part: WorkbenchMessagePart;
      status?: WorkbenchMessageStatus;
      timestamp?: string;
      provenance?: WorkbenchProvenance;
    }
  | { type: "message_updated"; message: WorkbenchMessage }
  | { type: "tool_call_updated"; toolCall: WorkbenchToolCall }
  | { type: "plan_replaced"; entries: WorkbenchPlanEntry[] }
  | { type: "approval_requested"; approval: WorkbenchApprovalRequest }
  | { type: "approval_resolved"; requestId: string; resolution?: WorkbenchApprovalResolution }
  | { type: "approvals_cleared"; reason?: string }
  | {
      type: "threads_replaced";
      threads: WorkbenchThreadInfo[];
      activeThreadId?: string;
      status?: WorkbenchLoadStatus;
    }
  | { type: "thread_selected"; threadId?: string }
  | { type: "observational_memory_updated"; entry: WorkbenchObservationMemoryEntry }
  | { type: "observational_memory_removed"; id: string }
  | { type: "inspector_updated"; inspector: Partial<WorkbenchInspectorState> }
  | { type: "model_state_updated"; model: Partial<WorkbenchModelState> }
  | { type: "session_mode_updated"; sessionMode: Partial<WorkbenchSessionModeState> }
  | { type: "access_level_updated"; access: Partial<WorkbenchAccessLevelState> }
  | { type: "ui_preferences_updated"; preferences: Partial<WorkbenchUiPreferencesState> }
  | { type: "debug_event_recorded"; debugEvent: WorkbenchDebugEvent }
  | {
      type: "error";
      message: string;
      command?: keyof Omit<WorkbenchUiStatusState, "overall" | "errors">;
    };

export type WorkbenchEventHandler = (event: WorkbenchEvent) => void;

export interface WorkbenchStartRequest {
  cwd: string;
  additionalDirectories?: string[];
}

export interface WorkbenchStartResponse {
  agent: WorkbenchAgentInfo;
  session: WorkbenchSessionInfo;
  threads?: WorkbenchThreadInfo[];
}

export interface WorkbenchNewSessionRequest extends WorkbenchStartRequest {}

export interface WorkbenchNewSessionResponse {
  session: WorkbenchSessionInfo;
}

export interface WorkbenchPromptRequest {
  sessionId: string;
  text: string;
}

export interface WorkbenchPromptResult {
  stopReason: StopReason;
}

export type WorkbenchQueueMessageRequest = WorkbenchPromptRequest;

export interface WorkbenchQueueMessageResult {
  accepted: true;
  queued: boolean;
  stopReason?: StopReason;
}

export interface WorkbenchListThreadsRequest {
  cwd?: string;
}

export interface WorkbenchListThreadsResponse {
  threads: WorkbenchThreadInfo[];
}

export interface WorkbenchLoadThreadRequest extends WorkbenchStartRequest {
  threadId: string;
  sessionId?: string;
}

export interface WorkbenchLoadThreadResponse {
  session: WorkbenchSessionInfo;
  messages?: WorkbenchMessage[];
  events?: WorkbenchEvent[];
}

export interface WorkbenchLoadThreadSnapshotRequest {
  sessionId: string;
  cwd?: string;
  additionalDirectories?: string[];
}

export interface WorkbenchLoadThreadSnapshotResponse extends WorkbenchLoadThreadResponse {
  messages: WorkbenchMessage[];
}

export interface WorkbenchResolveApprovalRequest {
  requestId: string;
  optionId?: string;
}

export interface WorkbenchCancelRequest {
  sessionId: string;
}

export interface WorkbenchSetModelRequest {
  modelId: string;
}

export interface WorkbenchSetModeRequest {
  modeId: string;
}

export interface WorkbenchSetAccessLevelRequest {
  accessLevel: WorkbenchAccessLevel;
}

export interface WorkbenchCommandResponse {
  ok: true;
  state?: WorkbenchState;
}

export interface WorkbenchAgentClient {
  subscribe(handler: WorkbenchEventHandler): () => void;
  initialize(): Promise<WorkbenchAgentInfo>;
  newSession(request: WorkbenchNewSessionRequest): Promise<WorkbenchSessionInfo>;
  sendPrompt(request: WorkbenchPromptRequest): Promise<WorkbenchPromptResult>;
  queueMessage?(request: WorkbenchQueueMessageRequest): Promise<WorkbenchQueueMessageResult>;
  listThreads?(cwd?: string): Promise<WorkbenchThreadInfo[]>;
  loadThread?(
    request: WorkbenchLoadThreadRequest,
  ): Promise<WorkbenchSessionInfo | WorkbenchLoadThreadResponse>;
  resolveApproval?(requestId: string, optionId?: string): void;
  cancel?(sessionId: string): Promise<void> | void;
  setModel?(modelId: string): Promise<void> | void;
  setMode?(modeId: string): Promise<void> | void;
  setAccessLevel?(accessLevel: WorkbenchAccessLevel): Promise<void> | void;
  refreshInspector?(): Promise<void> | void;
  close?(): Promise<void> | void;
}

export function createPeWorkbenchExtension(options: {
  runtime?: WorkbenchRuntimeInfo;
  capabilities?: WorkbenchAgentCapabilities;
}): PeWorkbenchExtension {
  return {
    version: peWorkbenchExtensionVersion,
    runtime: options.runtime,
    capabilities: options.capabilities ?? {},
  };
}

export function peWorkbenchMetadata(extension: PeWorkbenchExtension): WorkbenchJsonObject {
  return { [peWorkbenchExtensionKey]: extension as unknown as WorkbenchJsonValue };
}

export function peWorkbenchSessionMetadata(
  metadata: PeWorkbenchSessionMetadata,
): WorkbenchJsonObject {
  return { [peWorkbenchSessionMetadataKey]: metadata as unknown as WorkbenchJsonValue };
}

export function readPeWorkbenchExtension(metadata: unknown): PeWorkbenchExtension | undefined {
  if (!isRecord(metadata)) return undefined;
  const extension = metadata[peWorkbenchExtensionKey];
  if (!isRecord(extension)) return undefined;
  if (extension.version !== peWorkbenchExtensionVersion) return undefined;
  const capabilities = isRecord(extension.capabilities) ? extension.capabilities : {};
  return {
    version: peWorkbenchExtensionVersion,
    runtime: readRuntimeInfo(extension.runtime),
    capabilities: readCapabilities(capabilities),
  };
}

export function readPeWorkbenchSessionMetadata(
  metadata: unknown,
): PeWorkbenchSessionMetadata | undefined {
  if (!isRecord(metadata)) return undefined;
  const session = metadata[peWorkbenchSessionMetadataKey];
  if (!isRecord(session)) return undefined;
  const status =
    session.status === "draft" || session.status === "materialized" ? session.status : undefined;
  const threadId = typeof session.threadId === "string" ? session.threadId : undefined;
  const resourceId = typeof session.resourceId === "string" ? session.resourceId : undefined;
  return {
    ...(status ? { status } : {}),
    ...(threadId ? { threadId } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(isThreadLockInfo(session.lock) ? { lock: session.lock } : {}),
  };
}

export function deriveWorkbenchCapabilities(
  acpCapabilities: AgentCapabilities | undefined,
  extension: PeWorkbenchExtension | undefined,
): WorkbenchAgentCapabilities {
  return {
    threads: Boolean(acpCapabilities?.loadSession || acpCapabilities?.sessionCapabilities?.resume),
    history: Boolean(acpCapabilities?.loadSession),
    toolCalls: true,
    approvals: true,
    approveAlways: true,
    plans: true,
    rawToolIO: true,
    modelSwitching: Boolean(acpCapabilities?.providers),
    sessionModes: Boolean(acpCapabilities?.sessionCapabilities),
    config: Boolean(acpCapabilities?.providers),
    ...extension?.capabilities,
  };
}

function readRuntimeInfo(value: unknown): WorkbenchRuntimeInfo | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    title: typeof value.title === "string" ? value.title : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
  };
}

function readCapabilities(value: Record<string, unknown>): WorkbenchAgentCapabilities {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [keyof WorkbenchAgentCapabilities, boolean] => {
      const [key, capability] = entry;
      return isCapabilityKey(key) && typeof capability === "boolean";
    }),
  );
}

function isCapabilityKey(value: string): value is keyof WorkbenchAgentCapabilities {
  return [
    "threads",
    "history",
    "historySnapshots",
    "toolCalls",
    "approvals",
    "approveAlways",
    "plans",
    "rawToolIO",
    "modelSwitching",
    "sessionModes",
    "accessLevels",
    "config",
    "observationalMemory",
    "systemPromptInspection",
  ].includes(value);
}

function isThreadLockInfo(value: unknown): value is WorkbenchThreadLockInfo {
  if (!isRecord(value)) return false;
  return (
    (value.status === "unlocked" ||
      value.status === "owned" ||
      value.status === "locked" ||
      value.status === "unknown") &&
    (value.ownerPid == null || typeof value.ownerPid === "number")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
