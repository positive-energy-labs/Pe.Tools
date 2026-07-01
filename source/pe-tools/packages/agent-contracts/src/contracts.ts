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
export const peWorkbenchRawThreadMethod = "pe.tools/workbench.rawThread";
export const peWorkbenchQueueMessageMethod = "pe.tools/workbench.queueMessage";
export const peWorkbenchSetModelMethod = "pe.tools/workbench.setModel";
export const peWorkbenchSetAccessLevelMethod = "pe.tools/workbench.setAccessLevel";

export interface WorkbenchAgentCapabilities {
  threads?: boolean;
  history?: boolean;
  historySnapshots?: boolean;
  rawThreadSnapshots?: boolean;
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
export type WorkbenchDebugSource = "acp" | "ag-ui" | "runtime" | "workbench" | "transport" | "ui";

export interface WorkbenchProvenance {
  source?: WorkbenchDebugSource;
  protocol?: "acp" | "ag-ui" | "workbench" | "local";
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
      kind: "image";
      /** Ready-to-render source: a `data:` URL or a remote/blob URL. */
      url: string;
      mimeType?: string;
      filename?: string;
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
  /** Small label (path/file/query/command) for the inline marker. Cheap to stream; the heavy
   *  rawInput/rawOutput are fetched on demand via GET /workbench/tool and may be absent here. */
  target?: string;
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

/** One named constituent of a context segment — a tool, a prompt section, a skill. */
export interface WorkbenchContextItem {
  /** Display name (tool name, prompt-section heading, `skill · name`). */
  name: string;
  /** Provenance line, mono (e.g. "runtime/tools", "mcp · server-x", ".claude/skills"). */
  src?: string;
  /** Approx tokens this item costs in-context. */
  tokens?: number;
  /** Expandable content preview (tool description, prompt section body, skill description). */
  body?: string;
  /** Load state: in-context, catalog-only (loads on demand), or configured-but-off. */
  state?: "in" | "on-demand" | "off";
}

/** One row of the context-window token breakdown (system prompt, tools, messages, …). */
export interface WorkbenchContextSegment {
  id: string;
  label: string;
  tokens: number;
  /** Named contents — tools, prompt sections, skills — structured for the World inspector. */
  items?: WorkbenchContextItem[];
}

/**
 * The two observational-memory windows that govern the messages + memory categories.
 * `messages` fill toward `observationThreshold` then observe (compact into observations);
 * observations fill toward `reflectionThreshold` then reflect (compress in place down to a
 * floor). Sourced from the harness `omProgress` — config-derived, not hardcoded.
 */
export interface WorkbenchMemoryWindows {
  /** Messages window: conversation tokens awaiting observation. */
  messageTokens: number;
  /** Messages compact (observe) at this token count. */
  observationThreshold: number;
  /** Observations window: durable memory tokens currently in context. */
  observationTokens: number;
  /** Observations compress (reflect) at this token count. */
  reflectionThreshold: number;
  /** Post-reflect low-water (buffered reflection output), if a reflection has run. */
  reflectionFloor?: number;
  /** An observe cycle (messages → observations) is in flight. */
  observing?: boolean;
  /** A reflect cycle (observations compressed in place) is in flight. */
  reflecting?: boolean;
}

/** Token breakdown of what fills the model's context window for this thread. */
export interface WorkbenchContextBreakdown {
  /** Model context window size in tokens, if known (for the free-space bar). */
  contextWindow?: number;
  totalTokens: number;
  segments: WorkbenchContextSegment[];
  /** OM windows for the messages + memory categories, when the runtime reports them. */
  memoryWindows?: WorkbenchMemoryWindows;
  updatedAt?: string;
}

export interface WorkbenchInspectorState {
  systemPrompt?: WorkbenchSystemPromptSnapshot;
  contextBreakdown?: WorkbenchContextBreakdown;
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
  contextBreakdown?: WorkbenchContextBreakdown;
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

export interface WorkbenchRawMessage {
  id?: string;
  role?: string;
  type?: string;
  text?: string;
  createdAt?: string;
}

export interface WorkbenchRawLedgerEntry {
  sequence?: number;
  type?: string;
  createdAt?: string;
  rawEventType?: string;
  rawEvent?: unknown;
  event?: unknown;
  content?: string;
  message?: WorkbenchRawMessage;
  payload?: unknown;
}

export interface WorkbenchRawDatabaseSnapshot {
  source?: { url?: string; localPath?: string };
  tables?: string[];
  threadRows?: Record<string, unknown>[];
  messageRows?: Record<string, unknown>[];
  resourceRows?: Record<string, unknown>[];
  observationalMemoryRows?: Record<string, unknown>[];
  threadStateRows?: Record<string, unknown>[];
  errors?: string[];
}

export interface WorkbenchRawThreadSnapshot {
  generatedAt?: string;
  requestedThreadId?: string;
  session?: unknown;
  messages?: WorkbenchRawMessage[];
  ledger?: WorkbenchRawLedgerEntry[];
  history?: unknown[];
  database?: WorkbenchRawDatabaseSnapshot;
  errors?: string[];
}

export interface WorkbenchRawThreadRequest extends WorkbenchStartRequest {
  threadId: string;
  sessionId?: string;
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
  rawThread?(request: WorkbenchRawThreadRequest): Promise<WorkbenchRawThreadSnapshot>;
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
  "rawThreadSnapshots",
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
// --- Workbench runtime schemas ------------------------------------------------
// These mirror the (former) hand-written guards: objects are `.loose()` so extra
// keys pass through untouched, optionals are `.nullish()` because the guards used
// `== null`, and only the fields the guards actually validated are listed.
const optString = z.string().nullish();
const optNumber = z.number().nullish();
const metadataObject = z.record(z.string(), z.unknown()).nullish();

const loadStatusSchema = z.enum(["idle", "loading", "loaded", "error"]);
const commandStatusSchema = z.enum(["idle", "running", "succeeded", "failed"]);
const roleSchema = z.enum(["user", "assistant", "thought", "system", "tool"]);
const messageStatusSchema = z.enum(["streaming", "complete", "error"]);
const runStatusSchema = z.enum(["idle", "starting", "running", "waiting", "canceling", "error"]);
const debugSourceSchema = z.enum(["acp", "ag-ui", "runtime", "workbench", "transport", "ui"]);
const accessLevelSchema = z.enum(["read-only", "ask", "trusted"]);

const provenanceSchema = z
  .object({
    source: debugSourceSchema.nullish(),
    protocol: z.enum(["acp", "ag-ui", "workbench", "local"]).nullish(),
    sessionId: optString,
    threadId: optString,
    messageId: optString,
    toolCallId: optString,
    updateType: optString,
    metadata: metadataObject,
  })
  .loose();

const messagePartProvenance = { provenance: provenanceSchema.nullish() };
const messagePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string(), ...messagePartProvenance }).loose(),
  z.object({ kind: z.literal("reasoning"), text: z.string(), ...messagePartProvenance }).loose(),
  z.object({ kind: z.literal("thought"), text: z.string(), ...messagePartProvenance }).loose(),
  z
    .object({
      kind: z.literal("image"),
      url: z.string(),
      mimeType: optString,
      filename: optString,
      ...messagePartProvenance,
    })
    .loose(),
  z
    .object({
      kind: z.literal("tool_call_ref"),
      toolCallId: z.string(),
      label: optString,
      ...messagePartProvenance,
    })
    .loose(),
  z
    .object({
      kind: z.literal("tool_result_ref"),
      toolCallId: z.string(),
      label: optString,
      ...messagePartProvenance,
    })
    .loose(),
  z
    .object({
      kind: z.literal("approval_ref"),
      approvalId: z.string(),
      toolCallId: optString,
      label: optString,
      ...messagePartProvenance,
    })
    .loose(),
  z
    .object({
      kind: z.literal("status"),
      text: z.string(),
      status: z.union([runStatusSchema, commandStatusSchema, messageStatusSchema]).nullish(),
      ...messagePartProvenance,
    })
    .loose(),
  z
    .object({
      kind: z.literal("error"),
      message: z.string(),
      code: optString,
      ...messagePartProvenance,
    })
    .loose(),
  z.object({ kind: z.literal("raw"), label: optString, ...messagePartProvenance }).loose(),
]);

