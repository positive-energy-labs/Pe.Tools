import type {
  AgentCapabilities,
  PermissionOptionKind,
  StopReason,
  ToolCallStatus,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { z } from "zod";

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
  const extensionJson: WorkbenchJsonObject = {
    version: extension.version,
    capabilities: workbenchCapabilitiesJson(extension.capabilities),
  };
  if (extension.runtime) extensionJson.runtime = runtimeInfoJson(extension.runtime);
  return { [peWorkbenchExtensionKey]: extensionJson };
}

export function peWorkbenchSessionMetadata(
  metadata: PeWorkbenchSessionMetadata,
): WorkbenchJsonObject {
  const sessionJson: WorkbenchJsonObject = {};
  if (metadata.status) sessionJson.status = metadata.status;
  if (metadata.threadId) sessionJson.threadId = metadata.threadId;
  if (metadata.resourceId) sessionJson.resourceId = metadata.resourceId;
  if (metadata.lock) sessionJson.lock = threadLockInfoJson(metadata.lock);
  return { [peWorkbenchSessionMetadataKey]: sessionJson };
}

const workbenchRecordSchema = z.record(z.string(), z.unknown());
const workbenchJsonValueSchema: z.ZodType<WorkbenchJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(workbenchJsonValueSchema),
    z.record(z.string(), workbenchJsonValueSchema),
  ]),
);
const stopReasonSchema = z.enum([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);
const workbenchRuntimeInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  })
  .strip();
const workbenchThreadLockInfoSchema = z
  .object({
    status: z.enum(["unlocked", "owned", "locked", "unknown"]),
    ownerPid: z.number().optional(),
  })
  .strip();
const workbenchCapabilityKeys = [
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
] as const;
const workbenchCapabilitiesSchema = z
  .object(Object.fromEntries(workbenchCapabilityKeys.map((key) => [key, z.boolean().optional()])))
  .strip() as z.ZodType<WorkbenchAgentCapabilities>;
const peWorkbenchExtensionEntrySchema = z
  .object({
    version: z.literal(peWorkbenchExtensionVersion),
    runtime: workbenchRuntimeInfoSchema.optional(),
    capabilities: workbenchCapabilitiesSchema.optional().default({}),
  })
  .strip();
const peWorkbenchSessionMetadataEntrySchema = z
  .object({
    status: z.enum(["draft", "materialized"]).optional(),
    threadId: z.string().optional(),
    resourceId: z.string().optional(),
    lock: workbenchThreadLockInfoSchema.optional(),
  })
  .strip();
const workbenchSessionInfoSchema = z
  .object({
    sessionId: z.string(),
    cwd: z.string(),
    additionalDirectories: z
      .array(z.unknown())
      .optional()
      .transform(
        (entries) => entries?.filter((entry): entry is string => typeof entry === "string") ?? [],
      ),
    title: z.string().optional(),
    updatedAt: z.string().optional(),
    metadata: z.unknown().transform(readWorkbenchJsonObject).optional(),
  })
  .strip();
const workbenchLoadThreadResponseSchema = z
  .object({
    session: z.custom<WorkbenchSessionInfo>(isWorkbenchSessionInfo),
    messages: z.array(z.custom<WorkbenchMessage>(isWorkbenchMessage)).optional(),
    events: z.array(z.custom<WorkbenchEvent>(isWorkbenchEvent)).optional(),
  })
  .strip();
const workbenchEventSchema = z.custom<WorkbenchEvent>(isWorkbenchEventShape);
const workbenchStateSchema = z.custom<WorkbenchState>(isWorkbenchStateShape);

export function readPeWorkbenchExtension(metadata: unknown): PeWorkbenchExtension | undefined {
  const metadataRecord = workbenchRecordSchema.safeParse(metadata);
  if (!metadataRecord.success) return undefined;
  const extension = peWorkbenchExtensionEntrySchema.safeParse(
    metadataRecord.data[peWorkbenchExtensionKey],
  );
  if (!extension.success) return undefined;
  return {
    version: peWorkbenchExtensionVersion,
    runtime: extension.data.runtime,
    capabilities: extension.data.capabilities,
  };
}

