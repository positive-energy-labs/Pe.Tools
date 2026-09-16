import type {
  AgentControllerAvailableModel,
  KnownAgentControllerEvent,
  MastraDBMessage,
  MastraMessagePart,
  PermissionRules,
} from "@mastra/client-js";
import { threadAccessPolicies, type ThreadViewState } from "@pe/agent-contracts";
import { stringify } from "#/components/lang/code";
import type { PeInspect } from "#/host/inspect.ts";

export type ChatDisplay = Omit<
  Partial<Extract<KnownAgentControllerEvent, { type: "display_state_changed" }>["displayState"]>,
  "omProgress"
> & { omProgress?: OmProgress };

export interface OmProgress {
  status?: string;
  pendingTokens?: number;
  threshold?: number;
  observationTokens?: number;
  reflectionThreshold?: number;
  buffered?: {
    observations?: { status?: string };
    reflection?: { status?: string; observationTokens?: number };
  };
}

/** The fetched thread body plus the live display frame from the stream. */
export type ChatState = ThreadViewState<
  MastraDBMessage,
  AgentControllerAvailableModel,
  PermissionRules | undefined,
  PeInspect
> & { display: ChatDisplay };
export type AccessLevel = ChatState["access"];

/**
 * A user turn is a persisted user row or a live user signal. The persisted row says `type: "user"`
 * with text parts; the live `message_start` carries a `data-user-message` signal part.
 */
export function isUserTurn(message: MastraDBMessage): boolean {
  if (message.role === "user") return true;
  if (message.role !== "signal") return false;
  const signal = readRecord(readRecord(message.content.metadata)?.signal);
  return message.type === "user" || signal?.type === "user";
}

export function emptyChatState(): ChatState {
  return {
    display: {},
    messages: [],
    inspect: {},
    models: { available: [] },
    permissions: undefined,
    access: "ask",
    modeId: "",
  };
}

/** `result` is whatever the call has produced so far: partial while running, raw on failure. */
export type ToolOutcome = { result?: unknown } & (
  | { status: "in_progress" }
  | { status: "completed" }
  | { status: "failed"; error: string }
);

export type ToolCall = {
  id: string;
  title: string;
  args: unknown;
  target?: string;
  parentMessageId?: string;
} & ToolOutcome;

/**
 * The thread's user turns and assistant rows, with the message the run is streaming merged in by
 * id. Every chat projection reads this list, so the transcript and the trace lane agree.
 */
function threadRows(state: ChatState): MastraDBMessage[] {
  const stored = state.messages.filter(
    (message) => isUserTurn(message) || message.role === "assistant",
  );
  const wire = state.display.isRunning ? state.display.currentMessage : undefined;
  if (!wire) return stored;
  const current: MastraDBMessage = { ...wire, createdAt: new Date(wire.createdAt) };
  return stored.some((message) => message.id === current.id)
    ? stored.map((message) => (message.id === current.id ? current : message))
    : [...stored, current];
}

/** The one tool-call merge: stored invocations first (first sighting wins), then live-only tools,
 * which belong to the last assistant row. */