const workbenchMessageSchema = z
  .object({
    id: z.string(),
    role: roleSchema,
    parts: z.array(messagePartSchema),
    status: messageStatusSchema,
    createdAt: optString,
    updatedAt: optString,
    provenance: provenanceSchema.nullish(),
    metadata: metadataObject,
  })
  .loose() as z.ZodType<WorkbenchMessage>;

const toolLocationSchema = z
  .object({ path: optString, line: optNumber, column: optNumber, uri: optString })
  .loose();
const toolTimelineEntrySchema = z
  .object({ id: z.string(), label: optString, timestamp: optString, summary: optString })
  .loose();
const toolCallSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    content: optString,
    error: optString,
    startedAt: optString,
    updatedAt: optString,
    completedAt: optString,
    parentMessageId: optString,
    locations: z.array(toolLocationSchema).nullish(),
    timeline: z.array(toolTimelineEntrySchema).nullish(),
    provenance: provenanceSchema.nullish(),
    metadata: metadataObject,
  })
  .loose();

const planEntrySchema = z
  .object({
    id: z.string(),
    content: z.string(),
    priority: z.enum(["high", "medium", "low"]).nullish(),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .loose();

const approvalOptionSchema = z
  .object({ optionId: z.string(), name: z.string(), kind: z.string() })
  .loose();
const approvalRequestSchema = z
  .object({
    requestId: z.string(),
    sessionId: z.string(),
    toolCall: toolCallSchema,
    options: z.array(approvalOptionSchema),
    status: z.enum(["pending", "resolved", "canceled"]),
    defaultOptionId: optString,
    selectedOptionId: optString,
    createdAt: optString,
    resolvedAt: optString,
    metadata: metadataObject,
  })
  .loose();

const observationMemoryEntrySchema = z
  .object({
    id: z.string(),
    kind: z.enum(["observation", "reflection"]),
    status: z.enum([
      "loading",
      "complete",
      "failed",
      "disconnected",
      "buffering",
      "buffering-complete",
      "buffering-failed",
      "activated",
    ]),
    title: optString,
    summary: optString,
    observedTokens: optNumber,
    compressionRatio: optNumber,
    durationMs: optNumber,
    error: optString,
    metadata: metadataObject,
  })
  .loose();

const debugEventSchema = z
  .object({
    id: z.string(),
    source: debugSourceSchema,
    type: z.string(),
    label: optString,
    timestamp: optString,
  })
  .loose();

const agentInfoSchema = z
  .object({
    name: z.string(),
    runtime: workbenchRuntimeInfoSchema.nullish(),
    capabilities: z.record(z.string(), z.unknown()),
    metadata: metadataObject,
  })
  .loose();
const threadInfoSchema = z
  .object({
    threadId: z.string(),
    sessionId: optString,
    resourceId: optString,
    title: optString,
    cwd: optString,
    updatedAt: optString,
    lock: workbenchThreadLockInfoSchema.nullish(),
    metadata: metadataObject,
  })
  .loose();
const modelInfoSchema = z
  .object({
    id: z.string(),
    provider: optString,
    displayName: optString,
    variant: optString,
    disabled: z.boolean().nullish(),
    metadata: metadataObject,
  })
  .loose();
const sessionModeInfoSchema = z
  .object({ id: z.string(), name: z.string(), description: optString, metadata: metadataObject })
  .loose();
const accessLevelInfoSchema = z
  .object({
    id: accessLevelSchema,
    name: z.string(),
    description: optString,
    metadata: metadataObject,
  })
  .loose();
const systemPromptSnapshotSchema = z
  .object({
    content: z.string(),
    source: optString,
    updatedAt: optString,
    metadata: metadataObject,
  })
  .loose();
const inspectorEntrySchema = z.object({ id: z.string(), title: z.string() }).loose();
const contextItemSchema = z
  .object({
    name: z.string(),
    src: optString,
    tokens: z.number().nullish(),
    body: optString,
    state: z.enum(["in", "on-demand", "off"]).nullish(),
  })
  .loose();
const contextBreakdownSchema = z
  .object({
    contextWindow: z.number().nullish(),
    totalTokens: z.number(),
    segments: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          tokens: z.number(),
          items: z.array(contextItemSchema).nullish(),
        })
        .loose(),
    ),
    memoryWindows: z
      .object({
        messageTokens: z.number(),
        observationThreshold: z.number(),
        observationTokens: z.number(),
        reflectionThreshold: z.number(),
        reflectionFloor: z.number().nullish(),
        observing: z.boolean().nullish(),
        reflecting: z.boolean().nullish(),
      })
      .loose()
      .nullish(),
    updatedAt: optString,
  })
  .loose();