export function readPeWorkbenchSessionMetadata(
  metadata: unknown,
): PeWorkbenchSessionMetadata | undefined {
  const metadataRecord = workbenchRecordSchema.safeParse(metadata);
  if (!metadataRecord.success) return undefined;
  const session = peWorkbenchSessionMetadataEntrySchema.safeParse(
    metadataRecord.data[peWorkbenchSessionMetadataKey],
  );
  return session.success ? session.data : undefined;
}

export function isWorkbenchJsonValue(value: unknown): value is WorkbenchJsonValue {
  return workbenchJsonValueSchema.safeParse(value).success;
}

export function readWorkbenchJsonObject(value: unknown): WorkbenchJsonObject | undefined {
  const record = workbenchRecordSchema.safeParse(value);
  if (!record.success) return undefined;
  const result: WorkbenchJsonObject = {};
  for (const [key, entry] of Object.entries(record.data)) {
    const jsonValue = workbenchJsonValueSchema.safeParse(entry);
    if (jsonValue.success) result[key] = jsonValue.data;
  }
  return result;
}

export function readStopReason(value: unknown): StopReason | undefined {
  const result = stopReasonSchema.safeParse(value);
  return result.success ? (result.data as StopReason) : undefined;
}

export function readWorkbenchLoadThreadResponse(
  value: unknown,
): WorkbenchLoadThreadResponse | undefined {
  const response = workbenchLoadThreadResponseSchema.safeParse(value);
  return response.success ? response.data : undefined;
}

export function readWorkbenchSessionInfo(value: unknown): WorkbenchSessionInfo | undefined {
  const session = workbenchSessionInfoSchema.safeParse(value);
  return session.success ? session.data : undefined;
}

export function isWorkbenchEvent(value: unknown): value is WorkbenchEvent {
  return workbenchEventSchema.safeParse(value).success;
}

function isWorkbenchEventShape(value: unknown): value is WorkbenchEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "agent_initialized":
      return isWorkbenchAgentInfo(value.agent);
    case "session_started":
      return (
        isWorkbenchSessionInfo(value.session) && isOptional(value.thread, isWorkbenchThreadInfo)
      );
    case "session_updated":
      return isRecord(value.session);
    case "ui_status_changed":
      return isWorkbenchCommandStatus(value.status);
    case "run_status_changed":
      return (
        isWorkbenchRunStatus(value.status) &&
        (value.stopReason == null || readStopReason(value.stopReason) !== undefined)
      );
    case "transcript_replaced":
      return Array.isArray(value.messages) && value.messages.every(isWorkbenchMessage);
    case "message_part_delta":
      return (
        typeof value.messageId === "string" &&
        isWorkbenchRole(value.role) &&
        isWorkbenchMessagePart(value.part)
      );
    case "message_updated":
      return isWorkbenchMessage(value.message);
    case "tool_call_updated":
      return isWorkbenchToolCall(value.toolCall);
    case "plan_replaced":
      return Array.isArray(value.entries) && value.entries.every(isWorkbenchPlanEntry);
    case "approval_requested":
      return isWorkbenchApprovalRequest(value.approval);
    case "approval_resolved":
      return typeof value.requestId === "string";
    case "approvals_cleared":
      return value.reason == null || typeof value.reason === "string";
    case "threads_replaced":
      return Array.isArray(value.threads) && value.threads.every(isWorkbenchThreadInfo);
    case "thread_selected":
      return value.threadId == null || typeof value.threadId === "string";
    case "observational_memory_updated":
      return isWorkbenchObservationMemoryEntry(value.entry);
    case "observational_memory_removed":
      return typeof value.id === "string";
    case "inspector_updated":
      return isRecord(value.inspector);
    case "model_state_updated":
      return isRecord(value.model);
    case "session_mode_updated":
      return isRecord(value.sessionMode);
    case "access_level_updated":
      return isRecord(value.access);
    case "ui_preferences_updated":
      return isRecord(value.preferences);
    case "debug_event_recorded":
      return isWorkbenchDebugEvent(value.debugEvent);
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

export function isWorkbenchState(value: unknown): value is WorkbenchState {
  return workbenchStateSchema.safeParse(value).success;
}