export function selectToolCalls(state: ChatState): ToolCall[] {
  const rows = threadRows(state);
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  for (const [messageAt, message] of rows.entries()) {
    for (const part of message.content.parts) {
      if (part.type !== "tool-invocation") continue;
      const call = part.toolInvocation;
      if (seen.has(call.toolCallId)) continue;
      seen.add(call.toolCallId);
      const active = state.display.activeTools?.[call.toolCallId];
      const terminal =
        call.state === "result" || call.state === "output-error" || call.state === "output-denied";
      const interrupted =
        !terminal && !active && (messageAt < rows.length - 1 || state.display.isRunning !== true);
      const failed =
        call.isError === true ||
        (terminal && call.state !== "result") ||
        active?.status === "error" ||
        interrupted;
      const completed = terminal || active?.status === "completed";
      const args = call.rawInput ?? call.args;
      const result = call.result ?? active?.result;
      const outcome: ToolOutcome = failed
        ? {
            status: "failed",
            error: call.errorText || text(result) || "Tool call ended without a terminal result.",
            result,
          }
        : { status: completed ? "completed" : "in_progress", result };
      calls.push({
        id: call.toolCallId,
        title: call.toolName,
        args,
        target: toolTarget(args),
        parentMessageId: message.id,
        ...outcome,
      });
    }
  }
  const lastAssistantId = rows.filter((m) => m.role === "assistant").at(-1)?.id;
  for (const [id, tool] of Object.entries(state.display.activeTools ?? {})) {
    if (seen.has(id)) continue;
    const result = tool.result ?? tool.shellOutput ?? tool.partialResult;
    const outcome: ToolOutcome =
      tool.status === "error" || tool.isError
        ? { status: "failed", error: text(tool.result) || "Tool call failed.", result }
        : { status: tool.status === "completed" ? "completed" : "in_progress", result };
    calls.push({
      id,
      title: tool.name,
      args: tool.args,
      target: toolTarget(tool.args),
      parentMessageId: lastAssistantId,
      ...outcome,
    });
  }
  return calls;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; image: string }
  | { type: "tool-call"; call: ToolCall; approval?: Approval };

/** One row of the chat transcript. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  createdAt?: Date;
  /** The assistant row the run is producing now; its last part is the one still moving. */
  running: boolean;
}

/**
 * The list the chat draws, in the same render as the lens. While the run has not started an
 * assistant row yet, a running placeholder stands in so the caret shows at once.
 */
export function selectMessages(state: ChatState): ChatMessage[] {
  const rows = threadRows(state);
  const calls = selectToolCalls(state);
  const callsById = new Map(calls.map((call) => [call.id, call]));
  const approvals = selectApprovals(state.display);
  const streamingId = state.display.isRunning ? state.display.currentMessage?.id : undefined;
  const toolPart = (call: ToolCall): ChatPart => ({
    type: "tool-call",
    call,
    approval: approvals.find((approval) => approval.toolCallId === call.id),
  });
  const emitted = new Set<string>();
  const messages = rows.map((message): ChatMessage => {
    const user = isUserTurn(message);
    const parts: ChatPart[] = [];
    for (const part of message.content.parts) {
      if (part.type === "text") {
        if (part.text.trim()) parts.push({ type: "text", text: part.text });
      } else if (part.type === "reasoning") {
        if (part.reasoning.trim()) parts.push({ type: "reasoning", text: part.reasoning });
      } else if (part.type === "file") {
        const url = imageSource(undefined, part.data, part.mimeType);
        if (url && (!part.mimeType || part.mimeType.startsWith("image/")))
          parts.push({ type: "image", image: url });
      } else if (part.type === "tool-invocation") {
        const call = callsById.get(part.toolInvocation.toolCallId);
        if (!call || emitted.has(call.id)) continue;
        emitted.add(call.id);
        parts.push(toolPart(call));
      } else if (part.type === "data-signal" || part.type === "data-user-message") {
        const data = readRecord(part.data);
        const said = signalText(data?.contents);
        if (said.trim() && (user || data?.tagName === "route-workspace"))
          parts.push({ type: "text", text: said });
      }
    }
    if (!user)
      for (const call of calls)
        if (call.parentMessageId === message.id && !emitted.has(call.id)) {
          emitted.add(call.id);
          parts.push(toolPart(call));
        }
    return {
      id: message.id,
      role: user ? "user" : "assistant",
      parts,
      ...createdAt(message),
      running: !user && message.id === streamingId,
    };
  });
  if (selectRunStatus(state) !== "idle" && messages.at(-1)?.role !== "assistant")
    messages.push({ id: "pea-pending", role: "assistant", parts: [], running: true });
  // The one renderable rule: speech, an image, a call, or the row still being produced.
  return messages.filter(
    (message) => message.running || message.parts.some((part) => part.type !== "reasoning"),
  );
}