const runStateSchema = z
  .object({
    status: runStatusSchema,
    startedAt: optString,
    completedAt: optString,
    stopReason: stopReasonSchema.nullish(),
    activeToolCallId: optString,
  })
  .loose();
const commandStateSchema = z
  .object({
    status: commandStatusSchema,
    startedAt: optString,
    completedAt: optString,
    error: optString,
  })
  .loose();

const workbenchStateSchema = z
  .object({
    agent: z
      .object({ info: agentInfoSchema.nullish(), session: workbenchSessionInfoSchema.nullish() })
      .loose(),
    threads: z
      .object({
        items: z.array(threadInfoSchema),
        activeThreadId: optString,
        selectedThreadId: optString,
        status: loadStatusSchema,
        error: optString,
      })
      .loose(),
    transcript: z
      .object({
        messages: z.array(workbenchMessageSchema),
        status: loadStatusSchema,
        error: optString,
      })
      .loose(),
    tools: z
      .object({
        calls: z.array(toolCallSchema),
        activeToolCallIds: z.array(z.string()),
        recentToolCallIds: z.array(z.string()),
        rawIoAvailable: z.boolean(),
      })
      .loose(),
    approvals: z.object({ requests: z.array(approvalRequestSchema) }).loose(),
    plans: z.object({ entries: z.array(planEntrySchema) }).loose(),
    models: z
      .object({
        currentModelId: optString,
        availableModels: z.array(modelInfoSchema),
        recentModelIds: z.array(z.string()),
      })
      .loose(),
    modes: z
      .object({ currentModeId: optString, availableModes: z.array(sessionModeInfoSchema) })
      .loose(),
    access: z
      .object({
        currentAccessLevel: accessLevelSchema.nullish(),
        availableAccessLevels: z.array(accessLevelInfoSchema),
      })
      .loose(),
    memory: z.object({ entries: z.array(observationMemoryEntrySchema) }).loose(),
    inspector: z
      .object({
        systemPrompt: systemPromptSnapshotSchema.nullish(),
        contextBreakdown: contextBreakdownSchema.nullish(),
        contextEntries: z.array(inspectorEntrySchema),
        rawMessages: z.array(inspectorEntrySchema),
        selectedEntryId: optString,
      })
      .loose(),
    debug: z.object({ events: z.array(debugEventSchema), selectedEventId: optString }).loose(),
    uiPreferences: z
      .object({
        activePanel: z.enum(["threads", "transcript", "tools", "inspector", "memory"]),
        sidebarVisible: z.boolean(),
        inspectorVisible: z.boolean(),
        timestampsVisible: z.boolean(),
        reasoningVisible: z.boolean(),
        toolDetailsVisible: z.boolean(),
        rawIoVisible: z.boolean(),
        compactToolOutput: z.boolean(),
        diffWrap: z.enum(["word", "none"]),
      })
      .loose(),
    uiStatus: z
      .object({
        overall: runStateSchema,
        start: commandStateSchema,
        send: commandStateSchema,
        threads: commandStateSchema,
        loadThread: commandStateSchema,
        cancel: commandStateSchema,
        model: commandStateSchema,
        mode: commandStateSchema,
        errors: z.array(z.string()),
      })
      .loose(),
  })
  .loose() as unknown as z.ZodType<WorkbenchState>;

