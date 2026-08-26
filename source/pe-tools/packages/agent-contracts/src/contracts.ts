import type {
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

/** Raw AgentController session-state map — the collaborative-UI primitive.
 * Route slices live under namespaced `route:*` keys (see route-state.ts);
 * every server-side write rebroadcasts the full map via `state_changed`. */
export interface WorkbenchSessionStateState {
  values: Record<string, unknown>;
  /** False until the first state_changed (or hydration nudge) lands. */
  hydrated: boolean;
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
  sessionState: WorkbenchSessionStateState;
  uiPreferences: WorkbenchUiPreferencesState;
  uiStatus: WorkbenchUiStatusState;
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
// These mirror the (former) hand-written guards: objects are `.passthrough()` so extra
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
  .passthrough();

const messagePartProvenance = { provenance: provenanceSchema.nullish() };
const messagePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string(), ...messagePartProvenance }).passthrough(),
  z
    .object({ kind: z.literal("reasoning"), text: z.string(), ...messagePartProvenance })
    .passthrough(),
  z
    .object({ kind: z.literal("thought"), text: z.string(), ...messagePartProvenance })
    .passthrough(),
  z
    .object({
      kind: z.literal("image"),
      url: z.string(),
      mimeType: optString,
      filename: optString,
      ...messagePartProvenance,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("tool_call_ref"),
      toolCallId: z.string(),
      label: optString,
      ...messagePartProvenance,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("tool_result_ref"),
      toolCallId: z.string(),
      label: optString,
      ...messagePartProvenance,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("approval_ref"),
      approvalId: z.string(),
      toolCallId: optString,
      label: optString,
      ...messagePartProvenance,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("status"),
      text: z.string(),
      status: z.union([runStatusSchema, commandStatusSchema, messageStatusSchema]).nullish(),
      ...messagePartProvenance,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("error"),
      message: z.string(),
      code: optString,
      ...messagePartProvenance,
    })
    .passthrough(),
  z.object({ kind: z.literal("raw"), label: optString, ...messagePartProvenance }).passthrough(),
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
  .passthrough() as z.ZodType<WorkbenchMessage>;

const toolLocationSchema = z
  .object({ path: optString, line: optNumber, column: optNumber, uri: optString })
  .passthrough();
const toolTimelineEntrySchema = z
  .object({ id: z.string(), label: optString, timestamp: optString, summary: optString })
  .passthrough();
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
  .passthrough();

const planEntrySchema = z
  .object({
    id: z.string(),
    content: z.string(),
    priority: z.enum(["high", "medium", "low"]).nullish(),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .passthrough();

const approvalOptionSchema = z
  .object({ optionId: z.string(), name: z.string(), kind: z.string() })
  .passthrough();
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
  .passthrough();

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
  .passthrough();

const debugEventSchema = z
  .object({
    id: z.string(),
    source: debugSourceSchema,
    type: z.string(),
    label: optString,
    timestamp: optString,
  })
  .passthrough();

const agentInfoSchema = z
  .object({
    name: z.string(),
    runtime: workbenchRuntimeInfoSchema.nullish(),
    capabilities: z.record(z.string(), z.unknown()),
    metadata: metadataObject,
  })
  .passthrough();
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
  .passthrough();
const modelInfoSchema = z
  .object({
    id: z.string(),
    provider: optString,
    displayName: optString,
    variant: optString,
    disabled: z.boolean().nullish(),
    metadata: metadataObject,
  })
  .passthrough();
const sessionModeInfoSchema = z
  .object({ id: z.string(), name: z.string(), description: optString, metadata: metadataObject })
  .passthrough();
const accessLevelInfoSchema = z
  .object({
    id: accessLevelSchema,
    name: z.string(),
    description: optString,
    metadata: metadataObject,
  })
  .passthrough();
const systemPromptSnapshotSchema = z
  .object({
    content: z.string(),
    source: optString,
    updatedAt: optString,
    metadata: metadataObject,
  })
  .passthrough();
const inspectorEntrySchema = z.object({ id: z.string(), title: z.string() }).passthrough();
const contextItemSchema = z
  .object({
    name: z.string(),
    src: optString,
    tokens: z.number().nullish(),
    body: optString,
    state: z.enum(["in", "on-demand", "off"]).nullish(),
  })
  .passthrough();
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
        .passthrough(),
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
      .passthrough()
      .nullish(),
    updatedAt: optString,
  })
  .passthrough();
const runStateSchema = z
  .object({
    status: runStatusSchema,
    startedAt: optString,
    completedAt: optString,
    stopReason: stopReasonSchema.nullish(),
    activeToolCallId: optString,
  })
  .passthrough();
const commandStateSchema = z
  .object({
    status: commandStatusSchema,
    startedAt: optString,
    completedAt: optString,
    error: optString,
  })
  .passthrough();

const workbenchStateSchema = z
  .object({
    agent: z
      .object({ info: agentInfoSchema.nullish(), session: workbenchSessionInfoSchema.nullish() })
      .passthrough(),
    threads: z
      .object({
        items: z.array(threadInfoSchema),
        activeThreadId: optString,
        selectedThreadId: optString,
        status: loadStatusSchema,
        error: optString,
      })
      .passthrough(),
    transcript: z
      .object({
        messages: z.array(workbenchMessageSchema),
        status: loadStatusSchema,
        error: optString,
      })
      .passthrough(),
    tools: z
      .object({
        calls: z.array(toolCallSchema),
        activeToolCallIds: z.array(z.string()),
        recentToolCallIds: z.array(z.string()),
        rawIoAvailable: z.boolean(),
      })
      .passthrough(),
    approvals: z.object({ requests: z.array(approvalRequestSchema) }).passthrough(),
    plans: z.object({ entries: z.array(planEntrySchema) }).passthrough(),
    models: z
      .object({
        currentModelId: optString,
        availableModels: z.array(modelInfoSchema),
        recentModelIds: z.array(z.string()),
      })
      .passthrough(),
    modes: z
      .object({ currentModeId: optString, availableModes: z.array(sessionModeInfoSchema) })
      .passthrough(),
    access: z
      .object({
        currentAccessLevel: accessLevelSchema.nullish(),
        availableAccessLevels: z.array(accessLevelInfoSchema),
      })
      .passthrough(),
    memory: z.object({ entries: z.array(observationMemoryEntrySchema) }).passthrough(),
    inspector: z
      .object({
        systemPrompt: systemPromptSnapshotSchema.nullish(),
        contextBreakdown: contextBreakdownSchema.nullish(),
        contextEntries: z.array(inspectorEntrySchema),
        rawMessages: z.array(inspectorEntrySchema),
        selectedEntryId: optString,
      })
      .passthrough(),
    debug: z
      .object({ events: z.array(debugEventSchema), selectedEventId: optString })
      .passthrough(),
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
      .passthrough(),
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
      .passthrough(),
  })
  .passthrough() as unknown as z.ZodType<WorkbenchState>;

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

export function readWorkbenchSessionInfo(value: unknown): WorkbenchSessionInfo | undefined {
  const session = workbenchSessionInfoSchema.safeParse(value);
  return session.success ? session.data : undefined;
}

export function isWorkbenchState(value: unknown): value is WorkbenchState {
  return workbenchStateSchema.safeParse(value).success;
}