function signalText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => readString(readRecord(part)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function createdAt(message: MastraDBMessage): { createdAt?: Date } {
  const at = message.createdAt;
  if (!at) return {};
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? {} : { createdAt: date };
}

/** A permission gate answers yes/no; a suspension answers with a resume payload. */
export type Approval = { toolCallId: string; toolName: string } & (
  | { kind: "permission" }
  | { kind: "suspension"; payload: unknown }
);

export function selectApprovals(display: ChatDisplay): Approval[] {
  const approvals: Approval[] = [];
  const pending = display.pendingApproval;
  if (pending)
    approvals.push({
      kind: "permission",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
    });
  for (const suspension of Object.values(display.pendingSuspensions ?? {})) {
    approvals.push({
      kind: "suspension",
      toolCallId: suspension.toolCallId,
      toolName: suspension.toolName,
      payload: suspension.suspendPayload,
    });
  }
  return approvals;
}

export type RunStatus = "idle" | "running" | "waiting";

export function selectRunStatus(state: ChatState): RunStatus {
  if (selectApprovals(state.display).length > 0) return "waiting";
  return state.display.isRunning ? "running" : "idle";
}

export function selectSkillCommands(inspect: PeInspect): { name: string; description: string }[] {
  return (inspect.skills ?? []).flatMap((skill) => {
    const record = readRecord(skill);
    const name = readString(record?.name);
    return name ? [{ name, description: readString(record?.description) ?? "skill" }] : [];
  });
}

export interface AccessLevelInfo {
  id: AccessLevel;
  name: string;
  description: string;
}

export const ACCESS_LEVELS: AccessLevelInfo[] = [
  { id: "read-only", name: "Read-only", description: "Block workspace changes." },
  { id: "ask", name: "Ask", description: "Ask before tools that change state." },
  { id: "trusted", name: "Trusted", description: "Run trusted workspace tools directly." },
];

export const PERMISSION_LEVELS = threadAccessPolicies;

export const APPROVAL_OPTIONS = [
  { id: "allow_once", kind: "allow-once", label: "Approve" },
  { id: "reject_once", kind: "reject-once", label: "Deny" },
];

export interface ContextItem {
  name: string;
  src?: string;
  tokens?: number;
  body?: string;
  state?: "in" | "on-demand" | "off";
}

export interface ContextSegment {
  id: string;
  label: string;
  tokens: number;
  items?: ContextItem[];
}

export interface MemoryWindows {
  messageTokens: number;
  observationThreshold: number;
  observationTokens: number;
  reflectionThreshold: number;
  reflectionFloor?: number;
  observing?: boolean;
  reflecting?: boolean;
}

export interface ContextBreakdown {
  contextWindow?: number;
  totalTokens: number;
  segments: ContextSegment[];
  memoryWindows?: MemoryWindows;
}

export function selectBreakdown(state: ChatState): ContextBreakdown | undefined {
  const inspect = state.inspect;
  const systemPromptText = inspect.systemPrompt?.content;
  const tools = breakdownTools(inspect.toolList);
  const skills = breakdownSkills(inspect.skills);
  if (
    systemPromptText === undefined &&
    tools.length === 0 &&
    skills.length === 0 &&
    inspect.contextWindow === undefined
  )
    return undefined;

  const segments: ContextSegment[] = [];
  const chat = state.messages.filter((m) => isUserTurn(m) || m.role === "assistant");
  const messageTokens = chat.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0);
  if (messageTokens > 0)
    segments.push({
      id: "messages",
      label: "Messages",
      tokens: messageTokens,
      items: [
        {
          name: `Conversation tail · ${chat.length} msgs`,
          src: "transcript",
          tokens: messageTokens,
          state: "in",
          body: "The newest turn is always uncached — this tail is reprocessed every send.",
        },
      ],
    });
  if (systemPromptText !== undefined)
    segments.push({
      id: "system-prompt",
      label: "System prompt",
      tokens: estimateTokens(systemPromptText),
      items: systemPromptItems(systemPromptText, inspect.agents),
    });
  if (tools.length > 0)
    segments.push({
      id: "tools",
      label: "Tools & MCP",
      tokens: tools.reduce((sum, tool) => sum + (tool.tokens ?? 0), 0),
      items: tools.map((tool) => ({ ...tool, state: "in" as const })),
    });
  if (skills.length > 0) segments.push({ id: "skills", label: "Skills", tokens: 0, items: skills });

  const totalTokens = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (inspect.contextWindow && inspect.contextWindow > totalTokens)
    segments.push({ id: "free", label: "Free space", tokens: inspect.contextWindow - totalTokens });

  return {
    contextWindow: inspect.contextWindow,
    totalTokens,
    segments,
    memoryWindows: memoryWindows(state.display.omProgress),
  };
}