const looseRecord = z.record(z.string(), z.unknown());
const workbenchEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent_initialized"), agent: agentInfoSchema }).loose(),
  z
    .object({
      type: z.literal("session_started"),
      session: workbenchSessionInfoSchema,
      thread: threadInfoSchema.nullish(),
    })
    .loose(),
  z.object({ type: z.literal("session_updated"), session: looseRecord }).loose(),
  z.object({ type: z.literal("ui_status_changed"), status: commandStatusSchema }).loose(),
  z
    .object({
      type: z.literal("run_status_changed"),
      status: runStatusSchema,
      stopReason: stopReasonSchema.nullish(),
    })
    .loose(),
  z
    .object({ type: z.literal("transcript_replaced"), messages: z.array(workbenchMessageSchema) })
    .loose(),
  z
    .object({
      type: z.literal("message_part_delta"),
      messageId: z.string(),
      role: roleSchema,
      part: messagePartSchema,
    })
    .loose(),
  z.object({ type: z.literal("message_updated"), message: workbenchMessageSchema }).loose(),
  z.object({ type: z.literal("tool_call_updated"), toolCall: toolCallSchema }).loose(),
  z.object({ type: z.literal("plan_replaced"), entries: z.array(planEntrySchema) }).loose(),
  z.object({ type: z.literal("approval_requested"), approval: approvalRequestSchema }).loose(),
  z.object({ type: z.literal("approval_resolved"), requestId: z.string() }).loose(),
  z.object({ type: z.literal("approvals_cleared"), reason: optString }).loose(),
  z.object({ type: z.literal("threads_replaced"), threads: z.array(threadInfoSchema) }).loose(),
  z.object({ type: z.literal("thread_selected"), threadId: optString }).loose(),
  z
    .object({
      type: z.literal("observational_memory_updated"),
      entry: observationMemoryEntrySchema,
    })
    .loose(),
  z.object({ type: z.literal("observational_memory_removed"), id: z.string() }).loose(),
  z.object({ type: z.literal("inspector_updated"), inspector: looseRecord }).loose(),
  z.object({ type: z.literal("model_state_updated"), model: looseRecord }).loose(),
  z.object({ type: z.literal("session_mode_updated"), sessionMode: looseRecord }).loose(),
  z.object({ type: z.literal("access_level_updated"), access: looseRecord }).loose(),
  z.object({ type: z.literal("ui_preferences_updated"), preferences: looseRecord }).loose(),
  z.object({ type: z.literal("debug_event_recorded"), debugEvent: debugEventSchema }).loose(),
  z.object({ type: z.literal("error"), message: z.string() }).loose(),
]) as unknown as z.ZodType<WorkbenchEvent>;

