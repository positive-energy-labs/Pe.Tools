import type {
  AgentControllerAvailableModel,
  KnownAgentControllerEvent,
  MastraDBMessage,
  MastraMessagePart,
  PermissionRules,
} from "@mastra/client-js";

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

export interface PeInspect {
  systemPrompt?: { content?: string; source?: string; updatedAt?: string };
  toolList?: { tools?: unknown[] };
  skills?: unknown[];
  observationalMemory?: Record<string, unknown>;
  contextWindow?: number;
  agents?: unknown[];
}

export type AccessLevel = "read-only" | "ask" | "trusted";

export interface ChatState {
  display: ChatDisplay;
  messages: MastraDBMessage[];
  inspect: PeInspect;
  models: { currentId?: string; available: AgentControllerAvailableModel[] };
  access: AccessLevel;
  /**
   * Raw AgentController session-state map — route slices live under `route:*` keys.
   * ponytail: shim, and currently a shim with no reader. `session.state()` returns
   * thread/mode/model/tasks and NOT this map, so `state_changed` is the only read that exists —
   * but the route panes take their slice from the route-store kit instead
   * (`route-chat-plugins.tsx` overrides the `sessionState` prop with `route.slice`). Kept per the
   * wave ruling; delete it with the `state_changed` arm once that stays true.
   */
  sessionValues: Record<string, unknown>;
  errors: string[];
}

export function emptyChatState(): ChatState {
  return {
    display: {},
    messages: [],
    inspect: {},
    models: { available: [] },
    access: "ask",
    sessionValues: {},
    errors: [],
  };
}

export interface HydrateInputs {
  session?: { modelId?: string; running?: boolean; tasks?: unknown[]; omProgress?: OmProgress };
  messages: MastraDBMessage[];
  inspect: PeInspect;
  models: AgentControllerAvailableModel[];
  permissions?: PermissionRules;
}

export function hydrateChatState(inputs: HydrateInputs): ChatState {
  const session = inputs.session;
  return {
    ...emptyChatState(),
    display: {
      isRunning: session?.running ?? false,
      tasks: (session?.tasks ?? []) as ChatDisplay["tasks"],
      omProgress: session?.omProgress,
    },
    messages: inputs.messages,
    inspect: inputs.inspect,
    models: { currentId: session?.modelId || undefined, available: inputs.models },
    access: accessLevelFromPermissions(inputs.permissions),
  };
}

export function applyEvent(state: ChatState, event: KnownAgentControllerEvent): ChatState {
  switch (event.type) {
    case "display_state_changed":
      return { ...state, display: event.displayState };
    case "message_start":
    case "message_update":
    case "message_end":
      return { ...state, messages: upsertMessage(state.messages, event.message) };
    case "state_changed":
      return { ...state, sessionValues: event.state };
    case "model_changed":
      return { ...state, models: { ...state.models, currentId: event.modelId } };
    case "error":
      return pushError(state, errorText(event.error));
    case "agent_end":
      return event.reason === "error" && state.errors.length === 0
        ? pushError(state, "Run failed.")
        : state;
    default:
      return state;
  }
}

function upsertMessage(messages: MastraDBMessage[], next: MastraDBMessage): MastraDBMessage[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index >= 0) return messages.map((message, at) => (at === index ? next : message));
  // assistant-ui message array (id count changes under mounted rows). ponytail: text-equality twin
  if (next.role === "user") {
    const twin = messages.findIndex(
      (message) =>
        message.id.startsWith("local-user-") &&
        message.role === "user" &&
        messageText(message) === messageText(next),
    );
    if (twin >= 0) return messages.map((message, at) => (at === twin ? next : message));
  }
  return [...messages, next];
}

function pushError(state: ChatState, message: string): ChatState {
  return state.errors.includes(message) ? state : { ...state, errors: [...state.errors, message] };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return readString(readRecord(error)?.message) || stringify(error) || "Unknown error.";
}

export type ToolStatus = "in_progress" | "completed" | "failed";

export interface ToolCall {
  id: string;
  title: string;
  status: ToolStatus;
  args: unknown;
  result?: unknown;
  error?: string;
  target?: string;
  parentMessageId?: string;
}

export function selectToolCalls(state: ChatState): ToolCall[] {
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  for (const message of state.messages) {
    for (const part of message.content.parts) {
      if (part.type !== "tool-invocation") continue;
      const call = part.toolInvocation;
      const terminal =
        call.state === "result" || call.state === "output-error" || call.state === "output-denied";
      const failed = call.isError === true || (terminal && call.state !== "result");
      const args = call.rawInput ?? call.args;
      seen.add(call.toolCallId);
      calls.push({
        id: call.toolCallId,
        title: call.toolName,
        status: terminal ? (failed ? "failed" : "completed") : "in_progress",
        args,
        target: toolTarget(args),
        parentMessageId: message.id,
        ...(terminal ? { result: call.result } : {}),
        ...(failed ? { error: call.errorText ?? stringify(call.result) } : {}),
      });
    }
  }
  const lastAssistantId = [...state.messages].reverse().find((m) => m.role === "assistant")?.id;
  for (const [id, tool] of Object.entries(state.display.activeTools ?? {})) {
    if (seen.has(id)) continue;
    const result = tool.result ?? tool.shellOutput ?? tool.partialResult;
    calls.push({
      id,
      title: tool.name,
      status:
        tool.status === "error"
          ? "failed"
          : tool.status === "completed"
            ? "completed"
            : "in_progress",
      args: tool.args,
      target: toolTarget(tool.args),
      parentMessageId: lastAssistantId,
      ...(result !== undefined ? { result } : {}),
      ...(tool.isError ? { error: stringify(tool.result) } : {}),
    });
  }
  return calls;
}

export interface Approval {
  toolCallId: string;
  toolName: string;
  suspended: boolean;
  suspendPayload?: unknown;
}

export function selectApprovals(display: ChatDisplay): Approval[] {
  const approvals: Approval[] = [];
  const pending = display.pendingApproval;
  if (pending)
    approvals.push({
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      suspended: false,
    });
  for (const suspension of Object.values(display.pendingSuspensions ?? {})) {
    approvals.push({
      toolCallId: suspension.toolCallId,
      toolName: suspension.toolName,
      suspended: true,
      suspendPayload: suspension.suspendPayload,
    });
  }
  return approvals;
}

export type RunStatus = "idle" | "running" | "waiting" | "error";

export function selectRunStatus(state: ChatState): RunStatus {
  if (state.errors.length > 0) return "error";
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

export const PERMISSION_LEVELS = {
  "read-only": { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
  ask: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
  trusted: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
} as const;

export function accessLevelFromPermissions(rules: PermissionRules | undefined): AccessLevel {
  if (!rules) return "ask";
  const categories = rules.categories ?? {};
  return (
    (Object.entries(PERMISSION_LEVELS) as [AccessLevel, Record<string, string>][]).find(
      ([, expected]) =>
        Object.entries(expected).every(([category, policy]) => categories[category] === policy),
    )?.[0] ?? "read-only"
  );
}

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
  const chat = state.messages.filter((m) => m.role === "user" || m.role === "assistant");
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
  const candidate = record?.path ?? record?.file ?? record?.query ?? record?.command;
  if (typeof candidate === "string") return candidate;
  if (typeof args === "string" && args.length <= 64) return args;
  return undefined;
}

export function stringify(value: unknown, indent?: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, indent) ?? "";
  } catch {
    return "[unserializable]";
  }
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