function memoryWindows(om: OmProgress | undefined): MemoryWindows | undefined {
  if (!om) return undefined;
  const floor = om.buffered?.reflection?.observationTokens ?? 0;
  return {
    messageTokens: om.pendingTokens ?? 0,
    observationThreshold: om.threshold ?? 0,
    observationTokens: om.observationTokens ?? 0,
    reflectionThreshold: om.reflectionThreshold ?? 0,
    ...(floor > 0 ? { reflectionFloor: floor } : {}),
    observing: om.buffered?.observations?.status === "running" || om.status === "observing",
    reflecting: om.buffered?.reflection?.status === "running" || om.status === "reflecting",
  };
}

function systemPromptItems(text: string, agents: unknown[] | undefined): ContextItem[] {
  const trimmed = text.trim();
  const items: ContextItem[] = trimmed
    ? [
        {
          name: "Base identity",
          src: "resolved prompt",
          tokens: estimateTokens(trimmed),
          body: trimmed,
          state: "in",
        },
      ]
    : [];
  for (const agent of agents ?? []) {
    const record = readRecord(agent);
    const name = typeof agent === "string" ? agent : readString(record?.name);
    if (!name) continue;
    items.push({
      name: `agent · ${name}`,
      src: "agent instructions",
      body: readString(record?.description),
      state: "in",
    });
  }
  return items;
}

function breakdownTools(toolList: PeInspect["toolList"]): ContextItem[] {
  return (toolList?.tools ?? []).flatMap((tool): ContextItem[] => {
    const record = readRecord(tool);
    const name = readString(record?.name);
    if (!name) return [];
    const approx = record?.approxTokens;
    return [
      {
        name,
        src: "runtime/tools",
        tokens: typeof approx === "number" ? approx : estimateTokens(name),
        body: readString(record?.description),
      },
    ];
  });
}

function breakdownSkills(skills: unknown[] | undefined): ContextItem[] {
  return (skills ?? []).flatMap((skill): ContextItem[] => {
    const record = readRecord(skill);
    const name = readString(record?.name);
    if (!name) return [];
    const approx = record?.approxTokens;
    return [
      {
        name,
        src: ".claude/skills",
        tokens: typeof approx === "number" ? approx : undefined,
        body:
          readString(record?.body) ??
          readString(record?.content) ??
          readString(record?.description),
        state: "on-demand",
      },
    ];
  });
}

export function estimateTokens(text: string | undefined): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

export function messageText(message: MastraDBMessage): string {
  return message.content.parts
    .map((part) => partText(part))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function partText(part: MastraMessagePart): string {
  if (part.type === "text") return part.text;
  if (part.type === "reasoning") return part.reasoning;
  return "";
}

export function toolTarget(args: unknown): string | undefined {
  const record = readRecord(args);
  // pe_read / pe_do: the capability key is what the user reads on the card.
  if (typeof record?.key === "string") return record.key;
  const candidate = record?.path ?? record?.file ?? record?.query ?? record?.command;
  if (typeof candidate === "string") return candidate;
  if (typeof args === "string" && args.length <= 64) return args;
  return undefined;
}

/** Display text for a value that may already BE text. Not `stringify`: an error message
 * must not reach the user wrapped in quotes. */
export function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : stringify(value);
}

export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function imageSource(
  direct: string | undefined,
  data: string | undefined,
  mime: string | undefined,
): string | undefined {
  if (direct && /^(data:|https?:|blob:)/.test(direct)) return direct;
  const raw = data ?? (direct && !direct.includes("/") ? direct : undefined);
  if (raw) return `data:${mime ?? "image/png"};base64,${raw}`;
  return direct;
}