const workbenchLoadThreadResponseSchema = z
  .object({
    session: workbenchSessionInfoSchema,
    messages: z.array(workbenchMessageSchema).optional(),
    events: z.array(workbenchEventSchema).optional(),
  })
  .strip();
const workbenchRawThreadSnapshotSchema = z
  .object({
    generatedAt: z.string().optional(),
    requestedThreadId: z.string().optional(),
    session: z.unknown().optional(),
    messages: z.array(z.unknown()).optional(),
    ledger: z.array(z.unknown()).optional(),
    history: z.array(z.unknown()).optional(),
    database: z.unknown().optional(),
    errors: z.array(z.string()).optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchRawThreadSnapshot => ({
      ...value,
      messages: value.messages?.map(readRawMessage),
      ledger: value.ledger?.map(readRawLedgerEntry),
      database: readRawDatabaseSnapshot(value.database),
    }),
  );

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

export function readWorkbenchRawThreadSnapshot(
  value: unknown,
): WorkbenchRawThreadSnapshot | undefined {
  const snapshot = workbenchRawThreadSnapshotSchema.safeParse(value);
  return snapshot.success ? snapshot.data : undefined;
}

export function readWorkbenchSessionInfo(value: unknown): WorkbenchSessionInfo | undefined {
  const session = workbenchSessionInfoSchema.safeParse(value);
  return session.success ? session.data : undefined;
}

export function isWorkbenchEvent(value: unknown): value is WorkbenchEvent {
  return workbenchEventSchema.safeParse(value).success;
}

export function isWorkbenchState(value: unknown): value is WorkbenchState {
  return workbenchStateSchema.safeParse(value).success;
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function readRawMessage(value: unknown): WorkbenchRawMessage {
  const record = readRecord(value);
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.role === "string" ? { role: record.role } : {}),
    ...(typeof record.type === "string" ? { type: record.type } : {}),
    ...(typeof record.text === "string" ? { text: record.text } : {}),
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
  };
}

function readRawLedgerEntry(value: unknown): WorkbenchRawLedgerEntry {
  const record = readRecord(value);
  const message = isRecord(record.message) ? readRawMessage(record.message) : undefined;
  return {
    ...(typeof record.sequence === "number" ? { sequence: record.sequence } : {}),
    ...(typeof record.type === "string" ? { type: record.type } : {}),
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.rawEventType === "string" ? { rawEventType: record.rawEventType } : {}),
    ...(record.rawEvent !== undefined ? { rawEvent: record.rawEvent } : {}),
    ...(record.event !== undefined ? { event: record.event } : {}),
    ...(typeof record.content === "string" ? { content: record.content } : {}),
    ...(message ? { message } : {}),
    ...(record.payload !== undefined ? { payload: record.payload } : {}),
  };
}

function readRawDatabaseSnapshot(value: unknown): WorkbenchRawDatabaseSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.source)
    ? {
        ...(typeof value.source.url === "string" ? { url: value.source.url } : {}),
        ...(typeof value.source.localPath === "string"
          ? { localPath: value.source.localPath }
          : {}),
      }
    : undefined;
  return {
    ...(source ? { source } : {}),
    ...(Array.isArray(value.tables) ? { tables: value.tables.filter(isString) } : {}),
    ...(Array.isArray(value.threadRows) ? { threadRows: value.threadRows.filter(isRecord) } : {}),
    ...(Array.isArray(value.messageRows)
      ? { messageRows: value.messageRows.filter(isRecord) }
      : {}),
    ...(Array.isArray(value.resourceRows)
      ? { resourceRows: value.resourceRows.filter(isRecord) }
      : {}),
    ...(Array.isArray(value.observationalMemoryRows)
      ? { observationalMemoryRows: value.observationalMemoryRows.filter(isRecord) }
      : {}),
    ...(Array.isArray(value.threadStateRows)
      ? { threadStateRows: value.threadStateRows.filter(isRecord) }
      : {}),
    ...(Array.isArray(value.errors) ? { errors: value.errors.filter(isString) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