function isWorkbenchStateShape(value: unknown): value is WorkbenchState {
  if (!isRecord(value)) return false;
  return (
    isWorkbenchAgentState(value.agent) &&
    isWorkbenchThreadState(value.threads) &&
    isWorkbenchTranscriptState(value.transcript) &&
    isWorkbenchToolState(value.tools) &&
    isWorkbenchApprovalState(value.approvals) &&
    isWorkbenchPlanState(value.plans) &&
    isWorkbenchModelState(value.models) &&
    isWorkbenchSessionModeState(value.modes) &&
    isWorkbenchAccessLevelState(value.access) &&
    isWorkbenchMemoryState(value.memory) &&
    isWorkbenchInspectorState(value.inspector) &&
    isWorkbenchDebugState(value.debug) &&
    isWorkbenchUiPreferencesState(value.uiPreferences) &&
    isWorkbenchUiStatusState(value.uiStatus)
  );
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

function workbenchCapabilitiesJson(capabilities: WorkbenchAgentCapabilities): WorkbenchJsonObject {
  const result: WorkbenchJsonObject = {};
  for (const [key, value] of Object.entries(capabilities)) {
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

function runtimeInfoJson(runtime: WorkbenchRuntimeInfo): WorkbenchJsonObject {
  return {
    id: runtime.id,
    name: runtime.name,
    ...(runtime.title ? { title: runtime.title } : {}),
    ...(runtime.description ? { description: runtime.description } : {}),
  };
}

function threadLockInfoJson(lock: WorkbenchThreadLockInfo): WorkbenchJsonObject {
  return {
    status: lock.status,
    ...(typeof lock.ownerPid === "number" ? { ownerPid: lock.ownerPid } : {}),
  };
}

function isOptional<T>(
  value: unknown,
  guard: (entry: unknown) => entry is T,
): value is T | undefined {
  return value == null || guard(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOptionalString(value: unknown): boolean {
  return value == null || typeof value === "string";
}

function isOptionalJsonObject(value: unknown): boolean {
  return value == null || readWorkbenchJsonObject(value) !== undefined;
}

function isWorkbenchAgentInfo(value: unknown): value is WorkbenchAgentInfo {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  return (
    isOptional(value.runtime, isWorkbenchRuntimeInfo) &&
    isRecord(value.capabilities) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchRuntimeInfo(value: unknown): value is WorkbenchRuntimeInfo {
  return readRuntimeInfo(value) !== undefined;
}

function isWorkbenchSessionInfo(value: unknown): value is WorkbenchSessionInfo {
  return readWorkbenchSessionInfo(value) !== undefined;
}

function isWorkbenchThreadInfo(value: unknown): value is WorkbenchThreadInfo {
  if (!isRecord(value) || typeof value.threadId !== "string") return false;
  return (
    isOptionalString(value.sessionId) &&
    isOptionalString(value.resourceId) &&
    isOptionalString(value.title) &&
    isOptionalString(value.cwd) &&
    isOptionalString(value.updatedAt) &&
    isOptional(value.lock, isThreadLockInfo) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchLoadStatus(value: unknown): value is WorkbenchLoadStatus {
  return value === "idle" || value === "loading" || value === "loaded" || value === "error";
}

function isWorkbenchCommandStatus(value: unknown): value is WorkbenchCommandStatus {
  return value === "idle" || value === "running" || value === "succeeded" || value === "failed";
}

function isWorkbenchRole(value: unknown): value is WorkbenchRole {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "thought" ||
    value === "system" ||
    value === "tool"
  );
}

function isWorkbenchMessageStatus(value: unknown): value is WorkbenchMessageStatus {
  return value === "streaming" || value === "complete" || value === "error";
}

function isWorkbenchRunStatus(value: unknown): value is WorkbenchRunStatus {
  return (
    value === "idle" ||
    value === "starting" ||
    value === "running" ||
    value === "waiting" ||
    value === "canceling" ||
    value === "error"
  );
}

function isWorkbenchDebugSource(value: unknown): value is WorkbenchDebugSource {
  return (
    value === "acp" ||
    value === "runtime" ||
    value === "workbench" ||
    value === "transport" ||
    value === "ui"
  );
}

function isWorkbenchProvenance(value: unknown): value is WorkbenchProvenance {
  if (!isRecord(value)) return false;
  return (
    isOptional(value.source, isWorkbenchDebugSource) &&
    (value.protocol == null ||
      value.protocol === "acp" ||
      value.protocol === "workbench" ||
      value.protocol === "local") &&
    isOptionalString(value.sessionId) &&
    isOptionalString(value.threadId) &&
    isOptionalString(value.messageId) &&
    isOptionalString(value.toolCallId) &&
    isOptionalString(value.updateType) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchMessagePart(value: unknown): value is WorkbenchMessagePart {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  const hasProvenance = isOptional(value.provenance, isWorkbenchProvenance);
  switch (value.kind) {
    case "text":
    case "reasoning":
    case "thought":
      return typeof value.text === "string" && hasProvenance;
    case "tool_call_ref":
    case "tool_result_ref":
      return typeof value.toolCallId === "string" && isOptionalString(value.label) && hasProvenance;
    case "approval_ref":
      return (
        typeof value.approvalId === "string" &&
        isOptionalString(value.toolCallId) &&
        isOptionalString(value.label) &&
        hasProvenance
      );
    case "status":
      return (
        typeof value.text === "string" &&
        (value.status == null ||
          isWorkbenchRunStatus(value.status) ||
          isWorkbenchCommandStatus(value.status) ||
          isWorkbenchMessageStatus(value.status)) &&
        hasProvenance
      );
    case "error":
      return typeof value.message === "string" && isOptionalString(value.code) && hasProvenance;
    case "raw":
      return isOptionalString(value.label) && hasProvenance;
    default:
      return false;
  }
}

function isWorkbenchMessage(value: unknown): value is WorkbenchMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isWorkbenchRole(value.role) &&
    Array.isArray(value.parts) &&
    value.parts.every(isWorkbenchMessagePart) &&
    isWorkbenchMessageStatus(value.status) &&
    isOptionalString(value.createdAt) &&
    isOptionalString(value.updatedAt) &&
    isOptional(value.provenance, isWorkbenchProvenance) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchToolLocation(value: unknown): value is WorkbenchToolLocation {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value.path) &&
    (value.line == null || typeof value.line === "number") &&
    (value.column == null || typeof value.column === "number") &&
    isOptionalString(value.uri)
  );
}

function isWorkbenchToolTimelineEntry(value: unknown): value is WorkbenchToolTimelineEntry {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  return (
    isOptionalString(value.label) &&
    isOptionalString(value.timestamp) &&
    isOptionalString(value.summary)
  );
}

function isWorkbenchToolCall(value: unknown): value is WorkbenchToolCall {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return false;
  }
  return (
    isOptionalString(value.content) &&
    isOptionalString(value.error) &&
    isOptionalString(value.startedAt) &&
    isOptionalString(value.updatedAt) &&
    isOptionalString(value.completedAt) &&
    isOptionalString(value.parentMessageId) &&
    (value.locations == null ||
      (Array.isArray(value.locations) && value.locations.every(isWorkbenchToolLocation))) &&
    (value.timeline == null ||
      (Array.isArray(value.timeline) && value.timeline.every(isWorkbenchToolTimelineEntry))) &&
    isOptional(value.provenance, isWorkbenchProvenance) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchPlanEntry(value: unknown): value is WorkbenchPlanEntry {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.content !== "string") {
    return false;
  }
  return (
    (value.priority == null ||
      value.priority === "high" ||
      value.priority === "medium" ||
      value.priority === "low") &&
    (value.status === "pending" || value.status === "in_progress" || value.status === "completed")
  );
}

function isWorkbenchApprovalOption(value: unknown): value is WorkbenchApprovalOption {
  return (
    isRecord(value) &&
    typeof value.optionId === "string" &&
    typeof value.name === "string" &&
    typeof value.kind === "string"
  );
}

function isWorkbenchApprovalRequest(value: unknown): value is WorkbenchApprovalRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.requestId === "string" &&
    typeof value.sessionId === "string" &&
    isWorkbenchToolCall(value.toolCall) &&
    Array.isArray(value.options) &&
    value.options.every(isWorkbenchApprovalOption) &&
    (value.status === "pending" || value.status === "resolved" || value.status === "canceled") &&
    isOptionalString(value.defaultOptionId) &&
    isOptionalString(value.selectedOptionId) &&
    isOptionalString(value.createdAt) &&
    isOptionalString(value.resolvedAt) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchObservationMemoryEntry(
  value: unknown,
): value is WorkbenchObservationMemoryEntry {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  return (
    (value.kind === "observation" || value.kind === "reflection") &&
    (value.status === "loading" ||
      value.status === "complete" ||
      value.status === "failed" ||
      value.status === "disconnected" ||
      value.status === "buffering" ||
      value.status === "buffering-complete" ||
      value.status === "buffering-failed" ||
      value.status === "activated") &&
    isOptionalString(value.title) &&
    isOptionalString(value.summary) &&
    (value.observedTokens == null || typeof value.observedTokens === "number") &&
    (value.compressionRatio == null || typeof value.compressionRatio === "number") &&
    (value.durationMs == null || typeof value.durationMs === "number") &&
    isOptionalString(value.error) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchSystemPromptSnapshot(value: unknown): value is WorkbenchSystemPromptSnapshot {
  return (
    isRecord(value) &&
    typeof value.content === "string" &&
    isOptionalString(value.source) &&
    isOptionalString(value.updatedAt) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchInspectorEntry(value: unknown): value is WorkbenchInspectorEntry {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string";
}

function isWorkbenchModelInfo(value: unknown): value is WorkbenchModelInfo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isOptionalString(value.provider) &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.variant) &&
    (value.disabled == null || typeof value.disabled === "boolean") &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchSessionModeInfo(value: unknown): value is WorkbenchSessionModeInfo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isOptionalString(value.description) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchAccessLevel(value: unknown): value is WorkbenchAccessLevel {
  return value === "read-only" || value === "ask" || value === "trusted";
}

function isWorkbenchAccessLevelInfo(value: unknown): value is WorkbenchAccessLevelInfo {
  return (
    isRecord(value) &&
    isWorkbenchAccessLevel(value.id) &&
    typeof value.name === "string" &&
    isOptionalString(value.description) &&
    isOptionalJsonObject(value.metadata)
  );
}

function isWorkbenchAgentState(value: unknown): value is WorkbenchAgentState {
  return (
    isRecord(value) &&
    isOptional(value.info, isWorkbenchAgentInfo) &&
    isOptional(value.session, isWorkbenchSessionInfo)
  );
}

function isWorkbenchThreadState(value: unknown): value is WorkbenchThreadState {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isWorkbenchThreadInfo) &&
    isOptionalString(value.activeThreadId) &&
    isOptionalString(value.selectedThreadId) &&
    isWorkbenchLoadStatus(value.status) &&
    isOptionalString(value.error)
  );
}

function isWorkbenchTranscriptState(value: unknown): value is WorkbenchTranscriptState {
  return (
    isRecord(value) &&
    Array.isArray(value.messages) &&
    value.messages.every(isWorkbenchMessage) &&
    isWorkbenchLoadStatus(value.status) &&
    isOptionalString(value.error)
  );
}

function isWorkbenchToolState(value: unknown): value is WorkbenchToolState {
  return (
    isRecord(value) &&
    Array.isArray(value.calls) &&
    value.calls.every(isWorkbenchToolCall) &&
    isStringArray(value.activeToolCallIds) &&
    isStringArray(value.recentToolCallIds) &&
    typeof value.rawIoAvailable === "boolean"
  );
}

function isWorkbenchApprovalState(value: unknown): value is WorkbenchApprovalState {
  return (
    isRecord(value) &&
    Array.isArray(value.requests) &&
    value.requests.every(isWorkbenchApprovalRequest)
  );
}

function isWorkbenchPlanState(value: unknown): value is WorkbenchPlanState {
  return (
    isRecord(value) && Array.isArray(value.entries) && value.entries.every(isWorkbenchPlanEntry)
  );
}

function isWorkbenchModelState(value: unknown): value is WorkbenchModelState {
  return (
    isRecord(value) &&
    isOptionalString(value.currentModelId) &&
    Array.isArray(value.availableModels) &&
    value.availableModels.every(isWorkbenchModelInfo) &&
    isStringArray(value.recentModelIds)
  );
}

function isWorkbenchSessionModeState(value: unknown): value is WorkbenchSessionModeState {
  return (
    isRecord(value) &&
    isOptionalString(value.currentModeId) &&
    Array.isArray(value.availableModes) &&
    value.availableModes.every(isWorkbenchSessionModeInfo)
  );
}

function isWorkbenchAccessLevelState(value: unknown): value is WorkbenchAccessLevelState {
  return (
    isRecord(value) &&
    isOptional(value.currentAccessLevel, isWorkbenchAccessLevel) &&
    Array.isArray(value.availableAccessLevels) &&
    value.availableAccessLevels.every(isWorkbenchAccessLevelInfo)
  );
}

function isWorkbenchMemoryState(value: unknown): value is WorkbenchMemoryState {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(isWorkbenchObservationMemoryEntry)
  );
}

function isWorkbenchInspectorState(value: unknown): value is WorkbenchInspectorState {
  return (
    isRecord(value) &&
    isOptional(value.systemPrompt, isWorkbenchSystemPromptSnapshot) &&
    Array.isArray(value.contextEntries) &&
    value.contextEntries.every(isWorkbenchInspectorEntry) &&
    Array.isArray(value.rawMessages) &&
    value.rawMessages.every(isWorkbenchInspectorEntry) &&
    isOptionalString(value.selectedEntryId)
  );
}

function isWorkbenchDebugEvent(value: unknown): value is WorkbenchDebugEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isWorkbenchDebugSource(value.source) &&
    typeof value.type === "string" &&
    isOptionalString(value.label) &&
    isOptionalString(value.timestamp)
  );
}

function isWorkbenchDebugState(value: unknown): value is WorkbenchDebugState {
  return (
    isRecord(value) &&
    Array.isArray(value.events) &&
    value.events.every(isWorkbenchDebugEvent) &&
    isOptionalString(value.selectedEventId)
  );
}

function isWorkbenchUiPreferencesState(value: unknown): value is WorkbenchUiPreferencesState {
  if (!isRecord(value)) return false;
  return (
    (value.activePanel === "threads" ||
      value.activePanel === "transcript" ||
      value.activePanel === "tools" ||
      value.activePanel === "inspector" ||
      value.activePanel === "memory") &&
    typeof value.sidebarVisible === "boolean" &&
    typeof value.inspectorVisible === "boolean" &&
    typeof value.timestampsVisible === "boolean" &&
    typeof value.reasoningVisible === "boolean" &&
    typeof value.toolDetailsVisible === "boolean" &&
    typeof value.rawIoVisible === "boolean" &&
    typeof value.compactToolOutput === "boolean" &&
    (value.diffWrap === "word" || value.diffWrap === "none")
  );
}

function isWorkbenchRunState(value: unknown): value is WorkbenchRunState {
  return (
    isRecord(value) &&
    isWorkbenchRunStatus(value.status) &&
    isOptionalString(value.startedAt) &&
    isOptionalString(value.completedAt) &&
    (value.stopReason == null || readStopReason(value.stopReason) !== undefined) &&
    isOptionalString(value.activeToolCallId)
  );
}

function isWorkbenchCommandState(value: unknown): value is WorkbenchCommandState {
  return (
    isRecord(value) &&
    isWorkbenchCommandStatus(value.status) &&
    isOptionalString(value.startedAt) &&
    isOptionalString(value.completedAt) &&
    isOptionalString(value.error)
  );
}

function isWorkbenchUiStatusState(value: unknown): value is WorkbenchUiStatusState {
  if (!isRecord(value) || !isWorkbenchRunState(value.overall) || !isStringArray(value.errors)) {
    return false;
  }
  return (
    isWorkbenchCommandState(value.start) &&
    isWorkbenchCommandState(value.send) &&
    isWorkbenchCommandState(value.threads) &&
    isWorkbenchCommandState(value.loadThread) &&
    isWorkbenchCommandState(value.cancel) &&
    isWorkbenchCommandState(value.model) &&
    isWorkbenchCommandState(value.mode)
  );
}

function readRuntimeInfo(value: unknown): WorkbenchRuntimeInfo | undefined {
  const runtime = workbenchRuntimeInfoSchema.safeParse(value);
  return runtime.success ? runtime.data : undefined;
}

function isThreadLockInfo(value: unknown): value is WorkbenchThreadLockInfo {
  return workbenchThreadLockInfoSchema.safeParse(value).success;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
